/**
 * supabaseHeartbeat.js — sync OBSERVABILITY (self-reported, never blocking).
 * ---------------------------------------------------------------------------
 * Records, per device × backend × kind, when the app last successfully PUSHED to /
 * READ from each cloud, into Supabase `public.sync_heartbeat`. Purpose: from
 * Supabase Studio you can answer "is Firebase really being pushed to?" and "is
 * Supabase or Firebase lagging?" without opening the Firebase console.
 *
 * Rules:
 *  - Throttled (default 60s per backend+kind) → negligible Supabase write load.
 *  - NEVER throws and NEVER blocks sync; every failure is swallowed.
 *  - Self-reported: the app says "I last wrote to X at T". It does not query Firebase.
 */

import {
  getSupabaseClient,
  isSupabaseConfigured,
  isSupabaseSyncEnabled,
  withTimeout
} from './supabaseClient.js';

const THROTTLE_MS = (() => {
  const n = Number(process.env.EXPO_PUBLIC_HEARTBEAT_THROTTLE_MS);
  return Number.isFinite(n) && n > 0 ? n : 60000;
})();

function defaultGetDb() {
  try { return require('../database.js').getDb(); } catch (_) { return null; }
}
function defaultGetDeviceId() {
  try {
    const db = defaultGetDb();
    if (!db) return '';
    const row = db.getFirstSync("SELECT value FROM app_config WHERE key = 'persistent_device_id'");
    return (row && row.value) || '';
  } catch (_) { return ''; }
}
function defaultGetProfile() {
  try { return require('../database.js').ACTIVE_APP_PROFILE || ''; } catch (_) { return ''; }
}
function defaultGetAppVersion() {
  try { return require('../app.json').expo?.version || ''; } catch (_) { return ''; }
}

function defaultReadQueueCounts(queueTable) {
  try {
    const db = defaultGetDb();
    if (!db) return null;
    const rows = db.getAllSync(
      `SELECT table_name, COUNT(*) c FROM ${queueTable} WHERE status IN ('PENDING','FAILED') GROUP BY table_name`
    ) || [];
    const out = {};
    for (const r of rows) {
      if (!r || !r.table_name) continue;
      out[r.table_name] = (out[r.table_name] || 0) + (Number(r.c) || 0);
    }
    return out;
  } catch (_) {
    return null;
  }
}

const productionDeps = {
  isEnabled: isSupabaseSyncEnabled,
  isConfigured: isSupabaseConfigured,
  getClient: getSupabaseClient,
  getDeviceId: defaultGetDeviceId,
  getProfile: defaultGetProfile,
  getAppVersion: defaultGetAppVersion,
  readQueueCounts: defaultReadQueueCounts
};
let deps = { ...productionDeps };

export function __setHeartbeatDepsForTesting(overrides = {}) {
  deps = { ...deps, ...overrides };
}
export function __resetHeartbeatDepsForTesting() {
  deps = { ...productionDeps };
}

// backend:kind → last sent ms (per-process throttle). Reserved-name safe key.
const lastSentAt = {};
export function __resetHeartbeatThrottleForTesting() {
  for (const k of Object.keys(lastSentAt)) delete lastSentAt[k];
}

/**
 * @param {object} evt
 * @param {'firebase'|'supabase'} evt.backend
 * @param {'push'|'read'} evt.kind
 * @param {number|null} [evt.rows]      rows written/read this cycle
 * @param {boolean} [evt.ok]
 * @param {string|null} [evt.error]
 * @param {'sync_queue'|'sync_queue_supabase'|null} [evt.includeTables] read this queue
 *        and publish the per-table unsent counts (so OTHER devices can see them)
 * @param {boolean} [evt.force]        bypass the throttle (tests / manual)
 * @returns {Promise<boolean>} whether a heartbeat row was written
 */
