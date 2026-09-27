/**
 * Supabase-primary PULL sync (Phase 3)
 * ---------------------------------------------------------------------------
 * Mirrors the Firebase pull engine but sources rows from Supabase first.
 * The existing Firebase timers (15s/30s/90s/180s) stay running untouched; on ANY
 * Supabase failure/timeout the matching Firebase sync function is invoked as a
 * fallback in the SAME tick, so the local DB always converges.
 *
 * Isolation: nothing here throws out of a public function. Lazy `require` of
 * database.js keeps this module importable in plain Node (unit tests).
 *
 * daily_submit / daily_summary are NEVER pulled from Supabase (Firebase-only).
 * restaurant_tables uses polling (caller schedules ~2s) — NOT Realtime.
 */

import {
  getSupabaseClient,
  isSupabaseConfigured,
  isSupabaseSyncEnabled,
  withTimeout
} from './supabaseClient.js';

const OVERLAP_MS = 60000;          // re-read window to absorb clock drift / eventual consistency
const MARKER_SAFETY_MS = 15000;    // never advance a cursor past queryStart - 15s
const PAGE_SIZE = 1000;            // PostgREST default max rows per request
const PULL_TIMEOUT_MS = (() => {
  const n = Number(process.env.EXPO_PUBLIC_SUPABASE_PULL_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 8000;
})();

const RESTAURANT_TABLE_IDS = ['table_1', 'table_2', 'table_3', 'table_4', 'table_5', 'table_6', 'table_7', 'table_8'];
const LOW_FREQ_EXCLUDED = ['app_config', 'daily_submit', 'daily_summary'];

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
      deleteTargetRow(db, row.table_name, row.record_id);
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
      } else if (localRow.is_synced === 0) {
        // Preserve pending local edits; newer cloud data (handled above) may still repair them.
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
      if (validColumns.includes(key) && key !== 'is_synced') {
        filteredRow[key] = normalizeValue(row[key]);
      }
    }
    const keys = Object.keys(filteredRow);
    if (keys.length === 0) continue;

    const placeholders = keys.map(() => '?').join(', ');
    const sql = validColumns.includes('is_synced')
      ? `INSERT OR REPLACE INTO ${table} (${keys.join(', ')}, is_synced) VALUES (${placeholders}, 1)`
      : `INSERT OR REPLACE INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`;

    try {
      db.runSync(sql, keys.map((k) => filteredRow[k]));
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

  const rows = [];
  let offset = 0;
  // Bounded pagination (PostgREST caps a single response at ~1000 rows).
  for (let page = 0; page < 50; page++) {
    let q = client.from(table).select('*');
    if (marker) q = q.gt(cursorCol, marker);
    q = q.order(cursorCol, { ascending: true }).range(offset, offset + PAGE_SIZE - 1);
    const { data, error } = await withTimeout(q, PULL_TIMEOUT_MS, `pull ${table}`);
    if (error) throw new Error(error.message || 'supabase pull error');
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
  if (!deps.isEnabled()) return false; // kill switch → no-op (Firebase timers still run)

  const fb = deps.getFirebase();
  if (!deps.isConfigured()) {
    return await callFirebaseFallback(fb, firebaseFnName); // dormant → Firebase fallback
  }

  let db = null;
  try {
    db = deps.getDb();
  } catch (_) {
    db = null;
  }
  if (!db) return await callFirebaseFallback(fb, firebaseFnName);

  let hasChanges = false;
  let failure = false;
  for (const table of tables) {
    try {
      const res = await pullSupabaseTable(db, table);
      if (res.failed) { failure = true; break; }
      hasChanges = hasChanges || res.hasChanges;
    } catch (err) {
      console.warn(`[SupabaseSync] table ${table} failed (${err?.message || err}) → Firebase fallback`);
      failure = true;
      break;
    }
  }

  if (failure) return await callFirebaseFallback(fb, firebaseFnName);
  return hasChanges;
}

// --- public sync functions (own concurrency guards) --------------------------
let isSupabasePullingTables = false;
let isSupabasePullingHigh = false;
let isSupabasePullingDeletions = false;
let isSupabasePullingLow = false;

/** restaurant_tables — scheduled ~2s by the caller (polling, NOT Realtime). */
export async function syncSupabaseTables() {
  if (isSupabasePullingTables) return false;
  isSupabasePullingTables = true;
  try {
    return await runSupabaseGroup(['restaurant_tables'], 'syncTablesOnly');
  } catch (err) {
    console.warn('[SupabaseSync] syncSupabaseTables error (isolated):', err?.message || err);
    return false;
  } finally {
    isSupabasePullingTables = false;
  }
}

/** orders / order_items / payments / deliveries — scheduled 8s by the caller. */
export async function syncSupabaseHighFrequencyCollections() {
  if (isSupabasePullingHigh) return false;
  isSupabasePullingHigh = true;
  try {
    return await runSupabaseGroup(['orders', 'order_items', 'payments', 'deliveries'], 'syncHighFrequencyCollections');
  } catch (err) {
    console.warn('[SupabaseSync] syncSupabaseHighFrequencyCollections error (isolated):', err?.message || err);
    return false;
  } finally {
    isSupabasePullingHigh = false;
  }
}

/** deletions tombstones — scheduled 20s by the caller. */
export async function syncSupabaseDeletions() {
  if (isSupabasePullingDeletions) return false;
  isSupabasePullingDeletions = true;
  try {
    return await runSupabaseGroup(['deletions'], 'syncDeletionsOnly');
  } catch (err) {
    console.warn('[SupabaseSync] syncSupabaseDeletions error (isolated):', err?.message || err);
    return false;
  } finally {
    isSupabasePullingDeletions = false;
  }
}

/** Low-frequency tables (profile lowFreq minus app_config/daily_submit/daily_summary) — 60s. */
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
 * Restore from Supabase: restaurant_tables in full + transactional tables for the
 * window. Menu + daily_submit/daily_summary are always pulled from Firebase.
 */
export async function restoreSupabaseWindow({ profileName, mode = '31d' } = {}) {
  const fb = deps.getFirebase();
  let db = null;
  try { db = deps.getDb(); } catch (_) { db = null; }
  if (!db) return { success: false, failedCollections: ['supabase-restore'], rowsWritten: 0 };

  const profiles = fb.APP_PROFILES || {};
  const profile = profiles[profileName] || profiles.ADMIN || { recentOnly: [] };
  const txTables = (profile.recentOnly || []).filter((t) => t !== 'daily_submit' && t !== 'daily_summary');

  const sinceIso = mode === 'today'
    ? new Date(`${fb.getBusinessDate()}T00:00:00`).toISOString()
    : new Date(Date.now() - 31 * 86400000).toISOString();

  const failedCollections = [];
  let rowsWritten = 0;

  // restaurant_tables — full snapshot.
  try {
    const rows = await fetchSupabaseRows(db, 'restaurant_tables', getSupabaseCursorColumn(db, 'restaurant_tables'), null);
    mergeSupabaseRows(db, 'restaurant_tables', rows);
    rowsWritten += rows.length;
  } catch (err) {
    failedCollections.push('restaurant_tables');
  }

  // transactional window.
  for (const table of txTables) {
    try {
      const col = getSupabaseCursorColumn(db, table);
      const rows = await fetchSupabaseRows(db, table, col, sinceIso);
      mergeSupabaseRows(db, table, rows);
      rowsWritten += rows.length;
    } catch (err) {
      failedCollections.push(table);
    }
  }

  stampSupabaseRestoreMarkers(db, ['restaurant_tables', ...txTables]);

  // Firebase-only tables: menu + daily_submit/daily_summary.
  try {
    if (typeof fb.syncDailyAndMenuFromFirebase === 'function') {
      await fb.syncDailyAndMenuFromFirebase();
    } else if (typeof fb.syncMenuOnly === 'function') {
      await fb.syncMenuOnly();
    }
  } catch (err) {
    console.warn('[SupabaseSync] Firebase-only restore portion failed:', err?.message || err);
  }

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

    const profileName = fb.ACTIVE_APP_PROFILE || 'ADMIN';
    const isManager = String(profileName).toUpperCase().trim() === 'MANAGER';

    let res = { success: false, rowsWritten: 0, failedCollections: ['supabase-restore'] };
    try {
      res = await restoreSupabaseWindow({ profileName, mode: isManager ? 'today' : '31d' });
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
