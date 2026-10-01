/**
 * Isolated Audit Supabase Client
 *
 * A SECOND, fully independent Supabase client that talks ONLY to the dedicated
 * audit/activity project. It never touches the running POS client, the running
 * Supabase project, Firebase, or the sync pipeline.
 *
 * Fail-safe: if the audit env vars are missing the whole module is dormant and
 * every function becomes a no-op. Nothing here can throw into a caller.
 */

import { createClient } from '@supabase/supabase-js';
import { withTimeout } from './supabaseClient.js';

const AUDIT_URL = process.env.EXPO_PUBLIC_AUDIT_SUPABASE_URL || '';
const AUDIT_ANON_KEY = process.env.EXPO_PUBLIC_AUDIT_SUPABASE_ANON_KEY || '';
const AUDIT_READ_SECRET = process.env.EXPO_PUBLIC_AUDIT_READ_SECRET || '';

export const AUDIT_TABLE = 'activity_events';
export const AUDIT_BROADCAST_TOPIC = 'rongdhonu_audit_live';
export const AUDIT_BROADCAST_EVENT = 'activity';

export const AUDIT_TIMEOUT_MS = (() => {
  const n = Number(process.env.EXPO_PUBLIC_AUDIT_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 6000;
})();

let auditClient = null;
let auditConfigured = false;

function buildAuditClient() {
  if (!AUDIT_URL || !AUDIT_ANON_KEY || !AUDIT_URL.startsWith('http')) return null;
  try {
    return createClient(AUDIT_URL, AUDIT_ANON_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      },
      realtime: {
        params: { eventsPerSecond: 10 }
      }
    });
  } catch (err) {
    console.warn('[AuditClient] createClient failed:', err?.message || err);
    return null;
  }
}

try {
  auditClient = buildAuditClient();
  auditConfigured = auditClient !== null;
  if (auditConfigured) {
    console.log('[AuditClient] Isolated audit client initialized.');
  } else {
    console.log('[AuditClient] Dormant (audit project not configured).');
  }
} catch (err) {
  auditClient = null;
  auditConfigured = false;
  console.warn('[AuditClient] Initialization error (dormant):', err?.message || err);
}

/** True when the isolated audit project is configured and reachable from here. */
export function isAuditConfigured() {
  return auditConfigured && auditClient !== null;
}

/** Kill switch — set EXPO_PUBLIC_AUDIT_SYNC_ENABLED to false/0/off/no to disable capture. */
export function isAuditSyncEnabled() {
  const raw = String(process.env.EXPO_PUBLIC_AUDIT_SYNC_ENABLED ?? 'true').trim().toLowerCase();
  return raw !== 'false' && raw !== '0' && raw !== 'off' && raw !== 'no';
}

/** The admin-only read secret (bundled ONLY into the ADMIN profile). */
export function getAuditReadSecret() {
  return AUDIT_READ_SECRET;
}

export function getAuditClient() {
  return auditClient;
}

/** Project ref of the audit project (for on-screen diagnostics). */
export function getAuditProjectRef() {
  const m = /^https?:\/\/([^.]+)\./.exec(AUDIT_URL || '');
  return m ? m[1] : '';
}

/**
 * Append events. A PLAIN insert is used on purpose: `upsert()` sends
 * `ON CONFLICT`, which interacts badly with a table that has an INSERT policy
 * but deliberately NO SELECT policy (RLS rejects it). Retries are still safe
 * because a duplicate-key error (23505) means the event is already stored.
 */
export async function insertAuditRows(rows) {
  if (!isAuditConfigured() || !Array.isArray(rows) || rows.length === 0) {
    return { ok: false, count: 0, error: 'audit project not configured' };
  }
  try {
    const { error } = await withTimeout(
      auditClient.from(AUDIT_TABLE).insert(rows),
      AUDIT_TIMEOUT_MS,
      'audit insert'
    );
    if (error) {
      if (String(error.code) === '23505') {
        return { ok: true, count: rows.length, error: null };
      }
      return { ok: false, count: 0, error: error.message };
    }
    return { ok: true, count: rows.length, error: null };
  } catch (err) {
    return { ok: false, count: 0, error: err?.message || String(err) };
  }
}

/**
 * Read history through the secret-gated RPC. Without a valid secret the server
 * raises `unauthorized`, so only the admin build can read.
 */
