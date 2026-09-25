/**
 * Rongdhonu POS — Day-wise App Usage Tracking Engine
 * 
 * Tracks exact foreground active usage duration per device, role, and business date.
 * Uses Bangladesh Timezone (Asia/Dhaka, UTC+6) with a 06:00 AM rollover.
 * 
 * Guarantees:
 * - Counts ONLY while the app is in the FOREGROUND and an authenticated session is ACTIVE.
 * - Completely ignores time when backgrounded, screen-locked, or on Login screen.
 * - Idempotent cumulative totals prevent double-counting on sync retries.
 * - Offline-first: stores in local SQLite first, flushes to Supabase asynchronously.
 */

import { getDb } from '../database';
import { getSupabaseClient, isSupabaseConfigured, safeSupabaseCall } from './supabaseClient.js';
import { AppState } from 'react-native';

let activeTrackerInterval = null;
let currentSessionStartMs = null;
let currentTrackingContext = null;
let lastCloudSyncTime = 0;
const CLOUD_SYNC_INTERVAL_MS = 30000; // Push to cloud every 30s while active

/**
 * Resolves the business date according to Asia/Dhaka (UTC+6) with a 06:00 AM boundary.
 * Business day covers: YYYY-MM-DD 06:00:00 through (YYYY-MM-DD + 1) 05:59:59 Bangladesh Time.
 * 
 * Mathematical note:
 * Bangladesh Time is UTC+6. Subtracting 6 hours for the 06:00 AM cutoff
 * is mathematically identical to the UTC calendar date (YYYY-MM-DD) of the instant.
 * E.g., 2026-09-18 06:00:00 BST = 2026-09-18 00:00:00 UTC -> '2026-09-18'
 *       2026-09-19 05:59:59 BST = 2026-09-18 23:59:59 UTC -> '2026-09-18'
 *       2026-09-19 06:00:00 BST = 2026-09-19 00:00:00 UTC -> '2026-09-19'
 * 
 * @param {number|string|Date} timestamp
 * @returns {string} YYYY-MM-DD
 */
export function getDhakaBusinessDate(timestamp = Date.now()) {
  const d = typeof timestamp === 'number' ? new Date(timestamp) : new Date(timestamp);
  const utcYear = d.getUTCFullYear();
  const utcMonth = String(d.getUTCMonth() + 1).padStart(2, '0');
  const utcDay = String(d.getUTCDate()).padStart(2, '0');
  return `${utcYear}-${utcMonth}-${utcDay}`;
}

/**
 * Maps the authenticated session role to a human-readable App Label.
 * 
 * @param {string} role - Authenticated role (ADMIN, OWNER, MANAGER, WAITER)
 * @param {string} appProfile - Active app profile if role is missing
 * @returns {string} e.g. 'Admin App', 'Manager App'
 */
export function getAppLabelForRole(role, appProfile = '') {
  const r = String(role || '').toUpperCase().trim();
  const p = String(appProfile || '').toUpperCase().trim();
  const effectiveRole = r || p;

  if (effectiveRole === 'ADMIN') return 'Admin App';
  if (effectiveRole === 'OWNER') return 'Owner App';
  if (effectiveRole === 'MANAGER') return 'Manager App';
  if (effectiveRole === 'WAITER') return 'Waiter App';
  return effectiveRole ? `${effectiveRole} App` : 'App';
}

/**
 * Formats duration in seconds into clean Bengali hours and minutes.
 * Examples:
 *   600   -> '10 মিনিট'
 *   14400 -> '4 ঘণ্টা'
 *   15000 -> '4 ঘণ্টা 10 মিনিট'
 *   30    -> '< 1 মিনিট'
 *   0     -> '0 মিনিট'
 * 
 * @param {number} totalSeconds
 * @returns {string}
 */
