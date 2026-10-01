/**
 * services/localToSupabase.js — "Local SQLite → Supabase" backfill (single-Supabase build).
 * ---------------------------------------------------------------------------
 * WHY: when a day (or the recent window) exists locally in SQLite but is missing from the
 * one Supabase project, the Admin needs to push the LOCAL rows up. This is the reverse of a
 * pull, and it is manual/on-demand only (Backup & Restore screen).
 *
 * RULES
 *  - Only tables that actually exist in this app's Supabase project are touched.
 *    `activity_logs` is deliberately EXCLUDED (it is not in this app's Supabase).
 *  - Rolling/transactional tables are windowed to the last N days (default 31); master
 *    tables (menu, users, tables, owner masters) are pushed in full (they have no day).
 *  - "Already there ⇒ skip": rows whose primary key already exists in Supabase are NOT
 *    re-sent; only missing rows are upserted (idempotent).
 *  - Upserts go DIRECTLY to Supabase (never through the sync queue) and never touch the
 *    Realtime signal / pull path.
 *  - Never throws; one table failing never stops the others; every table is reported.
 */

import { getSupabaseConflictKey } from './supabaseSyncQueue.js';
import {
  getSupabaseClient,
  isSupabaseConfigured,
  isSupabaseSyncEnabled,
  withTimeout
} from './supabaseClient.js';

const BATCH = 200;
const TIME = 20000;

// Columns that exist ONLY in local SQLite and must never be sent to Supabase.
const LOCAL_ONLY_COLUMNS = ['is_synced', 'is_synced_supabase'];

/**
 * Per-table spec:
 *   window: { expr, kind:'ts'|'date' }  → only rows within the last N days are pushed
 *   window: null                        → the whole table is pushed (master data)
 * `activity_logs`, `app_config`, `devices*`, `sync_queue*`, `ai_dataset*` are NOT here.
 */
export const LOCAL_PUSH_SPEC = Object.freeze({
  // ── rolling / transactional (windowed to the last N days) ──────────────────
  orders: { window: { expr: 'created_at', kind: 'ts' } },
  order_items: { window: { expr: 'created_at', kind: 'ts' } },
  payments: { window: { expr: 'created_at', kind: 'ts' } },
  expenses: { window: { expr: 'created_at', kind: 'ts' } },
  deliveries: { window: { expr: 'COALESCE(completed_at, created_at)', kind: 'ts' } },
  due_payments: { window: { expr: 'created_at', kind: 'ts' } },
  eja_history: { window: { expr: 'date', kind: 'date' } },
  off_days: { window: { expr: 'date', kind: 'date' } },
  weather_data: { window: { expr: 'date', kind: 'date' } },
  supplier_due_history: { window: { expr: 'date', kind: 'date' } },
  supplier_payment_ledger: { window: { expr: 'payment_date', kind: 'date' } },
  owner_expenses: { window: { expr: 'expense_date', kind: 'date' } },
  deletions: { window: { expr: 'created_at', kind: 'ts' } },
  delete_history: { window: { expr: 'COALESCE(deleted_at, created_at)', kind: 'ts' } },
  daily_submit: { window: { expr: 'date', kind: 'date' } },
  daily_summary: { window: { expr: 'date', kind: 'date' } },
  daily_submit_priority: { window: { expr: 'business_date', kind: 'date' } },

  // ── master / permanent (full push) ─────────────────────────────────────────
  users: { window: null },
  restaurant_tables: { window: null },
  menu_categories: { window: null },
  menu_items: { window: null },
  supplier_due: { window: null },
  owner_employees: { window: null },
  owner_salary_ledger: { window: null },
  owner_deposits: { window: null },
  owner_home_deposits: { window: null }
});

/** Ordered so a child is never pushed before its parent. */
export const LOCAL_PUSH_ORDER = [
  'owner_employees',
  'owner_salary_ledger',
  'users',
  'restaurant_tables',
  'menu_categories',
  'menu_items',
  'supplier_due',
  'orders',
  'order_items',
  'payments',
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
  'daily_submit',
  'daily_summary',
  'daily_submit_priority',
  'deletions',
  'delete_history'
];

