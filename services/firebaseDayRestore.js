/**
 * services/firebaseDayRestore.js — "Firebase → Supabase for ONE day"  (SINGLE-DB build)
 * ---------------------------------------------------------------------------
 * WHY: Firebase holds the full history. When a day is missing from the one Supabase
 * project (a fresh project, a project switch, a wipe, a failed seed), the Admin needs
 * to pull exactly that one business day out of Firebase and write it back into Supabase.
 *
 * This is the single-Supabase adaptation of the newer dual-DB tool: there is no DB1/DB2
 * choice — everything goes to the one Supabase project the app is configured with.
 *
 * RULES IT HONOURS
 *  - One DAY only, decided by the SAME date columns DATE_FIELD_ANALYSIS.md §5 uses for the
 *    retention cron, so "a day" means the same day everywhere in the product.
 *  - Firebase timestamps are ISO-8601 UTC strings and the app's business day is the
 *    DEVICE-LOCAL calendar day, so a timestamp table is queried over the UTC instant range
 *    that the local day maps to ([local 00:00, next local 00:00) converted to ISO).
 *  - Upserts are idempotent (per-table conflict key) — re-running a day is always safe.
 *  - Never throws; one table failing never stops the others; every table is reported.
 *  - Reads/writes Supabase directly (never through the sync queue) and never touches the
 *    Realtime signal system or the pull path. `deletions` is NOT in the plan.
 */

import { getSupabaseConflictKey } from './supabaseSyncQueue.js';
import {
  getSupabaseClient,
  isSupabaseConfigured,
  isSupabaseSyncEnabled,
  withTimeout
} from './supabaseClient.js';

const BATCH_SIZE = 200;
const TIME = 20000;

// Columns that exist ONLY in local SQLite and must never be sent to Supabase.
const LOCAL_ONLY_COLUMNS = ['is_synced', 'is_synced_supabase'];

/**
 * Parent-first order (children reference parents). Only the tables that HAVE a per-day
 * notion matter for this tool; the rest are handled by the normal 31-day restore.
 */
export const BACKFILL_ORDER = [
  'owner_employees',
  'owner_salary_ledger',
  'orders',
  'order_items',
  'payments',
  'menu_categories',
  'menu_items',
  'restaurant_tables',
  'users',
  'deliveries',
  'expenses',
  'due_payments',
  'eja_history',
  'off_days',
  'weather_data',
  'supplier_due_history',
  'supplier_payment_ledger',
  'owner_expenses',
  'owner_deposits',
  'owner_home_deposits',
  'supplier_due',
  'daily_submit',
  'daily_summary',
  'daily_submit_priority',
  'delete_history'
];

/**
 * Per-table date specification, copied from DATE_FIELD_ANALYSIS.md §5.
 *  - kind 'date' → the column already stores YYYY-MM-DD ⇒ Firestore EQUAL on that string.
 *  - kind 'ts'   → ISO-8601 UTC string ⇒ Firestore range over the day's UTC bounds.
 * Only tables that HAVE a date notion are listed: "one day" is meaningless for
 * menu/users/owner ledgers, which the normal 31-day restore already handles.
 */
export const FIREBASE_DAY_SPECS = Object.freeze({
  orders: { fields: [{ path: 'created_at', kind: 'ts' }] },
  order_items: { fields: [{ path: 'created_at', kind: 'ts' }] },
  payments: { fields: [{ path: 'created_at', kind: 'ts' }] },
  expenses: { fields: [{ path: 'created_at', kind: 'ts' }] },
  // Business day = COALESCE(completed_at, created_at), so BOTH fields are queried and the
  // results merged by id (a delivery created yesterday but completed today belongs to today).
  deliveries: { fields: [{ path: 'completed_at', kind: 'ts' }, { path: 'created_at', kind: 'ts' }] },
  due_payments: { fields: [{ path: 'created_at', kind: 'ts' }] },
  // NOTE: activity_logs is deliberately NOT pushed — it does not exist in this app's
  // Supabase project, so a day push for it would only error.
  daily_submit: { fields: [{ path: 'date', kind: 'date' }] },
  daily_summary: { fields: [{ path: 'date', kind: 'date' }] },
  eja_history: { fields: [{ path: 'date', kind: 'date' }] },
  off_days: { fields: [{ path: 'date', kind: 'date' }] },
  weather_data: { fields: [{ path: 'date', kind: 'date' }] },
  supplier_due_history: { fields: [{ path: 'date', kind: 'date' }] },
  supplier_payment_ledger: { fields: [{ path: 'payment_date', kind: 'date' }] },
  owner_expenses: { fields: [{ path: 'expense_date', kind: 'date' }] }
});

