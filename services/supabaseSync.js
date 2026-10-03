/**
 * Supabase-primary PULL sync (Phase 3)
 * ---------------------------------------------------------------------------
 * Mirrors the Firebase pull engine but sources rows from Supabase first.
 * Supabase is the ONLY read path while it is healthy: the Firebase pull timers in
 * App.js are gated on isSupabasePrimaryHealthy() and skipped in the healthy case.
 * On ANY Supabase failure/timeout the matching Firebase sync function is invoked as
 * a fallback in the SAME tick, so the local DB always converges.
 *
 * Isolation: nothing here throws out of a public function. Lazy `require` of
 * database.js keeps this module importable in plain Node (unit tests).
 *
 * menu_items/menu_categories + daily_submit/daily_summary ARE pulled from Supabase.
 * restaurant_tables uses polling (caller schedules ~2s) — NOT Realtime.
 */

import {
  getSupabaseClient,
  isSupabaseConfigured,
  isSupabaseSyncEnabled,
  withTimeout
} from './supabaseClient.js';
import { isTombstoned, isResurrectBlocked, isTombstoneStale } from './tombstoneStore.js';
import { recordSyncHeartbeat } from './supabaseHeartbeat.js';

const OVERLAP_MS = 60000;          // re-read window to absorb clock drift / eventual consistency
const MARKER_SAFETY_MS = 15000;    // never advance a cursor past queryStart - 15s
const PAGE_SIZE = 1000;            // PostgREST default max rows per request
const PULL_TIMEOUT_MS = (() => {
  const n = Number(process.env.EXPO_PUBLIC_SUPABASE_PULL_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 8000;
})();

const RESTAURANT_TABLE_IDS = ['table_1', 'table_2', 'table_3', 'table_4', 'table_5', 'table_6', 'table_7', 'table_8'];
// Only app_config stays Firebase-only (tombstones + sync markers).
// daily_submit/daily_summary are permanent in Supabase, so they are pulled from it.
const LOW_FREQ_EXCLUDED = ['app_config'];

// --- signal → pull-group mapping (Realtime "change signal" design) ------------
// SINGLE SOURCE OF TRUTH for which tables belong to the two adaptive-polled groups.
// Consumed by this module's pull functions AND by services/realtimeSignal.js, so the
// receiver's table→group mapping can never drift from what is actually pulled.
export const SIGNAL_GROUPS = {
  tables: ['restaurant_tables'],
  high: ['orders', 'order_items', 'payments', 'deliveries'],
  deletions: ['deletions']
};

// --- Firebase read policy ------------------------------------------------------
// OWNER POLICY: Firebase must NOT be read automatically. It is read only by explicit
// manual actions (Cloud Restore, Manual Pull, report history downloads, menu recovery,
// same-day resync). With this `false`:
//   • a Supabase read failure no longer triggers an automatic same-tick Firebase fallback,
//   • the standalone Firebase pull timers never read (see App.js runFirebasePullIfSupabaseDown),
//   • the login/foreground/startup lifecycle pulls never fall back to Firebase.
// The device simply keeps its local data until the user triggers a manual pull.
// Flip to `true` to restore the previous automatic-fallback behaviour.
export const ALLOW_AUTO_FIREBASE_READ = false;

// --- dependency seams (production defaults; overridable in unit tests) --------
function defaultGetDb() {
  return require('../database.js').getDb();
}
function defaultGetFirebase() {
  return require('../database.js');
}

const productionDeps = {
  isEnabled: isSupabaseSyncEnabled,
  isConfigured: isSupabaseConfigured,
  getClient: getSupabaseClient,
  getDb: defaultGetDb,
  getFirebase: defaultGetFirebase
};
let deps = { ...productionDeps };

export function __setSupabaseSyncDepsForTesting(overrides = {}) {
  deps = { ...deps, ...overrides };
}
export function __resetSupabaseSyncDepsForTesting() {
  deps = { ...productionDeps };
  supabasePrimaryHealthy = true;
  pullListener = null;
}

// Supabase health — the single source of truth for "may Firebase reads be skipped?".
// Optimistic default (enabled + configured) until a pull cycle proves otherwise.
let supabasePrimaryHealthy = true;

/**
 * True when the Supabase dual-write queue has at least one FAILED item. While a
 * Supabase write is failing, the Supabase copy is BEHIND the local DB (the parallel
 * Firebase write already succeeded), so a Supabase READ would return STALE data.
 * In that state Firebase must be preferred until the write queue drains.
 */
function countFailedSupabaseWrites(db) {
  try {
    const row = db.getFirstSync("SELECT COUNT(*) AS n FROM sync_queue_supabase WHERE status = 'FAILED'");
    return row && Number(row.n) > 0 ? Number(row.n) : 0;
  } catch (_) {
    return 0;
  }
}

/**
 * Diagnostic health snapshot. `reason` is one of:
 *   'healthy' | 'killswitch' | 'unconfigured' | 'read-failed' | 'failed-writes:<n>' | 'error'
 * Used by the App.js pull helper to log WHY Firebase reads are (not) being skipped.
 */
export function getSupabaseHealth() {
  try {
    if (!deps.isEnabled()) return { healthy: false, reason: 'killswitch' };
    if (!deps.isConfigured()) return { healthy: false, reason: 'unconfigured' };
    if (!supabasePrimaryHealthy) return { healthy: false, reason: 'read-failed' };
    let db = null;
    try { db = deps.getDb(); } catch (_) { db = null; }
    if (db) {
      const n = countFailedSupabaseWrites(db);
      if (n > 0) return { healthy: false, reason: `failed-writes:${n}` };
    }
    return { healthy: true, reason: 'healthy' };
  } catch (err) {
    return { healthy: false, reason: 'error' };
  }
}

/**
 * True when Supabase is enabled, configured, the last pull cycle did NOT fail, AND
 * no Supabase WRITE is currently failing. App.js gates every non-exempt Firebase
 * read on this: while it is true the Firebase pull timers are skipped; on a read
 * failure the Supabase syncers already invoked the matching Firebase fallback in
 * the same tick, and on a write failure the Supabase copy is stale so Firebase is
 * preferred for reads until the queue recovers.
 */
export function isSupabasePrimaryHealthy() {
  return getSupabaseHealth().healthy;
}

// --- pull-activity listener (used by the pull toast in App.js) ----------------
// Reports the BACKEND ACTUALLY READ for every pull: 'supabase' on success, or
// 'firebase' when this group fell back. Fires only when a pull really happened.
let pullListener = null;
export function setPullListener(fn) { pullListener = typeof fn === 'function' ? fn : null; }
export function clearPullListener() { pullListener = null; }
function emitPull(source, hasChanges) {
  try { if (pullListener) pullListener({ source, hasChanges: !!hasChanges }); } catch (_) {}
}

// --- pure helpers ------------------------------------------------------------

export function getSupabasePkColumn(tableName) {
  if (tableName === 'daily_submit' || tableName === 'daily_summary') return 'date';
  if (tableName === 'daily_submit_priority') return 'business_date';
  return 'id';
}

/** Prefer updated_at; fall back to created_at for tables without it. */
export function getSupabaseCursorColumn(db, tableName) {
  let cols = [];
  try {
    cols = db.getAllSync(`PRAGMA table_info(${tableName})`).map((c) => c.name);
  } catch (_) {}
  return cols.includes('updated_at') ? 'updated_at' : 'created_at';
}

function normalizeValue(v) {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  return v;
}

/**
 * Phase 7 safety helper: does this Supabase/PostgREST error look like an
 * RLS / permission denial? Such errors are handled EXACTLY like any other
 * Supabase failure — the caller falls back to Firebase in the same tick.
 *
 * Note: an RLS-denied SELECT is NOT an error at all — PostgREST returns HTTP 200
 * with an empty set (the policy filters rows out). The Firebase pull timers stay
 * running, so the local DB still converges; only genuine write/HTTP denials
 * (INSERT/UPDATE WITH CHECK, or a 401/403) surface as errors classified here.
 */
export function isRlsDenialError(error) {
  if (!error) return false;
  const code = String(error.code || '').toUpperCase();
  if (code === '42501') return true; // insufficient_privilege
  const status = Number(error.status || error.statusCode || 0);
  if (status === 401 || status === 403) return true;
  const msg = String(error.message || error.error_description || error || '').toLowerCase();
  return (
    msg.includes('row-level security') ||
    msg.includes('row level security') ||
    msg.includes('permission denied') ||
    msg.includes('not authorized')
  );
}

function deleteTargetRow(db, targetTable, targetId) {
  try {
    if (targetTable === 'daily_submit' || targetTable === 'daily_summary' || targetTable === 'ai_dataset_history') {
      db.runSync(`DELETE FROM ${targetTable} WHERE date = ?`, [String(targetId)]);
    } else {
      db.runSync(`DELETE FROM ${targetTable} WHERE id = ?`, [String(targetId)]);
    }
  } catch (err) {
    console.error('[SupabaseSync] Failed to delete target record locally:', err.message);
  }
}

/**
 * Merge remote Supabase rows into SQLite using the SAME rules as the Firebase
 * `syncCollections`: newer updated_at wins, local is_synced=0 edits are kept,
 * Schema Guardian filters to columns that exist locally, tombstones are applied.
 */
export function mergeSupabaseRows(db, table, rows) {
  let hasChanges = false;

  let validColumns = [];
  try {
    validColumns = db.getAllSync(`PRAGMA table_info(${table})`).map((c) => c.name);
  } catch (err) {
    console.error(`[SupabaseSync] Failed to get schema for ${table}:`, err.message);
    return { hasChanges: false };
  }

  const pk = getSupabasePkColumn(table);

  for (const row of rows || []) {
    if (!row) continue;
    const docId = String(row[pk]);

    if (table === 'restaurant_tables' && !RESTAURANT_TABLE_IDS.includes(docId)) continue;
    if (table === 'deletions' && (!row.table_name || !row.record_id)) continue;

    if (table === 'deletions') {
      // FINAL-RESURRECT-3: ignore a STALE tombstone (local row re-created after the
      // delete) — do not delete the row and do not store the tombstone.
      if (isTombstoneStale(db, row.table_name, row.record_id, row.updated_at || row.created_at)) {
        console.log(`[Sync] Ignored stale tombstone (row re-created after delete): ${row.table_name}/${row.record_id}`);
        continue;
      }
      deleteTargetRow(db, row.table_name, row.record_id);
    }

    // R3/R4 fix (time-aware, FINAL-RESURRECT-2): never resurrect a locally-deleted
    // record — UNLESS the cloud row is strictly newer than the tombstone (i.e. the
    // record was legitimately re-created after the delete), in which case the stale
    // tombstone is cleared and the insert proceeds.
    if (table !== 'deletions' && isResurrectBlocked(db, table, docId, row.updated_at || row.created_at)) {
      console.log(`[Sync] Skipped resurrect: ${table}/${docId}, tombstone present`);
      continue;
    }

    let localRow = null;
    try {
      localRow = db.getFirstSync(`SELECT * FROM ${table} WHERE ${pk} = ?`, [docId]);
    } catch (_) {}

    let shouldUpdate = false;
    if (!localRow) {
      shouldUpdate = true;
    } else {
      const localTime = new Date(localRow.updated_at || localRow.created_at || 0).getTime();
      const cloudTime = new Date(row.updated_at || row.created_at || 0).getTime();
      if (cloudTime > localTime) {
        shouldUpdate = true;
      } else if (Number(localRow.is_synced_supabase || 0) === 0) {
        // Phase 7.2: keep the local row ONLY while it is pending ITS OWN backend
        // (Supabase). The Firebase `is_synced` flag is irrelevant here — using it
        // was the bug: a fast Firebase push flipped is_synced=1, so this pull
        // trusted Supabase's still-stale copy and clobbered the local edit.
        continue;
      } else {
        for (const key of Object.keys(row)) {
          if (row[key] !== localRow[key] && key !== 'is_synced') {
            shouldUpdate = true;
            break;
          }
        }
      }
    }

    if (table === 'restaurant_tables' || table === 'order_items') {
      const _lt = localRow ? new Date(localRow.updated_at || localRow.created_at || 0).getTime() : 0;
      const _ct = new Date(row.updated_at || row.created_at || 0).getTime();
      console.log(`[MERGE-DEBUG] SB ${table}/${docId} localSynced=${localRow ? localRow.is_synced : 'none'} localTs=${_lt} cloudTs=${_ct} shouldUpdate=${shouldUpdate}`);
    }

    if (!shouldUpdate) continue;

    // Enforce menu uniqueness (mirrors the Firebase pull path).
    if (table === 'menu_items' && row.name) {
      try {
        const dup = db.getFirstSync(
          "SELECT id FROM menu_items WHERE LOWER(TRIM(name)) = LOWER(?) AND LOWER(TRIM(category)) = LOWER(?) AND id != ?",
          [String(row.name).trim(), String(row.category || '').trim(), docId]
        );
        if (dup) db.runSync("DELETE FROM menu_items WHERE id = ?", [dup.id]);
      } catch (_) {}
    }

    // --- SCHEMA GUARDIAN ---
    const filteredRow = {};
    for (const key of Object.keys(row)) {
      if (validColumns.includes(key) && key !== 'is_synced' && key !== 'is_synced_supabase') {
        filteredRow[key] = normalizeValue(row[key]);
      }
    }
    const keys = Object.keys(filteredRow);
    if (keys.length === 0) continue;

    // Preserve is_synced=1 (Firebase flag, existing behavior) and mark this row as
    // Supabase-synced too, since it was just pulled FROM Supabase (Phase 7.2).
    const cols = keys.slice();
    const vals = keys.map((k) => filteredRow[k]);
    if (validColumns.includes('is_synced')) { cols.push('is_synced'); vals.push(1); }
    if (validColumns.includes('is_synced_supabase')) { cols.push('is_synced_supabase'); vals.push(1); }

    const placeholders = cols.map(() => '?').join(', ');
    const sql = `INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`;

    try {
      db.runSync(sql, vals);
      hasChanges = true;
    } catch (e) {
      console.error(`[SupabaseSync] Failed to upsert row in "${table}":`, e.message);
    }
  }

  return { hasChanges };
}

function advanceMarker(db, table, cursorCol, previousMarker, rows, queryStartTime) {
  let maxCursor = previousMarker;
  for (const r of rows || []) {
    const v = r && r[cursorCol];
    if (v && (!maxCursor || v > maxCursor)) maxCursor = v;
  }
  let finalMarker = maxCursor;
  if (!finalMarker || (previousMarker && previousMarker > finalMarker)) finalMarker = previousMarker;

  const safety = new Date(new Date(queryStartTime).getTime() - MARKER_SAFETY_MS).toISOString();
  if (!rows || rows.length === 0) {
    if (safety > finalMarker) finalMarker = safety;
  }

  try {
    db.runSync("INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)", [`last_sync_time_supabase_${table}`, finalMarker]);
  } catch (e) {
    console.error(`[SupabaseSync] Failed to persist marker for ${table}:`, e.message);
  }
}

async function fetchSupabaseRows(db, table, cursorCol, marker) {
  const client = deps.getClient();
  if (!client) throw new Error('Supabase client unavailable');

  let activeCursorCol = cursorCol;
  const rows = [];
  let offset = 0;
  // Bounded pagination (PostgREST caps a single response at ~1000 rows).
  for (let page = 0; page < 50; page++) {
    let q = client.from(table).select('*');
    if (marker) q = q.gt(activeCursorCol, marker);
    q = q.order(activeCursorCol, { ascending: true }).range(offset, offset + PAGE_SIZE - 1);
    const { data, error } = await withTimeout(q, PULL_TIMEOUT_MS, `pull ${table}`);
    if (error) {
      // If ordering or filtering on updated_at failed because it does not exist on the remote Supabase table, retry with created_at
      if (activeCursorCol === 'updated_at' && page === 0 && (error.code === '42703' || String(error.message || '').includes('does not exist'))) {
        console.warn(`[SupabaseSync] table ${table} lacks updated_at in Supabase; retrying with created_at`);
        activeCursorCol = 'created_at';
        page = -1;
        offset = 0;
        rows.length = 0;
        continue;
      }
      // Preserve PostgREST code/status so callers can classify RLS/permission
      // denials (isRlsDenialError) while still failing the same way.
      const e = new Error(error.message || 'supabase pull error');
      e.code = error.code;
      e.status = error.status;
      throw e;
    }
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return rows;
}

/** Pull one table delta from Supabase and merge it. Throws on failure. */
export async function pullSupabaseTable(db, table) {
  const cursorCol = getSupabaseCursorColumn(db, table);

  let previousMarker = null;
  try {
    const row = db.getFirstSync("SELECT value FROM app_config WHERE key = ?", [`last_sync_time_supabase_${table}`]);
    if (row) previousMarker = row.value;
  } catch (_) {}

  const queryStartTime = new Date().toISOString();
  let queryMarker = null;
  if (previousMarker) {
    try {
      queryMarker = new Date(new Date(previousMarker).getTime() - OVERLAP_MS).toISOString();
    } catch (_) {
      queryMarker = previousMarker;
    }
  }

  const rows = await fetchSupabaseRows(db, table, cursorCol, queryMarker);
  const merged = mergeSupabaseRows(db, table, rows);
  advanceMarker(db, table, cursorCol, previousMarker, rows, queryStartTime);
  return { failed: false, hasChanges: merged.hasChanges, rowCount: rows.length };
}

export function getSupabaseLowFreqTables(fb) {
  try {
    const profiles = fb.APP_PROFILES || {};
    const active = fb.ACTIVE_APP_PROFILE || 'ADMIN';
    const profile = profiles[active] || profiles.ADMIN || { lowFreq: [] };
    return (profile.lowFreq || []).filter((t) => !LOW_FREQ_EXCLUDED.includes(t));
  } catch (_) {
    return [];
  }
}

async function callFirebaseFallback(fb, fnName) {
  try {
    const fn = fb && fb[fnName];
    if (typeof fn === 'function') return await fn();
    return false;
  } catch (err) {
    console.warn(`[SupabaseSync] Firebase fallback ${fnName} error (isolated):`, err?.message || err);
    return false;
  }
}

/**
 * Pull a group from Supabase; on any failure/timeout fall back to the Firebase
 * sync function in the same tick. Returns "did anything change".
 */
async function runSupabaseGroup(tables, firebaseFnName) {
  if (!deps.isEnabled()) { supabasePrimaryHealthy = false; return false; } // kill switch → Firebase-only mode

  const fb = deps.getFirebase();
  if (!deps.isConfigured()) {
    supabasePrimaryHealthy = false;
    const r = await callFirebaseFallback(fb, firebaseFnName); // dormant → Firebase fallback
    emitPull('firebase', r);
    return r;
  }

  let db = null;
  try {
    db = deps.getDb();
  } catch (_) {
    db = null;
  }
  if (!db) {
    supabasePrimaryHealthy = false;
    const r = await callFirebaseFallback(fb, firebaseFnName);
    emitPull('firebase', r);
    return r;
  }

  let hasChanges = false;
  let failure = false;
  for (const table of tables) {
    try {
      const res = await pullSupabaseTable(db, table);
      if (res.failed) { failure = true; continue; }
      hasChanges = hasChanges || res.hasChanges;
    } catch (err) {
      const why = isRlsDenialError(err) ? 'RLS/permission denial' : (err?.message || err);
      console.warn(`[SupabaseSync] table ${table} failed (${why}) → Firebase fallback`);
      failure = true;
      continue;
    }
  }

  if (failure) {
    supabasePrimaryHealthy = false;
    if (!ALLOW_AUTO_FIREBASE_READ) {
      // OWNER POLICY — no automatic Firebase reads: keep the local data as-is instead of
      // fetching the same data from Firestore. A manual pull covers the recovery.
      console.log(`[Firebase-Read] ${firebaseFnName} BLOCKED by policy — automatic Firebase reads disabled (Supabase read failed)`);
      recordSyncHeartbeat({ backend: 'supabase', kind: 'read' }).catch(() => {});
      return hasChanges;
    }
    const r = await callFirebaseFallback(fb, firebaseFnName);
    emitPull('firebase', r);
    recordSyncHeartbeat({ backend: 'firebase', kind: 'read' }).catch(() => {});
    return r;
  }
  supabasePrimaryHealthy = true;
  emitPull('supabase', hasChanges);
  recordSyncHeartbeat({ backend: 'supabase', kind: 'read' }).catch(() => {});
  return hasChanges;
}

// --- public sync functions (own concurrency guards) --------------------------
let isSupabasePullingTables = false;
let isSupabasePullingHigh = false;
let isSupabasePullingDeletions = false;
let isSupabasePullingLow = false;
let isSupabasePullingMenu = false;

/** restaurant_tables — signal-driven by the caller: 30s safety poll while the Realtime
 *  channel is SUBSCRIBED, otherwise 5s (see App.js supabase-tables-poll). */
export async function syncSupabaseTables() {
  if (isSupabasePullingTables) return false;
  isSupabasePullingTables = true;
  try {
    return await runSupabaseGroup(SIGNAL_GROUPS.tables, 'syncTablesOnly');
  } catch (err) {
    console.warn('[SupabaseSync] syncSupabaseTables error (isolated):', err?.message || err);
    return false;
  } finally {
    isSupabasePullingTables = false;
  }
}

/** orders / order_items / payments / deliveries — signal-driven: 30s safety poll while
 *  SUBSCRIBED, otherwise 10s (see App.js supabase-high-frequency-poll). */
export async function syncSupabaseHighFrequencyCollections() {
  if (isSupabasePullingHigh) return false;
  isSupabasePullingHigh = true;
  try {
    return await runSupabaseGroup(SIGNAL_GROUPS.high, 'syncHighFrequencyCollections');
  } catch (err) {
    console.warn('[SupabaseSync] syncSupabaseHighFrequencyCollections error (isolated):', err?.message || err);
    return false;
  } finally {
    isSupabasePullingHigh = false;
  }
}

/** deletions tombstones — signal-driven: 30s safety poll while SUBSCRIBED, else 15s. */
export async function syncSupabaseDeletions() {
  if (isSupabasePullingDeletions) return false;
  isSupabasePullingDeletions = true;
  try {
    return await runSupabaseGroup(SIGNAL_GROUPS.deletions, 'syncDeletionsOnly');
  } catch (err) {
    console.warn('[SupabaseSync] syncSupabaseDeletions error (isolated):', err?.message || err);
    return false;
  } finally {
    isSupabasePullingDeletions = false;
  }
}

/** Low-frequency tables (profile lowFreq minus app_config) — scheduled 60s by the caller. */
export async function syncSupabaseLowFrequencyCollections() {
  if (isSupabasePullingLow) return false;
  isSupabasePullingLow = true;
  try {
    const fb = deps.getFirebase();
    const tables = getSupabaseLowFreqTables(fb);
    return await runSupabaseGroup(tables, 'syncLowFrequencyCollections');
  } catch (err) {
    console.warn('[SupabaseSync] syncSupabaseLowFrequencyCollections error (isolated):', err?.message || err);
    return false;
  } finally {
    isSupabasePullingLow = false;
  }
}

/** menu_items / menu_categories — scheduled 300s by the caller. */
export async function syncSupabaseMenu() {
  if (isSupabasePullingMenu) return false;
  isSupabasePullingMenu = true;
  try {
    return await runSupabaseGroup(['menu_items', 'menu_categories'], 'syncMenuOnly');
  } catch (err) {
    console.warn('[SupabaseSync] syncSupabaseMenu error (isolated):', err?.message || err);
    return false;
  } finally {
    isSupabasePullingMenu = false;
  }
}

// --- fresh-install restore (transition-period aware) -------------------------

/**
 * Supabase data coverage in days, based on the oldest `orders.created_at`.
 * 0 when unconfigured/empty (→ transition mode).
 */
export async function getSupabaseCoverageDays() {
  try {
    if (!deps.isEnabled() || !deps.isConfigured()) return 0;
    const client = deps.getClient();
    if (!client) return 0;
    const { data, error } = await withTimeout(
      client.from('orders').select('created_at').order('created_at', { ascending: true }).limit(1),
      PULL_TIMEOUT_MS,
      'coverage'
    );
    if (error || !data || !data.length || !data[0].created_at) return 0;
    const oldest = new Date(data[0].created_at).getTime();
    if (!Number.isFinite(oldest)) return 0;
    return (Date.now() - oldest) / 86400000;
  } catch (_) {
    return 0;
  }
}

function stampSupabaseRestoreMarkers(db, tables) {
  const now = new Date().toISOString();
  for (const t of tables) {
    try {
      db.runSync("INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)", [`last_sync_time_supabase_${t}`, now]);
    } catch (_) {}
  }
}

/**
 * Users bootstrap (fresh install) — Supabase-primary.
 *
 * Reads `public.users` (role-filtered) and inserts into local SQLite with the same
 * Schema-Guardian rules as the pull merge. `users` is DEVICE-GATED by RLS, so this
 * succeeds for an ACTIVE device and returns 0 rows for a PENDING one — the caller
 * then falls back to the Firebase pre-approval path.
 *
 * Returns { success, count, error? }.
 */
export async function restoreUsersFromSupabase(roles = []) {
  const wanted = Array.isArray(roles) && roles.length ? roles : null;
  if (!wanted) return { success: false, count: 0, error: 'no roles' };
  if (!deps.isEnabled() || !deps.isConfigured()) return { success: false, count: 0, error: 'supabase disabled' };

  let db = null;
  try { db = deps.getDb(); } catch (_) { db = null; }
  if (!db) return { success: false, count: 0, error: 'no db' };

  try {
    const client = deps.getClient();
    if (!client) return { success: false, count: 0, error: 'no client' };

    let q = client.from('users').select('*');
    if (typeof q.in === 'function') q = q.in('role', wanted);
    const { data, error } = await withTimeout(q, 8000, 'users bootstrap (supabase)');
    if (error || !Array.isArray(data) || data.length === 0) {
      return { success: false, count: 0, error: error?.message || 'no rows' };
    }

    let validColumns = [];
    try { validColumns = db.getAllSync('PRAGMA table_info(users)').map((c) => c.name); }
    catch (_) { return { success: false, count: 0, error: 'schema read failed' }; }

    let inserted = 0;
    for (const row of data) {
      const filtered = {};
      for (const key of Object.keys(row)) {
        if (validColumns.includes(key) && key !== 'is_synced' && key !== 'is_synced_supabase') {
          filtered[key] = row[key];
        }
      }
      const keys = Object.keys(filtered);
      if (keys.length === 0) continue;
      const cols = keys.slice();
      const vals = keys.map((k) => filtered[k]);
      if (validColumns.includes('is_synced')) { cols.push('is_synced'); vals.push(1); }
      if (validColumns.includes('is_synced_supabase')) { cols.push('is_synced_supabase'); vals.push(1); }
      try {
        db.runSync(`INSERT OR REPLACE INTO users (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, vals);
        inserted++;
      } catch (e) {
        console.warn('[SupabaseSync] users bootstrap: skipped a row:', e?.message || e);
      }
    }
    return { success: inserted > 0, count: inserted };
  } catch (err) {
    return { success: false, count: 0, error: err?.message || String(err) };
  }
}

/**
 * Fresh-install restore from Supabase.
 *
 * Scope comes from ONE source of truth (`getRestoreMode` on the db module):
 *   MANAGER       → running business day only
 *   ADMIN / OWNER → last 31 days
 *   unresolved '' → running business day only (fail-conservative)
 *
 * MASTER data (menu_items, menu_categories, restaurant_tables) is pulled in full —
 * it is required to operate. Everything TRANSACTIONAL (orders, order_items,
 * payments, expenses, deliveries, due_payments, eja_history, … AND daily_submit /
 * daily_summary) is date-bounded to the restore window. Firebase is used by the
 * CALLER (`restoreHybridDatabaseFromCloud`) as the fallback when this returns
 * `success:false`.
 */
export async function restoreSupabaseWindow({ profileName, mode } = {}) {
  const fb = deps.getFirebase();
  let db = null;
  try { db = deps.getDb(); } catch (_) { db = null; }
  if (!db) return { success: false, failedCollections: ['supabase-restore'], rowsWritten: 0 };

  // Fail-conservative: an unresolved build profile must never widen the scope.
  const resolvedName = fb.APP_PROFILE_RESOLVED === false ? '' : profileName;
  const profiles = fb.APP_PROFILES || {};
  const profile = profiles[resolvedName] || profiles.ADMIN || { recentOnly: [] };

  const restoreMode = mode || (typeof fb.getRestoreMode === 'function'
    ? fb.getRestoreMode(resolvedName)
    : (String(resolvedName).toUpperCase().trim() === 'MANAGER' ? 'today' : '31d'));

  const txTables = (profile.recentOnly || []).filter((t) => t !== 'daily_submit' && t !== 'daily_summary');
  // daily_submit / daily_summary are TRANSACTIONAL per-day rows → windowed (NOT full).
  const windowedTables = [...txTables, 'daily_submit', 'daily_summary'];
  // Master/reference data → always full (needed to operate).
  const masterTables = ['restaurant_tables', 'menu_items', 'menu_categories'];

  const sinceIso = restoreMode === 'today'
    ? new Date(`${fb.getBusinessDate()}T00:00:00`).toISOString()
    : new Date(Date.now() - 31 * 86400000).toISOString();

  const failedCollections = [];
  let rowsWritten = 0;

  // 1. Master tables — full snapshot.
  for (const table of masterTables) {
    try {
      const col = getSupabaseCursorColumn(db, table);
      const rows = await fetchSupabaseRows(db, table, col, null);
      mergeSupabaseRows(db, table, rows);
      rowsWritten += rows.length;
    } catch (err) {
      failedCollections.push(table);
    }
  }

  // 2. Transactional window (incl. daily_submit/daily_summary) — date-bounded.
  for (const table of windowedTables) {
    try {
      const col = getSupabaseCursorColumn(db, table);
      const rows = await fetchSupabaseRows(db, table, col, sinceIso);
      mergeSupabaseRows(db, table, rows);
      rowsWritten += rows.length;
    } catch (err) {
      failedCollections.push(table);
    }
  }

  // 3. Stamp cursors for the WHOLE profile set (not just what we restored) so the
  //    first periodic polls don't fall back to a full-collection fetch.
  const markerTables = Array.from(new Set([
    ...masterTables,
    ...windowedTables,
    ...(profile.alwaysFull || []),
    ...(profile.recentOnly || []),
    ...(profile.skipRestoreMarkers || [])
  ]));
  stampSupabaseRestoreMarkers(db, markerTables);

  console.log(`[SupabaseSync] restoreSupabaseWindow profile=${resolvedName || '<unresolved>'} mode=${restoreMode} since=${sinceIso} master=${masterTables.length} windowed=${windowedTables.length} rows=${rowsWritten} failed=${failedCollections.length}`);

  return { success: failedCollections.length === 0, failedCollections, rowsWritten };
}

/**
 * Fresh-install restore orchestrator (Phase 3 transition decision):
 *  - While Supabase coverage < 31 days → running-day-only FROM FIREBASE.
 *  - Once coverage ≥ 31 days → Supabase restore (Admin/Owner 31d, Manager today);
 *    menu + daily_submit/daily_summary always from Firebase; on empty/failure →
 *    running-day-only Firebase fallback.
 * Never throws.
 */
export async function restoreHybridDatabaseFromCloud({ mode = 'today' } = {}) {
  let fb = null;
  try {
    fb = deps.getFirebase();
  } catch (_) {
    return { success: false, failedCollections: ['restore-hybrid'] };
  }

  try {
    if (!deps.isEnabled() || !deps.isConfigured()) {
      return await fb.restoreDatabaseFromCloud({ mode: 'today' });
    }

    const coverageDays = await getSupabaseCoverageDays();
    if (!(coverageDays >= 31)) {
      // TRANSITION: running-day from Firebase only (skip the old full-31-day restore).
      return await fb.restoreDatabaseFromCloud({ mode: 'today' });
    }

    // Fail-conservative: an unresolved build profile must never widen the scope.
    const resolved = fb.APP_PROFILE_RESOLVED !== false;
    const profileName = resolved ? (fb.ACTIVE_APP_PROFILE || 'ADMIN') : '';
    const mode = typeof fb.getRestoreMode === 'function'
      ? fb.getRestoreMode(profileName)
      : (String(profileName).toUpperCase().trim() === 'MANAGER' ? 'today' : '31d');
    console.log(`[SupabaseSync] hybrid restore profile=${profileName || '<unresolved>'} mode=${mode}`);

    let res = { success: false, rowsWritten: 0, failedCollections: ['supabase-restore'] };
    try {
      res = await restoreSupabaseWindow({ profileName, mode });
    } catch (err) {
      res = { success: false, rowsWritten: 0, failedCollections: ['supabase-restore'] };
    }

    if (res && res.success && (res.rowsWritten || 0) > 0) return res;
    // Empty/failed Supabase restore → running-day-only Firebase fallback.
    return await fb.restoreDatabaseFromCloud({ mode: 'today' });
  } catch (err) {
    console.warn('[SupabaseSync] restoreHybrid error (isolated):', err?.message || err);
    return { success: false, failedCollections: ['restore-hybrid'] };
  }
}