function stripLocal(row) {
  const out = {};
  for (const [k, v] of Object.entries(row || {})) {
    if (LOCAL_ONLY_COLUMNS.includes(k)) continue;
    out[k] = v === undefined ? null : v;
  }
  return out;
}

/** N days ago as a DEVICE-LOCAL YYYY-MM-DD. */
function localDateOffset(days, now = new Date()) {
  const d = new Date(now.getTime() - Number(days || 0) * 86400000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** A PostgREST error meaning "this table does not exist in the project". */
function isMissingTable(error) {
  if (!error) return false;
  const code = String(error.code || '').toUpperCase();
  if (code === 'PGRST205' || code === '42P01') return true;
  const msg = String(error.message || '').toLowerCase();
  return msg.includes('could not find the table') || msg.includes('does not exist');
}

/**
 * A parent row referenced by this row is missing (SQLSTATE 23503), e.g. a salary
 * entry whose employee was deleted. Such a row can never be inserted, but it must
 * NOT be allowed to fail the whole batch — the rest of the batch is still valid.
 */
function isForeignKeyError(error) {
  if (!error) return false;
  if (String(error.code) === '23503') return true;
  const msg = String(error.message || '').toLowerCase();
  return msg.includes('violates foreign key constraint') || msg.includes('foreign key constraint');
}

/** Read local SQLite rows for a table, windowed when the spec says so. */
function readLocalRows(db, table, spec, cutoff) {
  let sql = `SELECT * FROM ${table}`;
  const params = [];
  if (spec && spec.window) {
    const { expr, kind } = spec.window;
    const lhs = kind === 'date' ? `substr(${expr}, 1, 10)` : `date(${expr}, 'localtime')`;
    sql += ` WHERE ${lhs} >= ?`;
    params.push(cutoff);
  }
  return db.getAllSync(sql, params) || [];
}

// --- dependency seams (production defaults; overridable in unit tests) -------
function defaultGetDb() {
  return require('../database.js').getDb();
}
const productionDeps = {
  isEnabled: isSupabaseSyncEnabled,
  isConfigured: isSupabaseConfigured,
  getClient: () => getSupabaseClient(),
  getDb: defaultGetDb
};
let deps = { ...productionDeps };

export function __setLocalPushDepsForTesting(overrides = {}) { deps = { ...deps, ...overrides }; }
export function __resetLocalPushDepsForTesting() { deps = { ...productionDeps }; }

/** Which of `ids` already exist in Supabase (by pk). Returns { existing:Set, missingTable:bool }. */
async function fetchExistingKeys(client, table, pk, ids) {
  const existing = new Set();
  for (const part of chunk(ids, BATCH)) {
    const { data, error } = await withTimeout(
      client.from(table).select(pk).in(pk, part),
      TIME,
      `existing ${table}`
    );
    if (error) {
      if (isMissingTable(error)) return { existing, missingTable: true };
      throw new Error(error.message || 'existing-keys query failed');
    }
    for (const r of data || []) {
      if (r && r[pk] != null) existing.add(String(r[pk]));
    }
  }
  return { existing, missingTable: false };
}

/**
 * Push LOCAL SQLite rows into Supabase.
 *
 * @param {{days?: number, skipExisting?: boolean, batchSize?: number, onProgress?: Function}} [opts]
 * @returns {Promise<object>} report — never throws.
 */
export async function pushLocalToSupabase({ days = 31, skipExisting = true, batchSize = BATCH, onProgress } = {}) {
  const startedAt = new Date();
  const base = {
    ok: false,
    days,
    cutoff: localDateOffset(Math.max(0, Number(days) - 1)),
    startedAt: startedAt.toISOString(),
    tables: [],
    pushedRows: 0,
    skippedExisting: 0,
    orphanRows: 0,
    failedRows: 0,
    notes: []
  };

  if (!deps.isEnabled()) return { ...base, error: 'Supabase sync disabled (EXPO_PUBLIC_SUPABASE_SYNC_ENABLED=false)' };
  if (!deps.isConfigured()) return { ...base, error: 'Supabase is not configured' };

  let db = null;
  try { db = deps.getDb(); } catch (_) { db = null; }
  if (!db) return { ...base, error: 'Local database not ready' };

  const client = deps.getClient();
  if (!client) return { ...base, error: 'Supabase client unavailable' };

  for (let i = 0; i < LOCAL_PUSH_ORDER.length; i++) {
    const table = LOCAL_PUSH_ORDER[i];
    const spec = LOCAL_PUSH_SPEC[table];
    const pk = getSupabaseConflictKey(table);
    const record = { table, local: 0, existing: 0, pushed: 0, orphans: 0, orphanSample: null, failed: 0, error: null };
    base.tables.push(record);

    try {
      const rows = readLocalRows(db, table, spec, base.cutoff);
      record.local = rows.length;
      if (!rows.length) continue;

      let toPush = rows;
      if (skipExisting) {
        const ids = rows.map((r) => String(r[pk]));
        const { existing, missingTable } = await fetchExistingKeys(client, table, pk, ids);
        if (missingTable) {
          record.skippedReason = `${table} is not in Supabase — skipped`;
          base.notes.push(record.skippedReason);
          continue;
        }
        record.existing = existing.size;
        base.skippedExisting += existing.size;
        toPush = rows.filter((r) => !existing.has(String(r[pk])));
      }

      for (const part of chunk(toPush, batchSize)) {
        const payload = part.map(stripLocal);
        const { error } = await withTimeout(
          client.from(table).upsert(payload, { onConflict: pk }),
          TIME,
          `local push ${table}`
        );
        if (error) {
          if (isMissingTable(error)) {
            record.skippedReason = `${table} is not in Supabase — skipped`;
            base.notes.push(record.skippedReason);
            break;
          }
          if (isForeignKeyError(error)) {
            // One orphan row (its parent, e.g. the employee, no longer exists)
            // must not kill the whole batch. Retry row-by-row: valid rows land,
            // orphans are reported and skipped instead of failing the push.
            for (const row of part) {
              const single = await withTimeout(
                client.from(table).upsert([stripLocal(row)], { onConflict: pk }),
                TIME,
                `local push ${table} (row)`
              );
              if (single.error) {
                record.orphans += 1;
                base.orphanRows += 1;
                if (!record.orphanSample) record.orphanSample = single.error.message || 'parent row missing';
              } else {
                record.pushed += 1;
                base.pushedRows += 1;
              }
            }
            continue;
          }
          record.error = error.message || 'upsert failed';
          record.failed += part.length;
          base.failedRows += part.length;
          break;
        }
        record.pushed += part.length;
        base.pushedRows += part.length;
      }

      if (typeof onProgress === 'function') {
        try {
          onProgress({ table, index: i + 1, totalTables: LOCAL_PUSH_ORDER.length, local: record.local, pushed: record.pushed, existing: record.existing });
        } catch (_) {}
      }
    } catch (err) {
      record.error = err?.message || String(err);
      if (record.failed === 0 && record.pushed === 0) record.failed = record.local;
      base.failedRows += record.failed;
    }
  }

  const finishedAt = new Date();
  base.finishedAt = finishedAt.toISOString();
  base.durationMs = finishedAt.getTime() - startedAt.getTime();
  base.ok = base.failedRows === 0 && base.tables.some((t) => t.pushed > 0 || t.existing > 0 || t.local > 0);
  if (base.orphanRows > 0) {
    const orphanTables = base.tables.filter((t) => t.orphans > 0).map((t) => `${t.table} (${t.orphans})`);
    base.notes.push(
      `${base.orphanRows} টি row বাদ — ${orphanTables.join(', ')}: এদের মূল রেকর্ড (যেমন মুছে ফেলা কর্মী) Supabase-এ নেই, তাই DB নিয়মে এগুলো লেখা যায় না।`
    );
  }
  if (!base.ok && base.failedRows === 0) base.notes.push('কোনো table-এ নতুন কিছু push করার ছিল না, বা Supabase-এ table নেই।');
  return base;
}

export { localDateOffset };