export async function auditRead({ limit = 100, before = null, secret = AUDIT_READ_SECRET } = {}) {
  if (!isAuditConfigured()) {
    return { ok: false, rows: [], error: 'audit project not configured' };
  }
  if (!secret) {
    return { ok: false, rows: [], error: 'missing read secret (admin build only)' };
  }
  try {
    const { data, error } = await withTimeout(
      auditClient.rpc('audit_read', { p_secret: secret, p_limit: limit, p_before: before }),
      AUDIT_TIMEOUT_MS,
      'audit read'
    );
    if (error) return { ok: false, rows: [], error: error.message };
    return { ok: true, rows: data || [], error: null };
  } catch (err) {
    return { ok: false, rows: [], error: err?.message || String(err) };
  }
}

// ─── Live stream (shared broadcast channel) ─────────────────────────────────
// One channel is shared by every subscriber so mounting/unmounting the screen
// never churns the channel (which used to surface as a spurious "CLOSED").
const AUDIT_BACKOFF_MS = [3000, 6000, 12000, 30000];
const auditHandlers = new Set();
let auditChannel = null;
let auditReconnectTimer = null;
let auditRetry = 0;

function emitAuditEvent(payload) {
  if (!payload) return;
  for (const handler of Array.from(auditHandlers)) {
    try {
      handler(payload);
    } catch (err) {
      console.warn('[AuditClient] listener error:', err?.message || err);
    }
  }
}

function scheduleAuditReconnect() {
  if (auditReconnectTimer || auditHandlers.size === 0) return;
  const delay = AUDIT_BACKOFF_MS[Math.min(auditRetry, AUDIT_BACKOFF_MS.length - 1)];
  auditRetry += 1;
  auditReconnectTimer = setTimeout(() => {
    auditReconnectTimer = null;
    openAuditChannel();
  }, delay);
}

function openAuditChannel() {
  if (!isAuditConfigured() || auditHandlers.size === 0 || auditChannel) return;
  try {
    // Remove any channel left over from a previous session (silently — its
    // status callback is ignored because it is no longer the active channel).
    try {
      const stale = auditClient
        .getChannels()
        .filter((c) => c.topic === `realtime:${AUDIT_BROADCAST_TOPIC}`);
      for (const old of stale) auditClient.removeChannel(old);
    } catch (_) {}

    const channel = auditClient.channel(AUDIT_BROADCAST_TOPIC, {
      config: { broadcast: { self: false } }
    });
    auditChannel = channel;

    channel.on('broadcast', { event: AUDIT_BROADCAST_EVENT }, (msg) => emitAuditEvent(msg && msg.payload));
    channel.subscribe((status) => {
      // Ignore callbacks from a channel we already replaced or tore down.
      if (channel !== auditChannel) return;

      if (status === 'SUBSCRIBED') {
        auditRetry = 0;
        console.log(`[AuditClient] realtime subscribed: ${AUDIT_BROADCAST_TOPIC}`);
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn(`[AuditClient] realtime ${status} — retrying`);
        auditChannel = null;
        scheduleAuditReconnect();
      } else if (status === 'CLOSED') {
        console.log('[AuditClient] realtime closed (history still refreshes via polling).');
      }
    });
  } catch (err) {
    auditChannel = null;
    console.warn('[AuditClient] subscribe failed:', err?.message || err);
    scheduleAuditReconnect();
  }
}

function closeAuditChannel() {
  try {
    if (auditReconnectTimer) {
      clearTimeout(auditReconnectTimer);
      auditReconnectTimer = null;
    }
    if (auditChannel && auditClient) auditClient.removeChannel(auditChannel);
  } catch (_) {}
  auditChannel = null;
}

/**
 * Subscribe to the live audit stream. Multiple subscribers share ONE channel.
 * The audit project's Realtime is a bonus: the screen also polls, so a closed
 * channel never breaks the feature. Always returns an unsubscribe function.
 */
export function subscribeAudit(onEvent) {
  if (!isAuditConfigured() || typeof onEvent !== 'function') return () => {};

  auditHandlers.add(onEvent);
  openAuditChannel();

  return () => {
    auditHandlers.delete(onEvent);
    if (auditHandlers.size === 0) {
      auditRetry = 0;
      closeAuditChannel();
    }
  };
}