export function formatDurationBengali(totalSeconds) {
  const sec = Math.max(0, Math.floor(totalSeconds || 0));
  if (sec === 0) return '0 মিনিট';

  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);

  if (hours > 0 && minutes > 0) {
    return `${hours} ঘণ্টা ${minutes} মিনিট`;
  } else if (hours > 0) {
    return `${hours} ঘণ্টা`;
  } else if (minutes > 0) {
    return `${minutes} মিনিট`;
  } else {
    return '< 1 মিনিট';
  }
}

/**
 * Initializes the SQLite device_app_usage table.
 */
export function initAppUsageTable() {
  try {
    const db = getDb();
    if (!db) return false;

    db.execSync(`
      CREATE TABLE IF NOT EXISTS device_app_usage (
        id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        business_date TEXT NOT NULL,
        role TEXT NOT NULL,
        app_label TEXT NOT NULL,
        total_seconds INTEGER NOT NULL DEFAULT 0,
        last_heartbeat TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        is_synced INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_device_app_usage_date ON device_app_usage (business_date);
      CREATE INDEX IF NOT EXISTS idx_device_app_usage_dev ON device_app_usage (device_id);
    `);
    return true;
  } catch (err) {
    console.error('[AppUsageTracker] initAppUsageTable error:', err.message);
    return false;
  }
}

/**
 * Flushes active accumulated elapsed seconds into local SQLite database.
 * If 6:00 AM boundary was crossed during session, splits accurately across business dates.
 */
export function flushAppUsage(forceCloudPush = false) {
  if (!currentSessionStartMs || !currentTrackingContext) return;

  const now = Date.now();
  const elapsedMs = now - currentSessionStartMs;
  if (elapsedMs < 1000) return; // Less than 1 second, keep accumulating

  const elapsedSeconds = Math.floor(elapsedMs / 1000);
  currentSessionStartMs = now; // Advance start marker

  const { deviceId, role, appProfile } = currentTrackingContext;
  if (!deviceId || !role) return;

  const appLabel = getAppLabelForRole(role, appProfile);
  const normalizedRole = String(role).toUpperCase().trim();
  const businessDate = getDhakaBusinessDate(now);
  const recordId = `${deviceId}_${businessDate}_${normalizedRole}`;
  const nowIso = new Date(now).toISOString();

  try {
    const db = getDb();
    if (!db) return;

    db.runSync(`
      INSERT INTO device_app_usage (
        id, device_id, business_date, role, app_label, total_seconds, last_heartbeat, created_at, updated_at, is_synced
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      ON CONFLICT(id) DO UPDATE SET
        total_seconds = total_seconds + excluded.total_seconds,
        app_label = excluded.app_label,
        last_heartbeat = excluded.last_heartbeat,
        updated_at = excluded.updated_at,
        is_synced = 0;
    `, [
      recordId,
      deviceId,
      businessDate,
      normalizedRole,
      appLabel,
      elapsedSeconds,
      nowIso,
      nowIso,
      nowIso
    ]);

    // Check if cloud push should run
    const timeSinceLastSync = now - lastCloudSyncTime;
    if (forceCloudPush || timeSinceLastSync > CLOUD_SYNC_INTERVAL_MS) {
      lastCloudSyncTime = now;
      syncRecordToSupabase(recordId).catch(() => {});
    }
  } catch (err) {
    console.error('[AppUsageTracker] flushAppUsage error:', err.message);
  }
}

/**
 * Starts foreground active session usage tracking.
 * Only counts when app is active and user is authenticated.
 */
export function startAppUsageTracker({ deviceId, userRole, appProfile, isLoggedIn }) {
  // Only track if authenticated session is active
  if (!isLoggedIn || !userRole || !deviceId) {
    stopAppUsageTracker();
    return;
  }

  // If already tracking same context, keep running
  if (
    currentTrackingContext &&
    currentTrackingContext.deviceId === deviceId &&
    currentTrackingContext.role === userRole
  ) {
    return;
  }

  // Flush any prior session first
  flushAppUsage(true);

  currentTrackingContext = { deviceId, role: userRole, appProfile };
  currentSessionStartMs = Date.now();

  if (activeTrackerInterval) {
    clearInterval(activeTrackerInterval);
  }

  // Periodic flush every 10 seconds while active
  activeTrackerInterval = setInterval(() => {
    if (AppState.currentState === 'active') {
      flushAppUsage(false);
    }
  }, 10000);

  console.log(`[AppUsageTracker] Started usage tracking for device '${deviceId}', role '${userRole}'`);
}

