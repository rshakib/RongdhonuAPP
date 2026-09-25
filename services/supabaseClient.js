/**
 * Supabase Client Initialization Module
 * Provides a resilient, fail-safe client instance for Device Control & Monitoring.
 * Does NOT interfere with any POS data or Firestore operations.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

let supabaseInstance = null;
let isConfigured = false;

try {
  if (SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_URL.startsWith('http')) {
    supabaseInstance = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
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
 * Get the Supabase client instance (or null if not configured)
 */
export function getSupabaseClient() {
  return supabaseInstance;
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

export default supabaseInstance;

