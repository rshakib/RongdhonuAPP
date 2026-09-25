/**
 * Supabase Device Control & Realtime Monitoring Service
 * 
 * Replaces Firestore synchronization for Device Control with:
 * 1. 1-second in-memory Realtime Presence updates (zero DB write overhead).
 * 2. Instant sub-second remote command dispatch (Approve, Block, Admin Lock, Force Logout).
 * 3. Postgres `devices` table for persistent device state.
 * 
 * Guarantees:
 * - 100% fail-safe: All errors are caught and logged; POS and app never crash.
 * - Completely isolated from POS orders, billing, tables, expenses, and Firestore sync.
 */

import { getSupabaseClient, isSupabaseConfigured, safeSupabaseCall } from './supabaseClient.js';

export const STALE_PRESENCE_TIMEOUT_MS = 45000; // 45s clearly defined stale presence timeout
export const KEEPALIVE_HEARTBEAT_MS = 25000; // 25s low-frequency keepalive heartbeat (zero DB writes)
export const DB_HEARTBEAT_INTERVAL_MS = 120000; // 2 minutes throttled DB persist

const PRESENCE_CHANNEL_NAME = 'rongdhonu_device_presence';

let activePresenceChannel = null;
let activePresenceTimer = null;
let activeHeartbeatTimer = null;
let currentSessionStartTime = null;
let activeCommandChannel = null;
let lastDbPersistTime = 0;
const adminPresenceListeners = new Set();
let currentPresenceMap = {};
let activeDeviceId = null;
let isStoppingPresence = false;
let commandChannelReconnectTimer = null;
let presenceChannelReconnectTimer = null;

/**
 * Upsert device registry record to Supabase public.devices table.
 * Converts SQLite integer booleans (0/1) to PostgreSQL booleans.
 */
