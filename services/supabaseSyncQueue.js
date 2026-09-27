/**
 * Supabase Dual-Write Sync Queue (Phase 2)
 * ---------------------------------------------------------------------------
 * An INDEPENDENT mirror of the Firebase `sync_queue`. Every POS write still
 * enqueues to Firebase first (untouched); `enqueueSync()` additionally calls
 * `enqueueSupabaseSync()` here so the same row is later mirrored to Supabase.
 *
 * Isolation guarantees:
 *  - This module NEVER throws out of its public functions; all errors are caught
 *    and logged. A Supabase failure can never affect the Firebase sync path.
 *  - Firebase enqueue runs BEFORE this module is invoked, so a failure here has
 *    no effect on the Firebase queue.
 *  - When Supabase is unconfigured (`isSupabaseConfigured()` false) or the
 *    kill switch is off (`isSupabaseSyncEnabled()` false), everything no-ops.
 */

import {
  getSupabaseClient,
  isSupabaseConfigured,
  isSupabaseSyncEnabled,
  withTimeout,
  readHeaderFrom,
  SUPABASE_TIMEOUT_MS
} from './supabaseClient.js';
import { remotePriorityWins } from './dailySubmitPriority.js';

const MAX_FAILED_RETRY_DELAY_MS = 10 * 60 * 1000;
const BATCH_LIMIT = 20;
const DAEMON_INTERVAL_MS = 5000;

// Tables that must never be mirrored to Supabase.
const LOCAL_ONLY_TABLES = ['ai_dataset_queue', 'ai_dataset_history', 'weather_timeline_queue'];
// `app_config` is Firebase-only (dual-use: version policy + deletion tombstones).
// Supabase has a real `deletions` table, so nothing from app_config is mirrored.
const EXCLUDED_TABLES = ['app_config'];

let supabaseSyncIntervalId = null;
let isProcessingSupabaseQueue = false;

// --- dependency seams (production defaults; overridable in unit tests) --------
function defaultGetDb() {
  const { getDb } = require('../database.js');
  return getDb();
}

function defaultIsEnabled() {
  return isSupabaseSyncEnabled();
}

function defaultIsConfigured() {
  return isSupabaseConfigured();
}

function defaultGetClient() {
  return getSupabaseClient();
}

const productionDeps = {
  isEnabled: defaultIsEnabled,
  isConfigured: defaultIsConfigured,
  getClient: defaultGetClient,
  getDb: defaultGetDb
};

let deps = { ...productionDeps };

export function __setSupabaseSyncDepsForTesting(overrides = {}) {
  deps = { ...deps, ...overrides };
}

export function __resetSupabaseSyncDepsForTesting() {
  deps = { ...productionDeps };
}

// --- pure helpers ------------------------------------------------------------

/**
 * The conflict/pk column for a table. Mirrors the special-casing already used by
 * the Firebase `processSyncQueue` (id vs date vs business_date).
 */
export function getSupabaseConflictKey(tableName) {
  if (tableName === 'daily_submit' || tableName === 'daily_summary') return 'date';
  if (tableName === 'daily_submit_priority') return 'business_date';
  return 'id';
}

/** Exponential backoff: min(10min, 2^retryCount * 30s). */
export function getSupabaseFailedRetryDelayMs(retryCount = 0) {
  const n = Math.max(0, Number(retryCount) || 0);
  return Math.min(MAX_FAILED_RETRY_DELAY_MS, Math.pow(2, n) * 30000);
}

function isFailedItemRetryDue(item, nowMs = Date.now()) {
  if (!item.last_attempt_at) return true;
  const last = new Date(item.last_attempt_at).getTime();
  if (!Number.isFinite(last)) return true;
  return nowMs - last >= getSupabaseFailedRetryDelayMs(item.retry_count || 0);
}

function isExcludedTable(tableName) {
  return LOCAL_ONLY_TABLES.includes(tableName) || EXCLUDED_TABLES.includes(tableName);
}

function readLocalRow(db, tableName, conflictKey, recordId) {
  if (conflictKey === 'date') {
    return db.getFirstSync(`SELECT * FROM ${tableName} WHERE date = ?`, [recordId]);
  }
  if (conflictKey === 'business_date') {
    return db.getFirstSync(`SELECT * FROM ${tableName} WHERE business_date = ?`, [recordId]);
  }
  return db.getFirstSync(`SELECT * FROM ${tableName} WHERE id = ?`, [recordId]);
}

async function performUpsert(client, tableName, conflictKey, row) {
  const payload = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === 'is_synced' || k === 'is_synced_supabase') continue; // SQLite-local only
    payload[k] = v === undefined ? null : v;
  }
  const { error } = await withTimeout(
    client.from(tableName).upsert(payload, { onConflict: conflictKey }),
    SUPABASE_TIMEOUT_MS,
    `upsert ${tableName}`
  );
  if (error) {
    // Diagnostic: log the ACTUAL outgoing X-Device-Id at the moment of failure so
    // an RLS/permission rejection can be traced to a missing/mismatched header.
    let sentDeviceId = null;
    try {
      sentDeviceId = readHeaderFrom(client && client.rest && client.rest.headers, 'x-device-id');
    } catch (_) {}
    console.warn(
      `[SupabaseSyncQueue] upsert ${tableName} error:`,
      error.message,
      `| outgoing x-device-id=${JSON.stringify(sentDeviceId)}`
    );
    return false;
  }
  return true;
}