/**
 * Stops active session usage tracking (e.g. on logout or app unmount).
 */
export function stopAppUsageTracker() {
  if (activeTrackerInterval) {
    clearInterval(activeTrackerInterval);
    activeTrackerInterval = null;
  }

  flushAppUsage(true);
  currentSessionStartMs = null;
  currentTrackingContext = null;
}

/**
 * Handles AppState transitions (active <-> background/inactive).
 * Guarantees zero time counted while app is in background or screen is locked.
 */
export function handleUsageAppStateChange(nextState) {
  if (nextState !== 'active') {
    // App backgrounded or screen locked: flush remaining active seconds immediately and freeze timer
    flushAppUsage(true);
    currentSessionStartMs = null;
  } else {
    // App resumed in foreground: start fresh timer from this exact moment
    if (currentTrackingContext) {
      currentSessionStartMs = Date.now();
      flushAppUsage(false);
    }
  }
}

/**
 * Push an updated usage record to Supabase.
 * Idempotent upsert by recordId (`device_id_business_date_role`).
 */
async function syncRecordToSupabase(recordId) {
  if (!isSupabaseConfigured()) return false;

  const db = getDb();
  if (!db) return false;

  const row = db.getFirstSync("SELECT * FROM device_app_usage WHERE id = ?", [recordId]);
  if (!row) return false;

  return await safeSupabaseCall(async (supabase) => {
    const payload = {
      id: row.id,
      device_id: row.device_id,
      business_date: row.business_date,
      role: row.role,
      app_label: row.app_label,
      total_seconds: Number(row.total_seconds || 0),
      last_heartbeat: row.last_heartbeat,
      updated_at: new Date().toISOString()
    };

    const { error } = await supabase
      .from('device_app_usage')
      .upsert(payload, { onConflict: 'id' });

    if (!error) {
      db.runSync("UPDATE device_app_usage SET is_synced = 1 WHERE id = ?", [recordId]);
      return true;
    } else {
      console.warn('[AppUsageTracker] Cloud sync error:', error.message);
      return false;
    }
  }, false);
}

/**
 * Get all app usage records for a specific business date from local SQLite.
 * Returns map: { [deviceId]: { roles: [ { role, app_label, total_seconds } ], total_seconds } }
 */
export function getLocalAppUsageForDate(businessDate) {
  try {
    const db = getDb();
    if (!db || !businessDate) return {};

    const rows = db.getAllSync(`
      SELECT device_id, role, app_label, total_seconds
      FROM device_app_usage
      WHERE business_date = ?
      ORDER BY total_seconds DESC
    `, [businessDate]);

    const result = {};
    for (const row of rows) {
      const devId = row.device_id;
      if (!result[devId]) {
        result[devId] = { roles: [], total_seconds: 0, _labelMap: {} };
      }

      const label = row.app_label || getAppLabelForRole(row.role);
      const seconds = Number(row.total_seconds || 0);

      if (result[devId]._labelMap[label]) {
        // Aggregate seconds into existing entry for this app label
        result[devId]._labelMap[label].total_seconds += seconds;
      } else {
        const roleEntry = {
          role: row.role,
          app_label: label,
          total_seconds: seconds
        };
        result[devId]._labelMap[label] = roleEntry;
        result[devId].roles.push(roleEntry);
      }

      result[devId].total_seconds += seconds;
    }

    // Clean up temporary _labelMap and re-sort roles by total_seconds descending
    for (const devId of Object.keys(result)) {
      delete result[devId]._labelMap;
      result[devId].roles.sort((a, b) => b.total_seconds - a.total_seconds);
    }

    return result;
  } catch (err) {
    console.error('[AppUsageTracker] getLocalAppUsageForDate error:', err.message);
    return {};
  }
}