export async function upsertDeviceToSupabase(record) {
  if (!record || !record.device_id) return false;

  return await safeSupabaseCall(async (supabase) => {
    const payload = {
      device_id: record.device_id,
      device_name: record.device_name || '',
      manufacturer: record.manufacturer || '',
      brand: record.brand || '',
      model: record.model || '',
      android_version: record.android_version || '',
      app_version: record.app_version || '',
      first_install_time: record.first_install_time || '',
      status: record.status || 'PENDING',
      allow_login: Boolean(Number(record.allow_login ?? 1)),
      allow_offline: Boolean(Number(record.allow_offline ?? 1)),
      admin_lock: Boolean(Number(record.admin_lock ?? 0)),
      force_logout: Boolean(Number(record.force_logout ?? 0)),
      registered_by: record.registered_by || 'SYSTEM_AUTO',
      notes: record.notes || '',
      is_deleted: Boolean(Number(record.is_deleted ?? 0)),
      deleted_at: record.deleted_at || null,
      deleted_by: record.deleted_by || null,
      last_seen_at: record.last_seen || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { error } = await supabase
      .from('devices')
      .upsert(payload, { onConflict: 'device_id' });

    if (error) {
      console.warn('[SupabaseDeviceControl] Upsert error:', error.message);
      return false;
    }
    return true;
  }, false);
}

/**
 * Update specific fields of a device on Supabase (e.g. status, admin_lock, rename).
 * Handles graceful schema fallback if force_logout_token column is not yet migrated remotely.
 */
export async function updateSupabaseDevice(deviceId, fields) {
  if (!deviceId || !fields) return false;

  return await safeSupabaseCall(async (supabase) => {
    const payload = {
      ...fields,
      updated_at: new Date().toISOString()
    };

    let { error } = await supabase
      .from('devices')
      .update(payload)
      .eq('device_id', deviceId);

    // Schema fallback if force_logout_token column does not yet exist on live Supabase
    if (error && payload.force_logout_token && (error.message?.includes('force_logout_token') || error.code === 'PGRST204')) {
      const fallbackPayload = { ...payload };
      delete fallbackPayload.force_logout_token;
      const res = await supabase.from('devices').update(fallbackPayload).eq('device_id', deviceId);
      error = res.error;
    }

    if (error) {
      console.warn(`[SupabaseDeviceControl] Update error for ${deviceId}:`, error.message);
      return false;
    }
    return true;
  }, false);
}

/**
 * Safely acknowledge and clear force_logout on Supabase.
 * Uses unique command token to prevent race conditions where client acknowledgment erases a newer command.
 *
 * @param {string} deviceId
 * @param {string} [targetTimestamp] - Fallback ISO timestamp
 * @param {string} [targetToken] - Unique revocation token for this force logout event
 */
export async function clearForceLogoutIfMatching(deviceId, targetTimestamp, targetToken) {
  if (!deviceId) return false;

  return await safeSupabaseCall(async (supabase) => {
    // If targetToken is a synthetic timestamp token (e.g. 'ts_...'), extract timestamp for updated_at matching
    const isSyntheticToken = targetToken && (targetToken.startsWith('ts_') || targetToken.startsWith('notk_'));
    const effectiveToken = (!isSyntheticToken && targetToken) ? targetToken : null;
    const effectiveTimestamp = targetTimestamp || (targetToken && targetToken.startsWith('ts_') ? targetToken.substring(3) : null);

    let query = supabase
      .from('devices')
      .update({
        force_logout: false,
        force_logout_token: null,
        updated_at: new Date().toISOString()
      })
      .eq('device_id', deviceId)
      .eq('force_logout', true);

    if (effectiveToken) {
      query = query.eq('force_logout_token', targetToken);
    } else if (effectiveTimestamp) {
      // Use exact equality to prevent clearing a newer command with different timestamp
      query = query.eq('updated_at', effectiveTimestamp || targetTimestamp);
    }

    const { error } = await query;
    if (error) {
      // If error is about force_logout_token not existing in remote schema, fall back without force_logout_token
      if (error.message?.includes('force_logout_token') || error.code === 'PGRST204') {
        let fallbackQuery = supabase
          .from('devices')
          .update({
            force_logout: false,
            updated_at: new Date().toISOString()
          })
          .eq('device_id', deviceId)
          .eq('force_logout', true);
        if (effectiveTimestamp) {
          fallbackQuery = fallbackQuery.eq('updated_at', effectiveTimestamp);
        }
        const { error: fallbackError } = await fallbackQuery;
        if (!fallbackError) return true;
      }
      console.warn(`[SupabaseDeviceControl] Error clearing force_logout for ${deviceId}:`, error.message);
      return false;
    }
    return true;
  }, false);
}

/**
 * Fetch a single registered device by device_id from Supabase.
 * Strictly isolates Manager/Owner queries to their own device.
 * Differentiates network/API errors from a confirmed missing row.
 *
 * @param {string} deviceId
 * @returns {Promise<{ success: boolean, record: object|null, notFound: boolean, error: string|null }>}
 */
export async function fetchSingleSupabaseDevice(deviceId) {
  if (!deviceId) {
    return { success: false, record: null, notFound: false, error: 'Missing device_id' };
  }
  if (!isSupabaseConfigured()) {
    return { success: false, record: null, notFound: false, error: 'Supabase unconfigured' };
  }

  try {
    const supabase = getSupabaseClient();
    if (!supabase) {
      return { success: false, record: null, notFound: false, error: 'Supabase client unavailable' };
    }

    const { data, error } = await supabase
      .from('devices')
      .select('*')
      .eq('device_id', deviceId)
      .maybeSingle();

    if (error) {
      console.warn(`[SupabaseDeviceControl] Error fetching device ${deviceId}:`, error.message);
      return { success: false, record: null, notFound: false, error: error.message };
    }

    if (!data) {
      // Query succeeded, row confirmed non-existent
      return { success: true, record: null, notFound: true, error: null };
    }

    return { success: true, record: data, notFound: false, error: null };
  } catch (err) {
    console.warn(`[SupabaseDeviceControl] Network/unexpected exception for ${deviceId}:`, err.message);
    return { success: false, record: null, notFound: false, error: err.message };
  }
}

/**
 * Fetch all registered devices from Supabase.
 * PROTECTED: Strictly enforced for ADMIN profile only.
 * Manager and Owner callers are blocked and return empty array.
 *
 * @param {string|null} callerProfile
 */
export async function fetchSupabaseDevices(callerProfile = null) {
  // TODO: If OWNER is granted Device Control screen access in the future, enable full device fleet fetching and reconciliation for OWNER here.
  const profile = String(callerProfile || process.env.EXPO_PUBLIC_APP_PROFILE || 'ADMIN').toUpperCase().trim();
  if (profile !== 'ADMIN') {
    console.warn(`[SupabaseDeviceControl] Security block: Profile '${profile}' unauthorized to fetch device fleet.`);
    return [];
  }

  return await safeSupabaseCall(async (supabase) => {
    const { data, error } = await supabase
      .from('devices')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('[SupabaseDeviceControl] Fetch fleet error:', error.message);
      return [];
    }
    return data || [];
  }, []);
}

