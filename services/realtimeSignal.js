/**
 * Realtime "change signal" — data-free Broadcast nudges + adaptive polling support.
 *
 * Design: ~/.commandcode/plans/realtime-signal-polling.md  (Stage A = 'tables' only)
 *
 * Why: the tables group polled every 1s and the high group every 5s purely to discover
 * "did anything change", which is the dominant Supabase REST/log volume. Instead:
 *   - SENDER  : after a CONFIRMED Supabase upsert/delete (see supabaseSyncQueue.js) we
 *               broadcast { tables, ts, sender_device_id } on a PUBLIC channel. No row
 *               data ever leaves the device, so the RLS-gated read path is untouched.
 *   - RECEIVER: on a signal (not our own, known tables), debounce and call the EXISTING
 *               pull function for that group. Every merge rule / tombstone / fallback
 *               stays exactly as it is.
 *   - SAFETY  : while the channel is SUBSCRIBED the caller slows those polls to a
 *               configurable cadence; on ANY error/timeout/close, or when the kill
 *               switch is off, getSignalMode() returns 'fast' and behaviour is
 *               byte-equivalent to the previous polling.
 *
 * Realtime gives no delivery guarantee, so a missed signal may only ever cause delay —
 * never data loss: the slow safety poll (and the existing foreground/network recovery
 * pulls) cover it.
 *
 * Kill switch: EXPO_PUBLIC_REALTIME_SIGNAL_ENABLED (default true; false/0/off/no = off).
 */

'use strict';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient.js';
import { SIGNAL_GROUPS } from './supabaseSync.js';

// --- kill switch --------------------------------------------------------------
export function isRealtimeSignalEnabled() {
  const raw = String(process.env.EXPO_PUBLIC_REALTIME_SIGNAL_ENABLED ?? 'true').trim().toLowerCase();
  return raw !== 'false' && raw !== '0' && raw !== 'off' && raw !== 'no';
}

// --- constants ---------------------------------------------------------------
export const SIGNAL_CHANNEL_NAME = 'rongdhonu_data_signals';
export const SIGNAL_EVENT = 'data-changed';
const SENDER_COALESCE_MS = 400;      // one signal per burst (checkout writes N rows)
const RECEIVER_DEBOUNCE_MS = 300;    // collapse a burst of signals into one pull
const SIGNAL_RATE_LIMIT_MS = 1000;   // max one signal-triggered pull per group per second
const RECONNECT_BACKOFF_MS = [3000, 6000, 12000, 30000];

// Only tables written to BOTH clouds may be signalled (never app_config / local-only).
// Every table that belongs to ANY signal group (derived, so a new group is picked up
// automatically — never hardcode the group names here).
const KNOWN_TABLES = new Set(
  Object.keys(SIGNAL_GROUPS).reduce((acc, g) => acc.concat(SIGNAL_GROUPS[g] || []), [])
);
/** Per-group mutable blanks, derived from SIGNAL_GROUPS so a new group needs no edits. */
const blankTimers = () => Object.keys(SIGNAL_GROUPS).reduce((acc, g) => { acc[g] = null; return acc; }, {});
const blankLastPull = () => Object.keys(SIGNAL_GROUPS).reduce((acc, g) => { acc[g] = 0; return acc; }, {});

// STAGE SWITCH — Stage A shipped 'tables'; Stage B added 'high'; Stage C (this revision)
// adds 'deletions'. A group whose flag is false keeps today's fast poll and ignores
// signals entirely, so clearing a flag is the per-group rollback (no other change needed).
export const ENABLED_GROUPS = { tables: true, high: true, deletions: true };

// --- dependency seams (production defaults; overridable in unit tests) --------
const productionDeps = {
  getClient: getSupabaseClient,
  isConfigured: isSupabaseConfigured,
  isEnabled: isRealtimeSignalEnabled,
  now: () => Date.now()
};
let deps = { ...productionDeps };

// --- module state -------------------------------------------------------------
let channel = null;
let subscribed = false;
let stopped = true;
let myDeviceId = null;
let onPull = null;          // (group) => void
let onModeChange = null;    // () => void
let pendingTables = new Set();
let coalesceTimer = null;
let reconnectTimer = null;
let reconnectAttempt = 0;
let debounceTimers = blankTimers();
let lastPullAt = blankLastPull();

const log = (...a) => { try { console.log(...a); } catch (_) {} };
const warn = (...a) => { try { console.warn(...a); } catch (_) {} };

/** Report THIS device's signal-channel health to the sync heartbeat (per device). Never throws. */
function reportRealtime(ok, mode) {
  try {
    const { recordRealtimeHealth } = require('./supabaseHeartbeat.js');
    recordRealtimeHealth({ ok, mode }).catch(() => {});
  } catch (_) {}
}

function enabledGroups() {
  return Object.keys(SIGNAL_GROUPS).filter((g) => ENABLED_GROUPS[g] === true);
}

