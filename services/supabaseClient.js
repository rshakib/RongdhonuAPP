/**
 * Supabase Client Initialization Module
 * Provides a resilient, fail-safe client instance for Device Control, Monitoring,
 * and the Phase 2 dual-write sync queue.
 * Does NOT interfere with any POS data or Firestore operations.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

// Phase 2: default per-operation timeout for Supabase calls (ms).
export const SUPABASE_TIMEOUT_MS = (() => {
  const n = Number(process.env.EXPO_PUBLIC_SUPABASE_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 4000;
})();

let supabaseInstance = null;
let isConfigured = false;
let currentDeviceId = null;

function buildClient(deviceId = null) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_URL.startsWith('http')) {
    return null;
  }
  const globalHeaders = {};
  if (deviceId) {
    globalHeaders['x-device-id'] = String(deviceId);
  }
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: globalHeaders },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    },
    realtime: {
      params: {
        eventsPerSecond: 10
      }
    }
  });
}

try {
  supabaseInstance = buildClient();
  if (supabaseInstance) {
    isConfigured = true;
    console.log('[SupabaseClient] Successfully initialized Supabase client.');
  } else {
    console.warn('[SupabaseClient] Missing or invalid EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY. Supabase Device Control running in dormant mode.');
  }
} catch (err) {
  console.error('[SupabaseClient] Initialization error (dormant mode):', err.message);
  supabaseInstance = null;
  isConfigured = false;
}

/**
 * Check if Supabase client is properly configured with valid credentials
 */
export function isSupabaseConfigured() {
  return isConfigured && supabaseInstance !== null;
}

/**
 * Phase 2 kill switch. Defaults to enabled; set EXPO_PUBLIC_SUPABASE_SYNC_ENABLED
 * to 'false' (or 0/off/no) to instantly revert to Firebase-only behavior —
 * dual-write enqueue and Supabase pull are then skipped entirely.
 */
export function isSupabaseSyncEnabled() {
  const raw = String(process.env.EXPO_PUBLIC_SUPABASE_SYNC_ENABLED ?? 'true').trim().toLowerCase();
  return raw !== 'false' && raw !== '0' && raw !== 'off' && raw !== 'no';
}

/**
 * Get the Supabase client instance (or null if not configured)
 */
export function getSupabaseClient() {
  // Warm start: if the device id was persisted in SQLite earlier, re-apply it
  // lazily so the X-Device-Id header survives app restarts (RLS Option B prep).
  if (!currentDeviceId) {
    try {
      const { getDb } = require('../database.js');
      const row = getDb().getFirstSync("SELECT value FROM app_config WHERE key = 'persistent_device_id'");
      if (row && row.value) setSupabaseDeviceId(row.value);
    } catch (_) {
      // Dormant or non-native environment — ignore.
    }
  }
  return supabaseInstance;
}

/**
 * Authoritatively configure the active device ID for all future Supabase calls.
 *
 * IMPORTANT: `@supabase/postgrest-js` stores its headers as a `Headers` instance
 * (`this.headers = new Headers(headers)`). A plain assignment like
 * `rest.headers['x-device-id'] = id` only adds a dangling expando property and
 * is NEVER serialized into the HTTP request — so use the Headers API `.set()`.
 * (Fallback to bracket assignment keeps this working if a future/older version
 * exposes a plain object instead of a Headers instance.)
 */
export function setSupabaseDeviceId(deviceId) {
  if (!deviceId) return;
  const nextId = String(deviceId).trim();
  if (!nextId) return;

  currentDeviceId = nextId;

  if (!supabaseInstance) {
    try {
      supabaseInstance = buildClient(nextId);
      isConfigured = supabaseInstance !== null;
    } catch (_) {
      // Ignore — device control remains in dormant mode.
    }
  }

  // Attach to the PostgREST client's Headers (this is what PostgREST actually sends).
  if (supabaseInstance && supabaseInstance.rest) {
    setHeaderOn(supabaseInstance.rest.headers, 'x-device-id', nextId);
  }
  // Keep the top-level global header map in sync too (storage/functions/realtime).
  if (supabaseInstance && supabaseInstance.headers) {
    supabaseInstance.headers['x-device-id'] = nextId;
  }

  const attached = supabaseInstance && supabaseInstance.rest
    ? readHeaderFrom(supabaseInstance.rest.headers, 'x-device-id')
    : null;
  console.log(`[SupabaseClient] Configured X-Device-Id header: ${nextId} (attached=${attached === nextId})`);
}

/** Set a header on either a `Headers` instance or a plain object. */
function setHeaderOn(headers, name, value) {
  if (!headers) return;
  if (typeof headers.set === 'function') { headers.set(name, value); return; }
  headers[name] = value;
}

/** Read a header from either a `Headers` instance or a plain object. */
export function readHeaderFrom(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  return headers[name];
}

/**
 * Bound a promise with a timeout. Rejects with a descriptive error if it does
 * not settle within `ms`. The timer is always cleared.
 */
export function withTimeout(promise, ms = SUPABASE_TIMEOUT_MS, label = 'supabase-call') {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`[SupabaseClient] ${label} timed out after ${ms}ms`));
    }, ms);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Fail-safe wrapper that executes a Supabase call and catches any exceptions.
 * Guarantees that Supabase errors or network downtime will NEVER crash the app or POS.
 */
export async function safeSupabaseCall(operationFn, fallbackValue = null) {
  if (!isSupabaseConfigured()) {
    return fallbackValue;
  }
  try {
    return await operationFn(supabaseInstance);
  } catch (err) {
    console.warn('[SupabaseClient] Suppressed background error:', err?.message || err);
    return fallbackValue;
  }
}

/**
 * Same as safeSupabaseCall but also bounds the operation with a timeout.
 */
export async function safeSupabaseCallWithTimeout(operationFn, fallbackValue = null, ms = SUPABASE_TIMEOUT_MS) {
  return safeSupabaseCall(
    (client) => withTimeout(operationFn(client), ms, 'safeSupabaseCallWithTimeout'),
    fallbackValue
  );
}

export default supabaseInstance;