export async function recordSyncHeartbeat({ backend, kind, rows = null, ok = true, error = null, includeTables = null, force = false } = {}) {
  try {
    if (!backend || !kind) return false;
    if (!deps.isEnabled() || !deps.isConfigured()) return false;

    const key = `${backend}:${kind}`;
    const now = Date.now();
    if (!force && lastSentAt[key] && now - lastSentAt[key] < THROTTLE_MS) return false;

    const client = deps.getClient();
    const deviceId = deps.getDeviceId();
    if (!client || !deviceId) return false;

    lastSentAt[key] = now; // mark BEFORE the await so concurrent callers don't stampede

    const iso = new Date(now).toISOString();
    const row = {
      device_id: String(deviceId),
      backend: String(backend),
      app_profile: String(deps.getProfile() || ''),
      app_version: String(deps.getAppVersion() || ''),
      updated_at: iso
    };
    if (kind === 'push') {
      row.last_push_at = iso;
      row.last_push_ok = ok !== false;
      row.last_error = error ? String(error).slice(0, 300) : null;
      if (includeTables) {
        const counts = deps.readQueueCounts(includeTables);
        row.pending_tables = counts && Object.keys(counts).length ? counts : null;
      }
    } else {
      row.last_read_at = iso;
      row.last_rows = rows == null ? null : Number(rows) || 0;
    }

    // Attach THIS device's current realtime signal health, so the "Normal flow" card refreshes
    // it on every heartbeat (not only on the one-time channel event).
    if (String(backend).toLowerCase().startsWith('supabase')) {
      try {
        const rs = require('./realtimeSignal.js');
        // Always attach (no kill-switch gate): subscribed → true, else false. So the card never
        // shows "no info" once this build is running.
        if (typeof rs.isSignalSubscribed === 'function') row.realtime_ok = !!rs.isSignalSubscribed();
        if (typeof rs.getSignalMode === 'function') row.realtime_mode = String(rs.getSignalMode('tables') || '');
        console.log(`[Heartbeat] realtime attach ok=${row.realtime_ok} mode=${row.realtime_mode}`);
      } catch (e) {
        console.log(`[Heartbeat] realtime attach failed: ${e && e.message}`);
      }
    }

    let { error: upErr } = await withTimeout(
      client.from('sync_heartbeat').upsert(row, { onConflict: 'device_id,backend' }),
      6000,
      'sync heartbeat'
    );
    // If the realtime_* columns are not migrated on this project yet, they would reject the
    // WHOLE row (killing push/read heartbeats). Retry without them so the rest still lands.
    if (upErr && row.realtime_ok !== undefined && looksLikeUnknownColumn(upErr)) {
      delete row.realtime_ok;
      delete row.realtime_mode;
      ({ error: upErr } = await withTimeout(
        client.from('sync_heartbeat').upsert(row, { onConflict: 'device_id,backend' }),
        6000,
        'sync heartbeat (retry)'
      ));
    }
    if (upErr) {
      console.warn('[Heartbeat] upsert failed (isolated):', upErr.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[Heartbeat] isolated error:', err?.message || err);
    return false;
  }
}

/** Read helper (Admin screens / diagnostics). Never throws. */
export async function fetchSyncHeartbeats() {
  try {
    if (!deps.isEnabled() || !deps.isConfigured()) return { success: false, rows: [] };
    const client = deps.getClient();
    if (!client) return { success: false, rows: [] };
    const { data, error } = await withTimeout(
      client.from('sync_heartbeat').select('*').order('updated_at', { ascending: false }).limit(50),
      6000,
      'sync heartbeat read'
    );
    if (error) return { success: false, rows: [], error: error.message };
    return { success: true, rows: Array.isArray(data) ? data : [] };
  } catch (err) {
    return { success: false, rows: [], error: err?.message || String(err) };
  }
}

/** PostgREST "no such column" (the realtime_* columns not migrated yet). */
function looksLikeUnknownColumn(err) {
  const code = String((err && err.code) || '');
  const msg = String((err && (err.message || err)) || '').toLowerCase();
  if (code === 'PGRST205' || msg.includes('could not find the table')) return false;
  if (code === 'PGRST204') return true;
  return msg.includes('column') && (msg.includes('does not exist') || msg.includes('could not find') || msg.includes('schema cache'));
}

/**
 * Report THIS device's Realtime signal-channel health (per device, into the `supabase1`
 * heartbeat row). Partial upsert — it only touches realtime_ok / realtime_mode, never the
 * push/read columns. Never throws; a missing column (old schema) is silently skipped.
 */
export async function recordRealtimeHealth({ ok = true, mode = '' } = {}) {
  try {
    if (!deps.isEnabled() || !deps.isConfigured()) return false;
    const client = deps.getClient();
    const deviceId = deps.getDeviceId();
    if (!client || !deviceId) return false;

    const row = {
      device_id: String(deviceId),
      backend: 'supabase', // SAME backend value the push/read heartbeats use (one row per device)
      realtime_ok: ok !== false,
      realtime_mode: String(mode || ''),
      updated_at: new Date().toISOString()
    };
    const { error } = await withTimeout(
      client.from('sync_heartbeat').upsert(row, { onConflict: 'device_id,backend' }),
      6000,
      'realtime heartbeat'
    );
    if (error) {
      if (!looksLikeUnknownColumn(error)) console.warn('[Heartbeat] realtime report failed (isolated):', error.message);
      return false;
    }
    return true;
  } catch (err) {
    return false;
  }
}