// --- public: mode (consumed by the adaptive poller every tick) ----------------
export function getSignalMode(group) {
  if (!ENABLED_GROUPS[group]) return 'fast';
  if (!deps.isEnabled()) return 'fast';
  return subscribed ? 'slow' : 'fast';
}
export function isSignalSubscribed() {
  return subscribed;
}

/** Signal a confirmed cloud write. Never throws; safe to call from the push path. */
export function notifyDataChanged(tableName) {
  try {
    if (stopped || !subscribed || !channel) return false;
    if (!deps.isEnabled()) return false;
    if (typeof tableName !== 'string' || !KNOWN_TABLES.has(tableName)) return false;
    pendingTables.add(tableName);
    if (!coalesceTimer) coalesceTimer = setTimeout(flushSignal, SENDER_COALESCE_MS);
    return true;
  } catch (err) {
    warn('[Realtime-Signal] notify skipped (isolated):', err?.message || err);
    return false;
  }
}

function flushSignal() {
  coalesceTimer = null;
  const tables = Array.from(pendingTables);
  pendingTables.clear();
  if (tables.length === 0 || !channel || !subscribed || stopped) return;
  const payload = {
    tables,
    ts: new Date().toISOString(),
    sender_device_id: myDeviceId || 'unknown'
  };
  try {
    const sent = channel.send({ type: 'broadcast', event: SIGNAL_EVENT, payload });
    const done = (ack) => log(`[Realtime-Signal] send tables=[${tables.join(',')}] coalesced=${tables.length} ack=${ack}`);
    if (sent && typeof sent.then === 'function') {
      sent.then(done).catch((err) => warn('[Realtime-Signal] send failed (isolated):', err?.message || err));
    } else {
      done('none');
    }
  } catch (err) {
    warn('[Realtime-Signal] send threw (isolated):', err?.message || err);
  }
}

// --- receiver -----------------------------------------------------------------
function handleSignal(payload) {
  try {
    if (!payload || typeof payload !== 'object') {
      log('[Realtime-Signal] recv DROPPED malformed-payload');
      return;
    }
    const sender = payload.sender_device_id;
    if (myDeviceId && sender && String(sender) === String(myDeviceId)) {
      log('[Realtime-Signal] recv DROPPED own-signal sender=' + sender);
      return;
    }
    if (!Array.isArray(payload.tables) || payload.tables.length === 0) {
      log('[Realtime-Signal] recv DROPPED empty-tables');
      return;
    }
    const known = payload.tables.filter((t) => typeof t === 'string' && KNOWN_TABLES.has(t));
    if (known.length === 0) {
      log(`[Realtime-Signal] recv DROPPED unknown-tables=[${payload.tables.join(',')}]`);
      return;
    }
    const groups = new Set();
    for (const t of known) {
      for (const g of Object.keys(SIGNAL_GROUPS)) {
        if (ENABLED_GROUPS[g] && SIGNAL_GROUPS[g].includes(t)) groups.add(g);
      }
    }
    if (groups.size === 0) {
      log(`[Realtime-Signal] recv tables=[${known.join(',')}] from=${sender} → no enabled group (stage)`);
      return;
    }
    log(`[Realtime-Signal] recv tables=[${known.join(',')}] from=${sender} debounceMs=${RECEIVER_DEBOUNCE_MS}`);
    for (const g of groups) triggerPull(g, 'signal');
  } catch (err) {
    warn('[Realtime-Signal] recv handler error (isolated):', err?.message || err);
  }
}

function triggerPull(group, reason, force = false) {
  try {
    if (!ENABLED_GROUPS[group]) return;
    const now = deps.now();
    if (!force && now - lastPullAt[group] < SIGNAL_RATE_LIMIT_MS) {
      log(`[Realtime-Signal] recv THROTTLED group=${group} withinMs=${SIGNAL_RATE_LIMIT_MS}`);
      return;
    }
    if (debounceTimers[group]) clearTimeout(debounceTimers[group]);
    debounceTimers[group] = setTimeout(() => {
      debounceTimers[group] = null;
      lastPullAt[group] = deps.now();
      log(`[Realtime-Signal] recv → pull group=${group} reason=${reason}`);
      try {
        if (onPull) onPull(group);
      } catch (err) {
        warn('[Realtime-Signal] pull callback error (isolated):', err?.message || err);
      }
    }, RECEIVER_DEBOUNCE_MS);
  } catch (err) {
    warn('[Realtime-Signal] triggerPull error (isolated):', err?.message || err);
  }
}

// --- channel lifecycle --------------------------------------------------------
function emitModeChange() {
  try {
    if (onModeChange) onModeChange();
  } catch (err) {
    warn('[Realtime-Signal] mode callback error (isolated):', err?.message || err);
  }
}

function scheduleReconnect() {
  if (stopped || reconnectTimer) return;
  const delay = RECONNECT_BACKOFF_MS[Math.min(reconnectAttempt, RECONNECT_BACKOFF_MS.length - 1)];
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (stopped) return;
    const client = deps.getClient();
    if (client) createAndSubscribe(client);
  }, delay);
  return delay;
}