/** Local document → flat row (the app's own Firestore shape; database.js keeps its copy local). */
function fromFirestoreDocument(doc) {
  const obj = {};
  const fields = doc.fields || {};
  for (const [k, v] of Object.entries(fields)) {
    if (v.stringValue !== undefined) obj[k] = v.stringValue;
    else if (v.doubleValue !== undefined) obj[k] = Number(v.doubleValue);
    else if (v.integerValue !== undefined) obj[k] = Number(v.integerValue);
    else if (v.booleanValue !== undefined) obj[k] = v.booleanValue;
    else if (v.timestampValue !== undefined) obj[k] = v.timestampValue;
  }
  const nameParts = String(doc.name || '').split('/');
  obj.id = nameParts[nameParts.length - 1];
  return obj;
}

/** Strip local-only columns exactly like the dual-write queue's upsert does. */
export function toSupabasePayload(row) {
  const out = {};
  for (const [k, v] of Object.entries(row || {})) {
    if (LOCAL_ONLY_COLUMNS.includes(k)) continue;
    out[k] = v === undefined ? null : v;
  }
  return out;
}

/** N days ago as a DEVICE-LOCAL YYYY-MM-DD. */
export function localDateOffset(days, now = new Date()) {
  const d = new Date(now.getTime() - Number(days || 0) * 86400000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// --- dependency seams (production defaults; overridable for tests) ------------
function defaultFetchRows(query) {
  // Lazy requires keep this module import-light. In the app (Metro) these resolve normally.
  const { getFirestoreAuthHeaders, invalidateCurrentToken } = require('./firebaseAuth.js');
  const projectId = String(process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || '').trim();
  const apiKey = String(process.env.EXPO_PUBLIC_FIREBASE_API_KEY || '').trim();
  if (!projectId || !apiKey) return Promise.resolve({ success: false, error: 'Firebase not configured', rows: [] });

  return (async () => {
    const auth = await getFirestoreAuthHeaders();
    if (!auth.success) return { success: false, error: auth.error || 'Firebase auth unavailable', rows: [] };

    const filters = [];
    if (query.equals != null) {
      filters.push({ fieldFilter: { field: { fieldPath: query.path }, op: 'EQUAL', value: { stringValue: query.equals } } });
    } else {
      if (query.from != null) filters.push({ fieldFilter: { field: { fieldPath: query.path }, op: 'GREATER_THAN_OR_EQUAL', value: { stringValue: query.from } } });
      if (query.to != null) filters.push({ fieldFilter: { field: { fieldPath: query.path }, op: 'LESS_THAN', value: { stringValue: query.to } } });
    }
    const where = filters.length === 1 ? filters[0] : { compositeFilter: { op: 'AND', filters } };
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery?key=${apiKey}`;
    const body = JSON.stringify({ structuredQuery: { from: [{ collectionId: query.table }], where } });

    let res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth.headers }, body });
    if (res.status === 401) {
      invalidateCurrentToken();
      const retry = await getFirestoreAuthHeaders();
      if (retry.success) {
        res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...retry.headers }, body });
      }
    }
    if (!res.ok) {
      // 403/404 = collection absent or not readable ⇒ treat as "no rows", like the pull does.
      if (res.status === 403 || res.status === 404) return { success: true, rows: [] };
      return { success: false, error: `Firestore HTTP ${res.status}`, rows: [] };
    }
    const data = await res.json();
    const rows = [];
    if (Array.isArray(data)) {
      for (const item of data) {
        if (item && item.document) rows.push(fromFirestoreDocument(item.document));
      }
    }
    return { success: true, rows };
  })();
}

const productionDeps = {
  fetchRows: defaultFetchRows,
  getClient: () => getSupabaseClient(),
  isConfigured: () => isSupabaseConfigured(),
  isSyncEnabled: () => isSupabaseSyncEnabled()
};
let deps = { ...productionDeps };

export function __setFirebaseDayDepsForTesting(overrides = {}) { deps = { ...deps, ...overrides }; }
export function __resetFirebaseDayDepsForTesting() { deps = { ...productionDeps }; }

// --- pure planning ------------------------------------------------------------
/** Strict YYYY-MM-DD that is also a real calendar date. */
export function isValidDay(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) return false;
  const [y, m, d] = String(day).split('-').map(Number);
  const probe = new Date(y, m - 1, d);
  return probe.getFullYear() === y && probe.getMonth() === m - 1 && probe.getDate() === d;
}

/**
 * The UTC instant range a DEVICE-LOCAL calendar day covers.
 * `new Date(y, m-1, d)` is local midnight, so this is correct for whatever timezone the
 * POS device is in (the app assumes Asia/Dhaka and every SQLite query uses 'localtime').
 */
export function dayBounds(day) {
  const [y, m, d] = String(day).split('-').map(Number);
  const start = new Date(y, m - 1, d, 0, 0, 0, 0);
  const end = new Date(y, m - 1, d + 1, 0, 0, 0, 0);
  return { from: start.toISOString(), to: end.toISOString() };
}

/** Ordered per-table fetch plan for one day (parent-first, same order as the seed). */
export function getFirebaseDayPlan(day) {
  if (!isValidDay(day)) return [];
  const { from, to } = dayBounds(day);
  return BACKFILL_ORDER
    .filter((t) => !!FIREBASE_DAY_SPECS[t])
    .map((table) => ({
      table,
      queries: FIREBASE_DAY_SPECS[table].fields.map((f) => (f.kind === 'date'
        ? { table, path: f.path, equals: day }
        : { table, path: f.path, from, to }))
    }));
}

/** Today / yesterday as YYYY-MM-DD in DEVICE-LOCAL time. */
export function todayLocal(now = new Date()) { return localDateOffset(0, now); }
export function yesterdayLocal(now = new Date()) { return localDateOffset(1, now); }

/** Shift a YYYY-MM-DD by ±n days, calendar-safe. */
export function shiftDay(day, delta) {
  if (!isValidDay(day)) return day;
  const [y, m, d] = String(day).split('-').map(Number);
  const shifted = new Date(y, m - 1, d + Number(delta || 0));
  const mm = String(shifted.getMonth() + 1).padStart(2, '0');
  const dd = String(shifted.getDate()).padStart(2, '0');
  return `${shifted.getFullYear()}-${mm}-${dd}`;
}

// --- fetching -----------------------------------------------------------------
/** Dedupe by id (used when a table is fetched off more than one field, e.g. deliveries). */
export function mergeRowsById(...rowLists) {
  const byId = new Map();
  let anon = 0;
  for (const rows of rowLists) {
    for (const row of rows || []) {
      const id = row && row.id != null ? String(row.id) : `__anon_${anon++}`;
      byId.set(id, row);
    }
  }
  return Array.from(byId.values());
}

async function fetchTableDay(entry) {
  const lists = [];
  const errors = [];
  for (const query of entry.queries) {
    let res = null;
    try {
      res = await deps.fetchRows(query);
    } catch (err) {
      errors.push(err?.message || String(err));
      continue;
    }
    if (!res || res.success === false) {
      errors.push(res?.error || 'fetch failed');
      continue;
    }
    lists.push(res.rows || []);
  }
  return { rows: mergeRowsById(...lists), errors };
}

/**
 * READ-ONLY preview: how many rows Firebase holds for that day, per table. Writes nothing.
 * @returns {Promise<{ok: boolean, day: string, tables: object[], totalFetched: number, error?: string}>}
 */
export async function previewFirebaseDay({ day, onProgress } = {}) {
  if (!isValidDay(day)) return { ok: false, day, tables: [], totalFetched: 0, error: 'invalid day (YYYY-MM-DD)' };
  const plan = getFirebaseDayPlan(day);
  const tables = [];
  for (let i = 0; i < plan.length; i++) {
    const entry = plan[i];
    const { rows, errors } = await fetchTableDay(entry);
    tables.push({ table: entry.table, fetched: rows.length, error: errors.length ? errors.join('; ') : null });
    if (typeof onProgress === 'function') {
      try { onProgress({ phase: 'preview', table: entry.table, fetched: rows.length, index: i + 1, totalTables: plan.length }); } catch (_) {}
    }
  }
  return { ok: true, day, tables, totalFetched: tables.reduce((a, t) => a + t.fetched, 0) };
}

// --- writing ------------------------------------------------------------------
async function pushTableDay(client, entry, { batchSize, onProgress, report }) {
  const batch = Number(batchSize) > 0 ? Number(batchSize) : BATCH_SIZE;
  const conflictKey = getSupabaseConflictKey(entry.table);
  const record = { table: entry.table, fetched: 0, pushed: 0, failed: 0, batches: 0, error: null };
  report.tables.push(record);

  const { rows, errors } = await fetchTableDay(entry);
  record.fetched = rows.length;
  if (errors.length) record.error = errors.join('; ');
  if (!rows.length) return record;

  for (let offset = 0; offset < rows.length; offset += batch) {
    const slice = rows.slice(offset, offset + batch).map(toSupabasePayload);
    let error = null;
    try {
      const res = await withTimeout(
        client.from(entry.table).upsert(slice, { onConflict: conflictKey }),
        TIME,
        `firebase day ${entry.table}`
      );
      error = res && res.error ? res.error : null;
    } catch (err) {
      error = { message: err?.message || String(err) };
    }
    if (error) {
      record.error = error.message || 'upsert failed';
      if (error.code) record.errorCode = error.code;
      record.failed += slice.length;
      break;                              // this table is done — the others continue
    }
    record.batches += 1;
    record.pushed += slice.length;
    if (typeof onProgress === 'function') {
      try { onProgress({ phase: 'push', table: entry.table, pushed: record.pushed, fetched: record.fetched }); } catch (_) {}
    }
  }
  return record;
}

const RLS_HINTS = ['row-level security', 'permission denied', '42501'];

/**
 * Pull ONE day from Firebase and write it into Supabase (upsert, idempotent).
 *
 * @param {{day: string, batchSize?: number, onProgress?: Function}} options
 * @returns {Promise<object>} report — never throws.
 */
export async function pushFirebaseDayToSupabase({ day, batchSize = BATCH_SIZE, onProgress } = {}) {
  const startedAt = new Date();
  const base = { ok: false, day, startedAt: startedAt.toISOString(), plan: [], tables: [], pushedRows: 0, failedRows: 0, notes: [] };

  if (!isValidDay(day)) {
    return { ...base, error: 'দিনটি YYYY-MM-DD ফরম্যাটে দিন (যেমন 2026-09-30)', finishedAt: startedAt.toISOString(), durationMs: 0 };
  }
  if (!deps.isSyncEnabled()) {
    return { ...base, error: 'Supabase sync disabled (EXPO_PUBLIC_SUPABASE_SYNC_ENABLED=false)', finishedAt: startedAt.toISOString(), durationMs: 0 };
  }
  if (!deps.isConfigured()) {
    return { ...base, error: 'Supabase is not configured', finishedAt: startedAt.toISOString(), durationMs: 0 };
  }
  const client = deps.getClient();
  if (!client) {
    return { ...base, error: 'Supabase client unavailable', finishedAt: startedAt.toISOString(), durationMs: 0 };
  }

  const plan = getFirebaseDayPlan(day);
  const result = { ...base, plan: plan.map((e) => ({ table: e.table, fields: e.queries.map((q) => q.path) })) };

  const report = { tables: [] };
  for (let i = 0; i < plan.length; i++) {
    const entry = plan[i];
    try {
      await pushTableDay(client, entry, { batchSize, onProgress, report });
    } catch (err) {
      report.tables.push({ table: entry.table, fetched: 0, pushed: 0, failed: 0, batches: 0, error: err?.message || String(err) });
    }
  }
  result.tables = report.tables;
  result.pushedRows = report.tables.reduce((a, t) => a + (t.pushed || 0), 0);
  result.failedRows = report.tables.reduce((a, t) => a + (t.failed || 0), 0);

  const firstErr = report.tables.find((t) => t.error && t.failed > 0);
  if (firstErr) {
    const msg = String(firstErr.error || '');
    if (RLS_HINTS.some((h) => msg.toLowerCase().includes(h))) {
      result.notes.push(`${firstErr.table} RLS-এ reject হয়েছে — ডিভাইসটি ACTIVE কিনা দেখুন।`);
    }
  }

  const anyTableError = report.tables.some((t) => t.error);
  result.ok = result.pushedRows > 0 && result.failedRows === 0 && !anyTableError;
  if (result.pushedRows === 0) result.notes.push('কিছু লেখা হয়নি — উপরের বার্তা দেখুন।');

  const finishedAt = new Date();
  result.finishedAt = finishedAt.toISOString();
  result.durationMs = finishedAt.getTime() - startedAt.getTime();
  return result;
}