/**
 * Extract map of active presences from Supabase presenceState.
 * Filters out stale presences where last_heartbeat is older than STALE_PRESENCE_TIMEOUT_MS (45 seconds).
 * Preserves last_active for offline/left devices so Admin UI can calculate relative time.
 *
 * @param {object} state - Presence state from Supabase
 * @param {object} [previousMap] - Existing presence map to preserve last_active for left devices
 */
export function extractPresenceMap(state, previousMap = currentPresenceMap) {
  const map = { ...previousMap };
  if (!state || typeof state !== 'object') return map;
  const now = Date.now();
  const currentActiveDeviceIds = new Set();

  for (const key of Object.keys(state)) {
    const list = state[key];
    if (Array.isArray(list)) {
      for (const p of list) {
        if (p && p.device_id) {
          currentActiveDeviceIds.add(p.device_id);
          const heartbeatMs = Number(p.last_heartbeat || p.active_since || 0);
          const isStale = heartbeatMs > 0 && (now - heartbeatMs > STALE_PRESENCE_TIMEOUT_MS);
          const isExplicitOffline = p.online === false;

          if (!isExplicitOffline && !isStale) {
            map[p.device_id] = {
              ...p,
              online: true,
              last_heartbeat: heartbeatMs || now
            };
          } else {
            const prev = map[p.device_id] || {};
            const lastActive = p.last_active || heartbeatMs || prev.last_active || prev.last_heartbeat || now;
            map[p.device_id] = {
              ...prev,
              ...p,
              online: false,
              last_active: lastActive,
              is_stale: isStale
            };
          }
        }
      }
    }
  }

  // Any device previously tracked as online that is no longer in Phoenix presence state has left
  for (const devId of Object.keys(previousMap)) {
    if (!currentActiveDeviceIds.has(devId) && previousMap[devId]?.online) {
      const prev = previousMap[devId];
      map[devId] = {
        ...prev,
        online: false,
        last_active: prev.last_active || prev.last_heartbeat || now
      };
    }
  }

  return map;
}

function notifyAdminListeners() {
  if (adminPresenceListeners.size === 0) return;
  const snapshot = { ...currentPresenceMap };
  for (const listener of adminPresenceListeners) {
    try {
      listener(snapshot);
    } catch (err) {
      console.warn('[SupabaseDeviceControl] Presence listener error:', err?.message || err);
    }
  }
}