function handleStatus(status) {
  if (stopped) return;
  if (status === 'SUBSCRIBED') {
    subscribed = true;
    reconnectAttempt = 0;
    log(`[Realtime-Signal] channel=SUBSCRIBED groups=[${enabledGroups().join(',')}] mode=slow`);
    // Events written in the window right after SUBSCRIBED can be missed → one catch-up pull.
    for (const g of enabledGroups()) triggerPull(g, 'catchup', true);
    reportRealtime(true, 'slow');
    emitModeChange();
    return;
  }
  if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
    const wasSubscribed = subscribed;
    subscribed = false;
    const delay = scheduleReconnect();
    log(`[Realtime-Signal] channel=${status} → FAST mode retryInMs=${delay}`);
    reportRealtime(false, 'fast');
    if (wasSubscribed || !delay) emitModeChange();
  }
}

function createAndSubscribe(client) {
  try {
    // Drop a stale channel with the same topic (mirrors the device-control pattern).
    try {
      if (typeof client.getChannels === 'function') {
        const stale = client.getChannels().find((c) => c.topic === `realtime:${SIGNAL_CHANNEL_NAME}`);
        if (stale && typeof client.removeChannel === 'function') client.removeChannel(stale);
      }
    } catch (_) {}

    channel = client.channel(SIGNAL_CHANNEL_NAME, {
      config: { broadcast: { self: false, ack: true } }
    });
    channel.on('broadcast', { event: SIGNAL_EVENT }, (msg) => handleSignal(msg && msg.payload));
    channel.subscribe((status) => handleStatus(status));
    return true;
  } catch (err) {
    warn('[Realtime-Signal] channel create/subscribe failed (isolated):', err?.message || err);
    channel = null;
    subscribed = false;
    scheduleReconnect();
    return false;
  }
}

/**
 * Start the signal channel. Idempotent. Never throws.
 * @param {{deviceId?: string, onPull?: (group: string) => void, onModeChange?: () => void}} opts
 */
export function startRealtimeSignal(opts = {}) {
  const { deviceId, onPull: pullFn, onModeChange: modeFn } = opts;
  try {
    if (!stopped && channel) return true;   // already running
    stopped = false;
    myDeviceId = deviceId ? String(deviceId) : null;
    onPull = typeof pullFn === 'function' ? pullFn : null;
    onModeChange = typeof modeFn === 'function' ? modeFn : null;

    if (!deps.isEnabled()) {
      log('[Realtime-Signal] disabled (EXPO_PUBLIC_REALTIME_SIGNAL_ENABLED=false) → fast polling only');
      return false;
    }
    if (!deps.isConfigured()) {
      log('[Realtime-Signal] Supabase not configured → fast polling only');
      return false;
    }
    if (!myDeviceId) {
      log('[Realtime-Signal] no device id yet → fast polling only');
      return false;
    }
    const client = deps.getClient();
    if (!client) {
      log('[Realtime-Signal] client unavailable → fast polling only');
      return false;
    }
    return createAndSubscribe(client);
  } catch (err) {
    warn('[Realtime-Signal] start failed (isolated):', err?.message || err);
    return false;
  }
}

/** Stop the channel and reset all state. Never throws. */
export function stopRealtimeSignal() {
  stopped = true;
  subscribed = false;
  try { if (coalesceTimer) clearTimeout(coalesceTimer); } catch (_) {}
  coalesceTimer = null;
  try { if (reconnectTimer) clearTimeout(reconnectTimer); } catch (_) {}
  reconnectTimer = null;
  for (const g of Object.keys(debounceTimers)) {
    try { if (debounceTimers[g]) clearTimeout(debounceTimers[g]); } catch (_) {}
    debounceTimers[g] = null;
  }
  pendingTables.clear();
  reconnectAttempt = 0;
  const ch = channel;
  channel = null;
  try {
    const client = deps.getClient();
    if (ch && client && typeof client.removeChannel === 'function') client.removeChannel(ch);
    else if (ch && typeof ch.unsubscribe === 'function') ch.unsubscribe();
  } catch (_) {}
  log('[Realtime-Signal] stopped → FAST mode');
  reportRealtime(false, 'fast');
  emitModeChange();
}

// --- test seams ---------------------------------------------------------------
export function __setRealtimeSignalDepsForTesting(overrides = {}) {
  deps = { ...deps, ...overrides };
}
export function __resetRealtimeSignalDepsForTesting() {
  deps = { ...productionDeps };
  channel = null;
  subscribed = false;
  stopped = true;
  myDeviceId = null;
  onPull = null;
  onModeChange = null;
  pendingTables = new Set();
  coalesceTimer = null;
  reconnectTimer = null;
  reconnectAttempt = 0;
  debounceTimers = blankTimers();
  lastPullAt = blankLastPull();
}
/** Test-only: feed a payload straight into the receiver (bypasses the channel). */
export function __handleSignalForTesting(payload) {
  handleSignal(payload);
}
/** Test-only: expose the flush so coalescing can be asserted without waiting. */
export function __flushSignalForTesting() {
  flushSignal();
}