/**
 * Phase 4: mirror of the Firebase `processSyncQueue` same-role conflict check.
 * Reads the cloud `daily_submit_priority` row for this business date and, when
 * it outranks the local one (higher priority, else later `submitted_at`, else
 * greater `device_id`), signals that the local `daily_submit` upsert must be
 * skipped. Never throws — on any error the push proceeds (fail-open, exactly
 * like the Firebase path).
 */
async function shouldSkipDailySubmit(client, db, businessDate) {
  const local = db.getFirstSync(
    "SELECT * FROM daily_submit_priority WHERE business_date = ?",
    [businessDate]
  );
  const { data, error } = await withTimeout(
    client
      .from('daily_submit_priority')
      .select('priority, submitted_at, device_id, sync_source_device')
      .eq('business_date', businessDate)
      .maybeSingle(),
    SUPABASE_TIMEOUT_MS,
    'select daily_submit_priority'
  );
  if (error || !data) return false;
  return remotePriorityWins(local || { priority: 10 }, data);
}

async function performDelete(client, tableName, conflictKey, recordId) {
  const { error } = await withTimeout(
    client.from(tableName).delete().eq(conflictKey, recordId),
    SUPABASE_TIMEOUT_MS,
    `delete ${tableName}`
  );
  if (error) {
    console.warn(`[SupabaseSyncQueue] delete ${tableName} error:`, error.message);
    return false;
  }
  return true;
}

// --- public API --------------------------------------------------------------

/**
 * Enqueue a parallel Supabase write for a row that was just enqueued to Firebase.
 * Never throws. Returns true if a queue row was written, false otherwise.
 */
export function enqueueSupabaseSync(tableName, recordId, action) {
  try {
    if (!deps.isEnabled()) return false;
    if (!deps.isConfigured()) return false;
    if (!tableName || recordId === null || recordId === undefined) return false;
    if (isExcludedTable(tableName)) return false;
    // SECURITY GUARD: never mirror auth credentials.
    if (String(recordId).startsWith('_fb_auth_')) return false;

    const db = deps.getDb();
    if (!db) return false;

    // Idempotent: collapse any existing pending write for this record.
    db.runSync(
      "DELETE FROM sync_queue_supabase WHERE record_id = ? AND table_name = ? AND status = 'PENDING'",
      [recordId, tableName]
    );
    db.runSync(
      "INSERT INTO sync_queue_supabase (record_id, table_name, action, status, created_at) VALUES (?, ?, ?, 'PENDING', ?)",
      [recordId, tableName, action, new Date().toISOString()]
    );
    return true;
  } catch (err) {
    console.warn('[SupabaseSyncQueue] enqueue failed (isolated):', err?.message || err);
    return false;
  }
}

/**
 * Process the Supabase queue: up to BATCH_LIMIT PENDING items, then backoff-gated
 * FAILED items. Never throws; returns { successfulWrites, failedWrites }.
 */