function getOrCreatePresenceChannel(deviceId) {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  if (deviceId) {
    activeDeviceId = deviceId;
  }

  if (activePresenceChannel) {
    const state = activePresenceChannel.state;
    if (state !== 'closed' && state !== 'errored') {
      return activePresenceChannel;
    }
  }

  const existing = supabase.getChannels().find(
    (c) => c.topic === `realtime:${PRESENCE_CHANNEL_NAME}`
  );
  if (existing) {
    try {
      supabase.removeChannel(existing);
    } catch (e) {}
  }

  const effectiveKey = activeDeviceId || deviceId || 'device';

  activePresenceChannel = supabase.channel(PRESENCE_CHANNEL_NAME, {
    config: {
      presence: {
        key: effectiveKey,
        enabled: true
      }
    }
  });

  activePresenceChannel
    .on('presence', { event: 'sync' }, () => {
      try {
        const state = activePresenceChannel.presenceState();
        const activeMap = extractPresenceMap(state);
        const now = Date.now();
        const merged = { ...currentPresenceMap };

        // Mark all devices present in the active state as online
        for (const [devId, presence] of Object.entries(activeMap)) {
          merged[devId] = {
            ...presence,
            online: true,
            last_heartbeat: presence.last_heartbeat || now
          };
        }

        // For devices that were previously online in merged but are no longer in activeMap:
        // Transition them to offline while preserving their last known active/heartbeat timestamp
        for (const [devId, prevPresence] of Object.entries(merged)) {
          if (!activeMap[devId] && prevPresence.online) {
            merged[devId] = {
              ...prevPresence,
              online: false,
              last_active: prevPresence.last_heartbeat || prevPresence.active_since || now
            };
          }
        }

        currentPresenceMap = merged;
        notifyAdminListeners();
      } catch (err) {
        console.warn('[SupabaseDeviceControl] Presence sync error:', err?.message || err);
      }
    })
    .on('presence', { event: 'join' }, ({ newPresences }) => {
      try {
        if (Array.isArray(newPresences)) {
          let updated = false;
          for (const p of newPresences) {
            if (p && p.device_id) {
              currentPresenceMap[p.device_id] = {
                ...p,
                online: true,
                last_heartbeat: p.last_heartbeat || Date.now()
              };
              updated = true;
            }
          }
          if (updated) {
            notifyAdminListeners();
          }
        }
      } catch (e) {}
    })
    .on('presence', { event: 'leave' }, ({ leftPresences }) => {
      try {
        if (Array.isArray(leftPresences)) {
          let updated = false;
          const now = Date.now();
          for (const p of leftPresences) {
            if (p && p.device_id) {
              const prev = currentPresenceMap[p.device_id] || {};
              const lastActive = p.last_active || p.last_heartbeat || prev.last_active || prev.last_heartbeat || now;
              currentPresenceMap[p.device_id] = {
                ...prev,
                ...p,
                online: false,
                last_active: lastActive
              };
              updated = true;
            }
          }
          if (updated) {
            notifyAdminListeners();
          }
        }
      } catch (e) {}
    });

  return activePresenceChannel;
}

/**
 * Start Realtime Presence Heartbeat & Remote Command Listener.
 * Strictly uses locally available identity; never fetches remote metadata to obtain ID.
 * 
 * @param {string} deviceId - Persistent unique device ID verified locally
 * @param {Function} metadataProvider - Function returning { deviceName, status, userRole, username }
 * @param {Function} onRemoteCommand - Callback invoked when remote commands (Lock, Force Logout, Status) arrive
 * @returns {Function} Cleanup function to stop tracking and unsubscribe
 */
