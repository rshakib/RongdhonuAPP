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

const productionDeps = {
  isEnabled: isSupabaseSyncEnabled,
  isConfigured: isSupabaseConfigured,
  getClient: getSupabaseClient,
  getDeviceId: defaultGetDeviceId,
  getProfile: defaultGetProfile,
  getAppVersion: defaultGetAppVersion
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
 * @param {boolean} [evt.force]        bypass the throttle (tests / manual)
 * @returns {Promise<boolean>} whether a heartbeat row was written
 */
export async function recordSyncHeartbeat({ backend, kind, rows = null, ok = true, error = null, force = false } = {}) {
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
    } else {
      row.last_read_at = iso;
      row.last_rows = rows == null ? null : Number(rows) || 0;
    }

    const { error: upErr } = await withTimeout(
      client.from('sync_heartbeat').upsert(row, { onConflict: 'device_id,backend' }),
      6000,
      'sync heartbeat'
    );
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