export async function processSupabaseSyncQueue(singleRecordId = null, singleTableName = null) {
  const empty = { successfulWrites: 0, failedWrites: 0 };

  try {
    if (!deps.isEnabled()) return empty;
    if (!deps.isConfigured()) return empty;
    if (isProcessingSupabaseQueue && !singleRecordId) return empty;

    const db = deps.getDb();
    if (!db) return empty;

    if (!singleRecordId) isProcessingSupabaseQueue = true;

    const runProcessor = async () => {
      let successfulWrites = 0;
      let failedWrites = 0;

      let items = [];
      if (singleRecordId && singleTableName) {
        items = db.getAllSync(
          "SELECT * FROM sync_queue_supabase WHERE record_id = ? AND table_name = ? AND (status = 'PENDING' OR status = 'FAILED') ORDER BY status DESC, id ASC",
          [String(singleRecordId), singleTableName]
        );
      } else {
        items = db.getAllSync(
          "SELECT * FROM sync_queue_supabase WHERE status = 'PENDING' ORDER BY id ASC LIMIT ?",
          [BATCH_LIMIT]
        );
        if (items.length < BATCH_LIMIT) {
          const failedCandidates = db.getAllSync(
            "SELECT * FROM sync_queue_supabase WHERE status = 'FAILED' ORDER BY id ASC LIMIT 100"
          );
          const nowMs = Date.now();
          const retryDue = failedCandidates.filter((item) => isFailedItemRetryDue(item, nowMs));
          items = items.concat(retryDue.slice(0, BATCH_LIMIT - items.length));
        }
      }

      for (const item of items) {
        const { id: queueId, record_id: recordId, table_name: tableName, action } = item;
        if (!queueId) continue;

        // Purge excluded/invalid items so they never accumulate.
        if (isExcludedTable(tableName) || !tableName || recordId === null || recordId === undefined) {
          db.runSync("DELETE FROM sync_queue_supabase WHERE id = ?", [Number(queueId)]);
          continue;
        }

        const attemptAt = new Date().toISOString();
        const currentRetry = Number(item.retry_count || 0);
        db.runSync(
          "UPDATE sync_queue_supabase SET last_attempt_at = ?, retry_count = ? WHERE id = ?",
          [attemptAt, currentRetry + 1, Number(queueId)]
        );

        try {
          const client = deps.getClient();
          if (!client) throw new Error('Supabase client unavailable');

          const conflictKey = getSupabaseConflictKey(tableName);
          const rIdStr = String(recordId);

          let ok = false;
          if (action === 'DELETE') {
            ok = await performDelete(client, tableName, conflictKey, rIdStr);
          } else {
            const row = readLocalRow(db, tableName, conflictKey, rIdStr);
            if (!row) {
              // Deleted locally before push — drop the queue item.
              db.runSync("DELETE FROM sync_queue_supabase WHERE id = ?", [Number(queueId)]);
              successfulWrites++;
              continue;
            }

            // Priority Conflict Resolution Check (identical to the Firebase path).
            if (tableName === 'daily_submit') {
              try {
                if (await shouldSkipDailySubmit(client, db, rIdStr)) {
                  console.log(`[SupabaseSyncQueue] Remote daily_submit priority wins for ${rIdStr}; skipping upload.`);
                  db.runSync("DELETE FROM sync_queue_supabase WHERE id = ?", [Number(queueId)]);
                  successfulWrites++;
                  continue;
                }
              } catch (err) {
                console.warn('[SupabaseSyncQueue] priority conflict check failed (fail-open):', err?.message || err);
              }
            }

            ok = await performUpsert(client, tableName, conflictKey, row);
          }

          if (ok) {
            // Phase 7.2: mark the record as Supabase-synced (per-backend flag).
            try {
              db.runSync(
                `UPDATE ${tableName} SET is_synced_supabase = 1 WHERE ${getSupabaseConflictKey(tableName)} = ?`,
                [String(recordId)]
              );
            } catch (_) {}
            db.runSync("DELETE FROM sync_queue_supabase WHERE id = ?", [Number(queueId)]);
            successfulWrites++;
          } else {
            db.runSync(
              "UPDATE sync_queue_supabase SET status = 'FAILED', last_error = ? WHERE id = ?",
              ['Supabase write returned an error', Number(queueId)]
            );
            failedWrites++;
          }
        } catch (err) {
          db.runSync(
            "UPDATE sync_queue_supabase SET status = 'FAILED', last_error = ? WHERE id = ?",
            [String(err?.message || err), Number(queueId)]
          );
          console.warn(
            `[SupabaseSyncQueue] FAIL queueId=${queueId} table=${tableName} recordId=${recordId} retry=${currentRetry + 1} error=${err?.message || err}`
          );
          failedWrites++;
        }
      }

      // Observability heartbeat (isolated + throttled): proves Supabase pushes happen.
      try {
        const { recordSyncHeartbeat } = require('./supabaseHeartbeat.js');
        recordSyncHeartbeat({ backend: 'supabase', kind: 'push', rows: successfulWrites, ok: failedWrites === 0, includeTables: 'sync_queue_supabase' }).catch(() => {});
      } catch (_) {}

      return { successfulWrites, failedWrites };
    };

    return await runProcessor();
  } catch (err) {
    console.warn('[SupabaseSyncQueue] daemon error (isolated):', err?.message || err);
    return empty;
  } finally {
    if (!singleRecordId) isProcessingSupabaseQueue = false;
  }
}

function isAppActive() {
  try {
    const { AppState } = require('react-native');
    return !AppState || AppState.currentState === 'active';
  } catch (_) {
    return true;
  }
}

/**
 * Start the independent Supabase dual-write daemon (5s, mirrors startSyncService).
 */
export function startSupabaseSyncService() {
  if (supabaseSyncIntervalId) return;
  console.log('[SupabaseSyncQueue] Starting Supabase dual-write daemon (5s)...');
  supabaseSyncIntervalId = setInterval(async () => {
    try {
      if (!isAppActive()) return;
      if (isProcessingSupabaseQueue) return;
      await processSupabaseSyncQueue();
    } catch (err) {
      console.warn('[SupabaseSyncQueue] daemon tick error (isolated):', err?.message || err);
    }
  }, DAEMON_INTERVAL_MS);
}

export function stopSupabaseSyncService() {
  if (supabaseSyncIntervalId) {
    clearInterval(supabaseSyncIntervalId);
    supabaseSyncIntervalId = null;
  }
}

export function isSupabaseSyncServiceRunning() {
  return supabaseSyncIntervalId !== null;
}

/**
 * Immediate single-record push (mirror of syncRecordImmediately). Never throws.
 */
export async function syncSupabaseRecordImmediately(tableName, recordId) {
  try {
    const res = await processSupabaseSyncQueue(recordId, tableName);
    return res.successfulWrites > 0;
  } catch (_) {
    return false;
  }
}