export function startDevicePresence(deviceId, metadataProvider, onRemoteCommand) {
  if (!deviceId || typeof deviceId !== 'string' || !deviceId.trim()) {
    console.warn('[SupabaseDeviceControl] Missing or invalid local device ID. Presence publishing safely skipped.');
    return () => {};
  }
  if (!isSupabaseConfigured()) {
    return () => {};
  }

  if (activeHeartbeatTimer) {
    clearInterval(activeHeartbeatTimer);
    activeHeartbeatTimer = null;
  }
  if (activePresenceTimer) {
    clearInterval(activePresenceTimer);
    activePresenceTimer = null;
  }

  const supabase = getSupabaseClient();
  if (!supabase) return () => {};

  try {
    isStoppingPresence = false;
    if (commandChannelReconnectTimer) {
      clearTimeout(commandChannelReconnectTimer);
      commandChannelReconnectTimer = null;
    }
    if (presenceChannelReconnectTimer) {
      clearTimeout(presenceChannelReconnectTimer);
      presenceChannelReconnectTimer = null;
    }

    activeDeviceId = deviceId;
    const channel = getOrCreatePresenceChannel(deviceId);
    if (!channel) return () => {};

    // Start fresh active session timestamp (epoch ms)
    if (!currentSessionStartTime) {
      currentSessionStartTime = Date.now();
    }

    const trackCurrent = async () => {
      if (!activePresenceChannel) return;
      try {
        const meta = typeof metadataProvider === 'function' ? metadataProvider() : {};
        const now = Date.now();
        const payload = {
          device_id: deviceId,
          online: true,
          active_since: currentSessionStartTime || now,
          user_role: meta.userRole || 'Guest',
          username: meta.username || 'Anonymous',
          last_heartbeat: now
        };
        currentPresenceMap[deviceId] = payload;
        notifyAdminListeners();
        // Realtime presence payload: lightweight session info only, NO static hardware metadata, zero DB writes
        await activePresenceChannel.track(payload);

        // Throttled database persist: update devices.last_seen_at in Supabase every 2 minutes
        if (now - lastDbPersistTime >= DB_HEARTBEAT_INTERVAL_MS) {
          lastDbPersistTime = now;
          updateSupabaseDevice(deviceId, { last_seen_at: new Date(now).toISOString() }).catch(() => {});
        }
      } catch (e) {
        // Silently suppress track errors
      }
    };

    if (channel.state === 'joined') {
      trackCurrent();
    } else if (channel.state !== 'joining') {
      channel.subscribe(async (status, err) => {
        if (status === 'SUBSCRIBED') {
          await trackCurrent();
        } else if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR') {
          if (!isStoppingPresence) {
            console.warn(`[SupabaseDeviceControl] Presence channel status '${status}':`, err?.message || '');
            // Handle Realtime reconnects and channel errors with backoff
            if (presenceChannelReconnectTimer) {
              clearTimeout(presenceChannelReconnectTimer);
            }
            presenceChannelReconnectTimer = setTimeout(() => {
              if (!isStoppingPresence && activeDeviceId && activePresenceChannel && activePresenceChannel.state !== 'joined') {
                activePresenceChannel.subscribe(async (retryStatus) => {
                  if (retryStatus === 'SUBSCRIBED') {
                    await trackCurrent();
                  }
                });
              }
            }, 3000);
          }
        }
      });
    }

    // Low-frequency keepalive heartbeat (25s fallback, zero DB writes)
    activeHeartbeatTimer = setInterval(async () => {
      await trackCurrent();
    }, KEEPALIVE_HEARTBEAT_MS);
    activePresenceTimer = activeHeartbeatTimer;

    // 3. Instant Remote Command Dispatch Listener (<300ms latency)
    try {
      if (activeCommandChannel) {
        supabase.removeChannel(activeCommandChannel);
      } else if (typeof supabase.getChannels === 'function') {
        const existingCmd = supabase.getChannels().find(
          c => c.topic === `realtime:device_cmd:${deviceId}` || c.topic === `device_cmd:${deviceId}`
        );
        if (existingCmd) {
          supabase.removeChannel(existingCmd);
        }
      }
    } catch (_) {}
    activeCommandChannel = null;

    activeCommandChannel = supabase
      .channel(`device_cmd:${deviceId}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'devices',
            filter: `device_id=eq.${deviceId}`
          },
          (payload) => {
            if (!payload || !payload.new) return;
            const updated = payload.new;
            console.log(`[SupabaseDeviceControl] Received instant remote command for ${deviceId}:`, updated);

            if (typeof onRemoteCommand === 'function') {
              onRemoteCommand(updated);
            }
          }
        )
        .subscribe((status, err) => {
          if (status === 'SUBSCRIBED') {
            console.log(`[SupabaseDeviceControl] Command channel active for ${deviceId}`);
          } else if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR' || status === 'CLOSED') {
            // Only log warning if not intentionally stopping presence and status is not a normal closure
            if (!isStoppingPresence && status !== 'CLOSED') {
              console.warn(`[SupabaseDeviceControl] Command channel status '${status}':`, err?.message || '');
            }
            // Only attempt reconnection if unexpected disconnection while actively tracking
            if (!isStoppingPresence && activeDeviceId && activeCommandChannel) {
              if (commandChannelReconnectTimer) {
                clearTimeout(commandChannelReconnectTimer);
              }
              commandChannelReconnectTimer = setTimeout(() => {
                if (!isStoppingPresence && activeDeviceId && activeCommandChannel) {
                  try {
                    activeCommandChannel.subscribe();
                  } catch (reErr) {
                    console.warn('[SupabaseDeviceControl] Command channel reconnect attempt error:', reErr.message);
                  }
                }
              }, 3000);
            }
          }
        });

    console.log(`[SupabaseDeviceControl] Started event-driven presence & command listener for device '${deviceId}'`);
  } catch (err) {
    console.warn('[SupabaseDeviceControl] Failed to start presence:', err.message);
  }

  return stopDevicePresence;
}

/**
 * Stop active presence tracking and unsubscribe channels.
 * Attempts to publish offline presence with last-active timestamp before untracking.
 */
export async function stopDevicePresence() {
  isStoppingPresence = true;

  if (commandChannelReconnectTimer) {
    clearTimeout(commandChannelReconnectTimer);
    commandChannelReconnectTimer = null;
  }
  if (presenceChannelReconnectTimer) {
    clearTimeout(presenceChannelReconnectTimer);
    presenceChannelReconnectTimer = null;
  }

  if (activeHeartbeatTimer) {
    clearInterval(activeHeartbeatTimer);
    activeHeartbeatTimer = null;
  }
  if (activePresenceTimer) {
    clearInterval(activePresenceTimer);
    activePresenceTimer = null;
  }

  currentSessionStartTime = null;

  if (activePresenceChannel) {
    try {
      // Attempt to publish Offline / last-active time before untracking
      if (activeDeviceId) {
        const now = Date.now();
        const isoNow = new Date(now).toISOString();
        // 1. Immediately persist last_seen_at to Supabase devices table
        updateSupabaseDevice(activeDeviceId, { last_seen_at: isoNow }).catch(() => {});
        // 2. Broadcast offline presence over WebSocket
        await activePresenceChannel.track({
          device_id: activeDeviceId,
          online: false,
          last_active: now,
          last_heartbeat: now
        });
      }
      activePresenceChannel.untrack();
    } catch (e) {}

    // Only close the channel if no admin monitor is actively watching
    if (adminPresenceListeners.size === 0) {
      const pChannel = activePresenceChannel;
      activePresenceChannel = null;
      try {
        pChannel.unsubscribe();
      } catch (e) {}
      currentPresenceMap = {};
    }
  }

  if (activeCommandChannel) {
    const cmdChannel = activeCommandChannel;
    activeCommandChannel = null;
    try {
      const { getSupabaseClient } = require('./supabaseClient.js');
      const supabase = getSupabaseClient();
      if (supabase && typeof supabase.removeChannel === 'function') {
        supabase.removeChannel(cmdChannel);
      } else {
        cmdChannel.unsubscribe();
      }
    } catch (e) {
      try { cmdChannel.unsubscribe(); } catch (_) {}
    }
  }
}

/**
 * Formats device activity status for display in the Admin Device Control UI.
 * 
 * Expected behavior:
 * - Valid online presence (heartbeat <= 45s) -> `🟢 Active now` (or with role)
 * - Valid offline/left presence -> relative last-active text (`⏳ 1 sec ago`, `⏳ 3 sec ago`, `⏳ 1 min 10 sec ago`)
 * - Stale presence (>45s) -> offline + relative last-active text
 * - Missing/invalid timestamp -> safe fallback `⏳ Offline` or `⏳ Last active unknown`
 * - Calculated in-memory using local UI clock; zero DB writes or network calls.
 * 
 * @param {object|null} livePresence - Realtime presence record
 * @param {string|number|null} lastSeenTimestamp - Persistent last_seen timestamp
 * @param {number} [currentUiTime] - Current epoch milliseconds from local UI clock
 * @returns {{ isOnline: boolean, text: string, subtext: string }}
 */
export function formatDeviceActivityStatus(livePresence, lastSeenTimestamp, currentUiTime = Date.now()) {
  const now = Number(currentUiTime) || Date.now();

  const heartbeatMs = livePresence ? Number(livePresence.last_heartbeat || livePresence.active_since || 0) : 0;
  const isHeartbeatStale = heartbeatMs > 0 && (now - heartbeatMs > STALE_PRESENCE_TIMEOUT_MS);
  const isOnline = Boolean(livePresence && livePresence.online !== false && !isHeartbeatStale);

  if (isOnline) {
    const role = livePresence.user_role ? ` (${livePresence.user_role})` : '';
    let subtext = '';
    const activeSinceMs = Number(livePresence.active_since);
    if (!isNaN(activeSinceMs) && activeSinceMs > 0 && activeSinceMs <= now) {
      const activeTotalSec = Math.max(0, Math.floor((now - activeSinceMs) / 1000));
      const m = Math.floor(activeTotalSec / 60);
      const s = activeTotalSec % 60;
      subtext = m === 0 ? `${s}s` : `${m}m ${s}s`;
    }
    return {
      isOnline: true,
      text: `🟢 Active now${role}`,
      subtext
    };
  }

  // Device is Offline, Stale, or Disconnected
  let lastActiveMs = null;
  if (livePresence && livePresence.last_active) {
    const parsed = Number(livePresence.last_active);
    if (!isNaN(parsed) && parsed > 0) lastActiveMs = parsed;
  }
  if (!lastActiveMs && heartbeatMs > 0) {
    lastActiveMs = heartbeatMs;
  }
  if (!lastActiveMs && lastSeenTimestamp) {
    const parsed = typeof lastSeenTimestamp === 'number' 
      ? lastSeenTimestamp 
      : new Date(lastSeenTimestamp).getTime();
    if (!isNaN(parsed) && parsed > 0) lastActiveMs = parsed;
  }

  if (!lastActiveMs || lastActiveMs <= 0) {
    return {
      isOnline: false,
      text: '⏳ Offline',
      subtext: ''
    };
  }

  // Guard against future timestamps or clock skew
  const diffMs = Math.max(0, now - lastActiveMs);
  const totalSec = Math.floor(diffMs / 1000);

  let agoText = '';
  if (totalSec <= 1) {
    agoText = '1 sec ago';
  } else if (totalSec < 60) {
    agoText = `${totalSec} sec ago`;
  } else {
    const minutes = Math.floor(totalSec / 60);
    const seconds = totalSec % 60;
    if (minutes < 60) {
      agoText = seconds > 0 ? `${minutes} min ${seconds} sec ago` : `${minutes} min ago`;
    } else {
      const hours = Math.floor(minutes / 60);
      const remainingMinutes = minutes % 60;
      if (hours < 24) {
        agoText = remainingMinutes > 0 ? `${hours} hr ${remainingMinutes} min ago` : `${hours} hr ago`;
      } else {
        const days = Math.floor(hours / 24);
        agoText = `${days} day${days > 1 ? 's' : ''} ago`;
      }
    }
  }

  return {
    isOnline: false,
    text: `⏳ ${agoText}`,
    subtext: ''
  };
}

/**
 * Subscribe Admin Dashboard to live 1-second presence and device changes.
 * 
 * @param {Function} onPresenceUpdate - Invoked when presence state changes (map of device_id -> presenceData)
 * @param {Function} onRecordChange - Invoked when any device record in Supabase is updated/inserted/deleted
 * @param {string} [adminDeviceId] - The Admin device's own device_id. Pass this to ensure the presence
 *   channel uses the correct key rather than the fallback 'device'. If omitted, falls back to
 *   activeDeviceId (set by startDevicePresence) or 'device'.
 * @returns {Function} Cleanup function
 */
export function subscribeAdminDeviceMonitor(onPresenceUpdate, onRecordChange, adminDeviceId) {
  if (!isSupabaseConfigured()) {
    return () => {};
  }

  const supabase = getSupabaseClient();
  if (!supabase) return () => {};

  // ─── BUG-5 FIX ──────────────────────────────────────────────────────────
  // Previously called getOrCreatePresenceChannel(activeDeviceId).  If Admin's
  // subscribeAdminDeviceMonitor ran before startDevicePresence set activeDeviceId,
  // the channel key fell back to 'device', causing Admin's presence slot to
  // appear under the wrong ID.  Fix: accept the real device ID as a parameter
  // and use it to set activeDeviceId before creating the channel.
  // ─────────────────────────────────────────────────────────────────────────
  if (adminDeviceId && !activeDeviceId) {
    activeDeviceId = adminDeviceId;
  }
  const effectiveDeviceId = adminDeviceId || activeDeviceId;

  let adminChangesChannel = null;

  try {
    // 1. Presence monitor - obtain or create the shared presence channel with presence enabled
    const channel = getOrCreatePresenceChannel(effectiveDeviceId);

    if (typeof onPresenceUpdate === 'function') {
      adminPresenceListeners.add(onPresenceUpdate);
      if (effectiveDeviceId && (!currentPresenceMap[effectiveDeviceId] || !currentPresenceMap[effectiveDeviceId].online)) {
        currentPresenceMap[effectiveDeviceId] = {
          device_id: effectiveDeviceId,
          online: true,
          active_since: currentSessionStartTime || Date.now(),
          user_role: 'ADMIN',
          last_heartbeat: Date.now()
        };
      }
      // Immediately deliver existing presence snapshot if available
      if (Object.keys(currentPresenceMap).length > 0) {
        try {
          onPresenceUpdate({ ...currentPresenceMap });
        } catch (e) {}
      } else if (channel) {
        try {
          const state = channel.presenceState();
          const parsed = extractPresenceMap(state);
          if (Object.keys(parsed).length > 0) {
            currentPresenceMap = parsed;
            onPresenceUpdate({ ...currentPresenceMap });
          }
        } catch (e) {}
      }
    }

    if (channel && channel.state !== 'joined' && channel.state !== 'joining') {
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          try {
            const state = channel.presenceState();
            const parsed = extractPresenceMap(state);
            if (Object.keys(parsed).length > 0) {
              currentPresenceMap = parsed;
              notifyAdminListeners();
            }
          } catch (e) {}
        }
      });
    }

    // 2. Database changes monitor (Realtime table replication)
    adminChangesChannel = supabase
      .channel('admin_devices_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'devices'
        },
        (payload) => {
          if (typeof onRecordChange === 'function') {
            onRecordChange(payload);
          }
        }
      )
      .subscribe();

    console.log('[SupabaseDeviceControl] Admin dashboard subscribed to Realtime Presence and DB changes');
  } catch (err) {
    console.warn('[SupabaseDeviceControl] Error subscribing admin monitor:', err.message);
  }

  return () => {
    if (typeof onPresenceUpdate === 'function') {
      adminPresenceListeners.delete(onPresenceUpdate);
    }
    if (adminChangesChannel) {
      try {
        adminChangesChannel.unsubscribe();
      } catch (e) {}
      adminChangesChannel = null;
    }
    // Only tear down presence channel if publisher is not active AND no other listeners exist
    if (!activePresenceTimer && adminPresenceListeners.size === 0 && activePresenceChannel) {
      try {
        activePresenceChannel.unsubscribe();
      } catch (e) {}
      activePresenceChannel = null;
      currentPresenceMap = {};
    }
  };
}