/**
 * Fetch remote app usage from Supabase for a specific business date and cache locally.
 */
export async function fetchRemoteAppUsageForDate(businessDate) {
  if (!businessDate || !isSupabaseConfigured()) return getLocalAppUsageForDate(businessDate);

  return await safeSupabaseCall(async (supabase) => {
    const { data, error } = await supabase
      .from('device_app_usage')
      .select('*')
      .eq('business_date', businessDate);

    if (error) {
      console.warn('[AppUsageTracker] fetchRemoteAppUsage error:', error.message);
      return getLocalAppUsageForDate(businessDate);
    }

    if (Array.isArray(data) && data.length > 0) {
      const db = getDb();
      if (db) {
        for (const row of data) {
          try {
            db.runSync(`
              INSERT INTO device_app_usage (
                id, device_id, business_date, role, app_label, total_seconds, last_heartbeat, created_at, updated_at, is_synced
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
              ON CONFLICT(id) DO UPDATE SET
                total_seconds = MAX(total_seconds, excluded.total_seconds),
                app_label = excluded.app_label,
                last_heartbeat = excluded.last_heartbeat,
                updated_at = excluded.updated_at,
                is_synced = 1;
            `, [
              row.id,
              row.device_id,
              row.business_date,
              row.role,
              row.app_label,
              Number(row.total_seconds || 0),
              row.last_heartbeat || new Date().toISOString(),
              row.created_at || new Date().toISOString(),
              row.updated_at || new Date().toISOString()
            ]);
          } catch (insertErr) {
            // Ignore cache conflict errors
          }
        }
      }
    }

    return getLocalAppUsageForDate(businessDate);
  }, getLocalAppUsageForDate(businessDate));
}

/**
 * Realtime subscription for device_app_usage table on Supabase.
 * Notifies Admin dashboard when any device updates its usage.
 */
export function subscribeAppUsageRealtime(businessDate, onUsageUpdate) {
  if (!isSupabaseConfigured() || !businessDate) return () => {};

  const supabase = getSupabaseClient();
  if (!supabase) return () => {};

  let channel = null;
  try {
    channel = supabase
      .channel(`usage_updates_${businessDate}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'device_app_usage',
          filter: `business_date=eq.${businessDate}`
        },
        async (payload) => {
          if (payload && payload.new) {
            const db = getDb();
            if (db) {
              try {
                db.runSync(`
                  INSERT INTO device_app_usage (
                    id, device_id, business_date, role, app_label, total_seconds, last_heartbeat, created_at, updated_at, is_synced
                  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                  ON CONFLICT(id) DO UPDATE SET
                    total_seconds = MAX(total_seconds, excluded.total_seconds),
                    app_label = excluded.app_label,
                    last_heartbeat = excluded.last_heartbeat,
                    updated_at = excluded.updated_at,
                    is_synced = 1;
                `, [
                  payload.new.id,
                  payload.new.device_id,
                  payload.new.business_date,
                  payload.new.role,
                  payload.new.app_label,
                  Number(payload.new.total_seconds || 0),
                  payload.new.last_heartbeat || new Date().toISOString(),
                  payload.new.created_at || new Date().toISOString(),
                  payload.new.updated_at || new Date().toISOString()
                ]);
              } catch (e) {}
            }
          }
          if (typeof onUsageUpdate === 'function') {
            onUsageUpdate(getLocalAppUsageForDate(businessDate));
          }
        }
      )
      .subscribe();
  } catch (err) {
    console.warn('[AppUsageTracker] Realtime subscribe error:', err.message);
  }

  return () => {
    if (channel) {
      try {
        channel.unsubscribe();
      } catch (e) {}
    }
  };
}

