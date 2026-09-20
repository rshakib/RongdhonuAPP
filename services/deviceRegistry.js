import * as Device from 'expo-device';
import * as Application from 'expo-application';
import { Platform } from 'react-native';
import { getDb, setAppConfig, ACTIVE_APP_PROFILE } from '../database';
import { APP_VERSION } from './firebaseAppConfig.js';
import { upsertDeviceToSupabase, updateSupabaseDevice, fetchSupabaseDevices, fetchSingleSupabaseDevice, clearForceLogoutIfMatching } from './supabaseDeviceControl.js';

/**
 * Device Access Control Layer — Phase 1, 2, 3, 4, 5 & Phase 6 + Dedicated Supabase Realtime
 */

let lastFlushedLastSeen = null;

/**
 * Update last_seen to NOW and push to Supabase.
 * Keeps local SQLite in sync and updates Supabase.
 */
export function checkAndFlushLastSeen() {
  try {
    const db = getDb();
    const record = getCurrentDeviceRecord();
    if (!record) return false;

    // Update last_seen to current time locally
    const now = new Date().toISOString();
    const currentVer = APP_VERSION || '1.0.3';
    const hasVersionChanged = record.app_version !== currentVer;

    if (hasVersionChanged) {
      db.runSync(
        "UPDATE device_registry SET last_seen = ?, app_version = ?, updated_at = ? WHERE id = ?",
        [now, currentVer, now, record.id]
      );
      updateSupabaseDevice(record.device_id, { last_seen_at: now, app_version: currentVer });
      console.log(`[DeviceRegistry] Updated last_seen to ${now} and app_version to ${currentVer} for device '${record.device_id}'`);
    } else {
      db.runSync(
        "UPDATE device_registry SET last_seen = ?, updated_at = ? WHERE id = ?",
        [now, now, record.id]
      );
      updateSupabaseDevice(record.device_id, { last_seen_at: now });
      console.log(`[DeviceRegistry] Updated last_seen to ${now} for device '${record.device_id}'`);
    }
    return true;
  } catch (err) {
    console.error("[DeviceRegistry] Error in checkAndFlushLastSeen:", err);
  }
  return false;
}

/**
 * Generates or retrieves a stable, persistent device ID.
 * @param {object} db 
 * @returns {Promise<string>} Unique persistent device ID
 */
async function getPersistentDeviceId(db) {
  // Priority 1: Try hardware-based Android ID (persists across reinstalls)
  try {
    let androidId = null;
    if (typeof Application.getAndroidIdAsync === 'function') {
      androidId = await Application.getAndroidIdAsync();
    } else if (Application.androidId) {
      androidId = Application.androidId;
    }
    if (androidId && typeof androidId === 'string' && androidId.trim().length > 0) {
      const hardwareId = `android_${androidId.trim()}`;
      // Save to app_config for faster lookups
      try {
        const now = new Date().toISOString();
        db.runSync(
          "INSERT OR REPLACE INTO app_config (key, value, updated_at) VALUES ('persistent_device_id', ?, ?)",
          [hardwareId, now]
        );
      } catch (e) {}
      return hardwareId;
    }
  } catch (e) {
    console.log("[DeviceRegistry] Could not get hardware Android ID:", e.message);
  }

  // Priority 2: Check if we have a stored ID in local DB
  try {
    const storedRow = db.getFirstSync("SELECT value FROM app_config WHERE key = 'persistent_device_id'");
    if (storedRow && storedRow.value) {
      return storedRow.value;
    }
  } catch (e) {}

  // Priority 3: Generate deterministic ID based on hardware info (brand + model)
  // This helps identify same device even after reinstall
  try {
    const brand = Device.brand || Device.manufacturer || 'unknown';
    const model = Device.modelName || Device.designName || 'unknown';
    const deterministicSeed = `${brand.toLowerCase()}_${model.toLowerCase()}`.replace(/[^a-z0-9]/g, '_');
    // Create a simple hash from the seed
    let hash = 0;
    for (let i = 0; i < deterministicSeed.length; i++) {
      const char = deterministicSeed.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    const deterministicId = `hw_${Math.abs(hash).toString(36)}_${deterministicSeed.substring(0, 20)}`;

    const now = new Date().toISOString();
    db.runSync(
      "INSERT OR REPLACE INTO app_config (key, value, updated_at) VALUES ('persistent_device_id', ?, ?)",
      [deterministicId, now]
    );
    console.log(`[DeviceRegistry] Generated deterministic device ID: ${deterministicId}`);
    return deterministicId;
  } catch (err) {
    console.error("[DeviceRegistry] Error generating deterministic ID:", err);
  }

  // Priority 4: Last resort - random UUID (will create duplicate on reinstall)
  try {
    const newDeviceId = `dev_uuid_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
    const now = new Date().toISOString();
    db.runSync(
      "INSERT OR REPLACE INTO app_config (key, value, updated_at) VALUES ('persistent_device_id', ?, ?)",
      [newDeviceId, now]
    );
    return newDeviceId;
  } catch (err) {
    console.error("[DeviceRegistry] Error accessing persistent device ID:", err);
    return `dev_fallback_${Date.now()}`;
  }
}

let lastLifecycleEventId = null;
let lastLifecycleTimestamp = 0;

// Mutex: prevents concurrent Device Control Refresh operations from racing each other
let isDeviceRegistryRefreshInProgress = false;

/**
 * Reconcile Admin device fleet from Supabase into local SQLite.
 * Compares all required metadata and status fields and updates SQLite only when fields differ.
 *
 * @param {Array|null} prefetchedList
 */
export async function reconcileAdminFleet(prefetchedList = null) {
  // TODO: If OWNER is granted Device Control screen access in the future, enable full device fleet fetching and reconciliation for OWNER here.
  if (ACTIVE_APP_PROFILE !== 'ADMIN') return;
  try {
    const remoteList = prefetchedList || await fetchSupabaseDevices();
    if (!Array.isArray(remoteList) || remoteList.length === 0) return;

    const db = getDb();
    const localRows = db.getAllSync("SELECT * FROM device_registry");
    const localMap = new Map();
    for (const r of localRows) {
      localMap.set(r.device_id, r);
    }

    for (const rem of remoteList) {
      const local = localMap.get(rem.device_id);
      if (!local) {
        syncRemoteDeviceToLocal(rem);
      } else {
        const needsSync =
          local.status !== rem.status ||
          Number(local.allow_login || 0) !== (rem.allow_login ? 1 : 0) ||
          Number(local.allow_offline || 0) !== (rem.allow_offline ? 1 : 0) ||
          Number(local.admin_lock || 0) !== (rem.admin_lock ? 1 : 0) ||
          Number(local.force_logout || 0) !== (rem.force_logout ? 1 : 0) ||
          Number(local.is_deleted || 0) !== (rem.is_deleted ? 1 : 0) ||
          local.device_name !== (rem.device_name || '') ||
          local.app_version !== (rem.app_version || '') ||
          local.android_version !== (rem.android_version || '') ||
          local.manufacturer !== (rem.manufacturer || '') ||
          local.brand !== (rem.brand || '') ||
          local.model !== (rem.model || '');

        if (needsSync) {
          syncRemoteDeviceToLocal(rem);
        }
      }
    }
  } catch (err) {
    console.warn('[DeviceRegistry] Admin fleet reconciliation error:', err.message);
  }
}

/**
 * Ensures `device_registry` table exists and registers / updates current device telemetry.
 * Supports lifecycle event deduplication for same-event callbacks.
 *
 * @param {object} options - { eventId?: string, isResume?: boolean }
 */
export async function registerDeviceIfNeeded(options = {}) {
  // Deduplicate callbacks belonging to the EXACT same lifecycle event
  const eventId = options?.eventId || null;
  if (eventId && eventId === lastLifecycleEventId && Date.now() - lastLifecycleTimestamp < 500) {
    return;
  }
  if (eventId) {
    lastLifecycleEventId = eventId;
    lastLifecycleTimestamp = Date.now();
  }

  const db = getDb();

  db.runSync(`
    CREATE TABLE IF NOT EXISTS device_registry (
      id TEXT PRIMARY KEY,
      device_id TEXT UNIQUE NOT NULL,
      device_name TEXT,
      manufacturer TEXT,
      brand TEXT,
      model TEXT,
      android_version TEXT,
      app_version TEXT,
      first_install_time TEXT,
      last_seen TEXT,
      allow_login INTEGER DEFAULT 0,
      allow_offline INTEGER DEFAULT 0,
      status TEXT DEFAULT 'PENDING',
      registered_by TEXT,
      notes TEXT,
      created_at TEXT,
      updated_at TEXT,
      is_synced INTEGER DEFAULT 0,
      admin_lock INTEGER DEFAULT 0,
      force_logout INTEGER DEFAULT 0,
      is_deleted INTEGER DEFAULT 0,
      deleted_at TEXT,
      deleted_by TEXT
    );
  `);

  // Migration: Ensure missing columns (is_synced, admin_lock, force_logout, is_deleted, deleted_at, deleted_by) exist
  try {
    const cols = db.getAllSync("PRAGMA table_info('device_registry')").map(c => c.name);
    if (!cols.includes('is_synced')) {
      db.runSync("ALTER TABLE device_registry ADD COLUMN is_synced INTEGER DEFAULT 0;");
    }
    if (!cols.includes('admin_lock')) {
      db.runSync("ALTER TABLE device_registry ADD COLUMN admin_lock INTEGER DEFAULT 0;");
    }
    if (!cols.includes('force_logout')) {
      db.runSync("ALTER TABLE device_registry ADD COLUMN force_logout INTEGER DEFAULT 0;");
    }
    if (!cols.includes('force_logout_token')) {
      db.runSync("ALTER TABLE device_registry ADD COLUMN force_logout_token TEXT;");
    }
    if (!cols.includes('is_deleted')) {
      db.runSync("ALTER TABLE device_registry ADD COLUMN is_deleted INTEGER DEFAULT 0;");
    }
    if (!cols.includes('deleted_at')) {
      db.runSync("ALTER TABLE device_registry ADD COLUMN deleted_at TEXT;");
    }
    if (!cols.includes('deleted_by')) {
      db.runSync("ALTER TABLE device_registry ADD COLUMN deleted_by TEXT;");
    }
  } catch (e) {}

  const deviceId = await getPersistentDeviceId(db);
  const deviceName = Device.deviceName || Device.modelName || 'Android Device';
  const manufacturer = Device.manufacturer || 'Android';
  const brand = Device.brand || manufacturer || 'Android';
  const model = Device.modelName || Device.designName || Platform.OS;
  const androidVersion = Device.osVersion || String(Platform.Version || '');
  const isExpoGo = Application.applicationId === 'host.exp.exponent' || Application.nativeApplicationVersion?.startsWith('56.');
  const appVersion = isExpoGo ? APP_VERSION : (APP_VERSION || Application.nativeApplicationVersion || '1.0.3');

  const now = new Date().toISOString();

  const existingRecord = db.getFirstSync(
    "SELECT * FROM device_registry WHERE device_id = ?",
    [deviceId]
  );

  if (!existingRecord) {
    const recordId = deviceId;

    db.runSync(`
      INSERT INTO device_registry (
        id, device_id, device_name, manufacturer, brand, model,
        android_version, app_version, first_install_time, last_seen,
        allow_login, allow_offline, status, registered_by, notes,
        created_at, updated_at, admin_lock, force_logout, is_deleted
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'PENDING', 'system', 'Auto registered on app startup', ?, ?, 0, 0, 0)
    `, [
      recordId,
      deviceId,
      deviceName,
      manufacturer,
      brand,
      model,
      androidVersion,
      appVersion,
      now,
      now,
      now,
      now
    ]);

    const newRecord = db.getFirstSync("SELECT * FROM device_registry WHERE id = ?", [recordId]);
    if (newRecord) {
      upsertDeviceToSupabase(newRecord);
    }
    lastFlushedLastSeen = now;
    console.log(`[DeviceRegistry] Successfully registered new device: ${deviceId} (status: PENDING)`);
  } else if (Number(existingRecord.is_deleted || 0) !== 1) {
    // ─── BUG-1 / BUG-4 FIX ─────────────────────────────────────────────────
    // On every startup the device previously upserted its FULL local record
    // (including stale status=PENDING) to Supabase, overwriting any Admin
    // approval.  The fix: fetch the authoritative remote record FIRST and sync
    // it into local SQLite, so the local DB always reflects the latest admin
    // decision before we do anything else.  Then push only hardware-metadata
    // fields to Supabase — never admin-controlled fields (status, allow_login,
    // admin_lock, force_logout).
    // ────────────────────────────────────────────────────────────────────────
    let remoteRecord = null;
    let confirmedMissing = false;

    // TODO: If OWNER is granted Device Control screen access in the future, enable full device fleet fetching and reconciliation for OWNER here.
    if (ACTIVE_APP_PROFILE === 'ADMIN') {
      try {
        const remoteList = await fetchSupabaseDevices();
        if (Array.isArray(remoteList)) {
          remoteRecord = remoteList.find(r => r.device_id === deviceId);
          confirmedMissing = !remoteRecord;
          // Run complete Admin fleet reconciliation
          await reconcileAdminFleet(remoteList);
        }
      } catch (syncErr) {
        // Non-fatal: network offline or Supabase unavailable — continue with local state
        console.warn(`[DeviceRegistry] Could not fetch remote device state on startup (offline?): ${syncErr.message}`);
      }
    } else {
      // MANAGER and OWNER: Strictly forbidden from querying the full device fleet.
      // MANAGER and OWNER: Strictly forbidden from querying remote Supabase metadata or fleet solely for Device Control
      // They perform only a lightweight single-device-row self-check.
      try {
        const singleRes = await fetchSingleSupabaseDevice(deviceId);
        if (singleRes && singleRes.success) {
          remoteRecord = singleRes.record;
          confirmedMissing = Boolean(singleRes.notFound);
        }
      } catch (syncErr) {
        console.warn(`[DeviceRegistry] Non-admin could not fetch single device state: ${syncErr.message}`);
      }
    }

    if (remoteRecord) {
      // Apply authoritative remote state to local SQLite first
      syncRemoteDeviceToLocal(remoteRecord);
      console.log(`[DeviceRegistry] Synced remote state (status=${remoteRecord.status}) to local for: ${deviceId}`);
    } else if (confirmedMissing) {
      // Only upsert when query succeeded and confirmed row is missing on remote (NOT on network errors)
      upsertDeviceToSupabase(existingRecord);
    }

    // Hardware metadata diffing: Check if any local telemetry changed from remote record
    const changedFields = {};
    if (remoteRecord) {
      if (remoteRecord.app_version !== appVersion) changedFields.app_version = appVersion;
      if (remoteRecord.android_version !== androidVersion) changedFields.android_version = androidVersion;
      if (remoteRecord.device_name !== (existingRecord.device_name || deviceName) && (existingRecord.device_name || deviceName)) {
        changedFields.device_name = existingRecord.device_name || deviceName;
      }
      if (remoteRecord.manufacturer !== (existingRecord.manufacturer || manufacturer)) {
        changedFields.manufacturer = existingRecord.manufacturer || manufacturer;
      }
      if (remoteRecord.brand !== (existingRecord.brand || brand)) {
        changedFields.brand = existingRecord.brand || brand;
      }
      if (remoteRecord.model !== (existingRecord.model || model)) {
        changedFields.model = existingRecord.model || model;
      }
    } else if (existingRecord) {
      if (existingRecord.app_version !== appVersion) changedFields.app_version = appVersion;
      if (existingRecord.android_version !== androidVersion) changedFields.android_version = androidVersion;
    }

    const hasMetadataChanged = Object.keys(changedFields).length > 0;

    // Update local SQLite telemetry
    db.runSync(`
      UPDATE device_registry
      SET last_seen = ?, app_version = ?, android_version = ?, updated_at = ?
      WHERE device_id = ?
    `, [now, appVersion, androidVersion, now, deviceId]);

    if (hasMetadataChanged) {
      // Push ONLY metadata to Supabase — exclude admin-controlled fields
      // so we never accidentally reset an approved device back to PENDING.
      try {
        await updateSupabaseDevice(deviceId, {
          last_seen_at: now,
          ...changedFields
        });
        console.log(`[DeviceRegistry] Updated device metadata locally and pushed to Supabase for: ${deviceId}`);
      } catch (metaErr) {
        console.warn(`[DeviceRegistry] Could not push metadata update to Supabase: ${metaErr.message}`);
      }
    } else {
      console.log(`[DeviceRegistry] Metadata is current for: ${deviceId}. Unnecessary Supabase upload avoided.`);
    }
  }
}

/**
 * Get device registry record for the current device.
 * @returns {object|null}
 */
export function getCurrentDeviceRecord() {
  try {
    const db = getDb();
    const storedRow = db.getFirstSync("SELECT value FROM app_config WHERE key = 'persistent_device_id'");
    if (!storedRow || !storedRow.value) {
      // No stored ID - try to find by hardware info
      const brand = Device.brand || Device.manufacturer || '';
      const model = Device.modelName || '';
      if (brand && model) {
        const record = db.getFirstSync(
          "SELECT * FROM device_registry WHERE LOWER(brand) = LOWER(?) AND LOWER(model) = LOWER(?) AND (is_deleted IS NULL OR is_deleted = 0) ORDER BY created_at DESC LIMIT 1",
          [brand, model]
        );
        if (record) return record;
      }
      // Last resort: get most recent non-deleted device
      return db.getFirstSync("SELECT * FROM device_registry WHERE (is_deleted IS NULL OR is_deleted = 0) ORDER BY created_at DESC LIMIT 1");
    }
    return db.getFirstSync("SELECT * FROM device_registry WHERE device_id = ?", [storedRow.value]);
  } catch (err) {
    console.error("[DeviceRegistry] Error fetching current device record:", err);
    return null;
  }
}

/**
 * Check whether a user with `userRole` is allowed to log in on this device.
 * @param {string} userRole 
 * @returns {object} { allowed: boolean, status: string, isAdminLock?: boolean, deviceId?: string, message?: string }
 */
export function checkDeviceLoginPermission(userRole) {
  const roleUpper = String(userRole || '').toUpperCase().trim();
  const deviceRecord = getCurrentDeviceRecord();
  const deviceId = deviceRecord ? deviceRecord.device_id : 'Unknown';
  const isDeleted = deviceRecord ? Number(deviceRecord.is_deleted || 0) === 1 : false;

  // FEATURE 6: LOGIN PROTECTION FOR DELETED DEVICES
  if (isDeleted) {
    return {
      allowed: false,
      status: 'DELETED',
      isAdminLock: false,
      deviceId,
      message: 'এই ডিভাইসটি অ্যাডমিন মুছে ফেলেছেন।\nঅনুগ্রহ করে অ্যাডমিনের সাথে যোগাযোগ করুন।'
    };
  }

  const status = deviceRecord ? String(deviceRecord.status || 'PENDING').toUpperCase().trim() : 'PENDING';
  const adminLock = deviceRecord ? Number(deviceRecord.admin_lock || 0) : 0;

  // 1. ADMIN LOCK CHECK (Stolen Device Protection)
  if (adminLock === 1) {
    return {
      allowed: false,
      status: 'BLOCKED',
      isAdminLock: true,
      deviceId,
      message: 'এই ডিভাইসটির এক্সেস অ্যাডমিন নিষ্ক্রিয় করেছেন। ডিভাইসটি হারানো/চুরি হিসেবে চিহ্নিত করা হয়েছে। অনুগ্রহ করে অ্যাডমিনের সাথে যোগাযোগ করুন।'
    };
  }

  // 2. ADMIN bypasses status check when adminLock == 0
  if (roleUpper === 'ADMIN') {
    return {
      allowed: true,
      status: 'BYPASS',
      deviceId,
      message: 'Admin bypass allowed'
    };
  }

  // 3. OWNER can login immediately unless status is BLOCKED
  if (roleUpper === 'OWNER') {
    if (status === 'BLOCKED') {
      return {
        allowed: false,
        status: 'BLOCKED',
        isAdminLock: false,
        deviceId,
        message: 'এই ডিভাইসটি অ্যাডমিন ব্লক করেছেন। এই ডিভাইস থেকে Login করা যাবে না।'
      };
    }
    return {
      allowed: true,
      status: 'BYPASS',
      deviceId,
      message: 'Owner bypass allowed'
    };
  }

  // 4. MANAGER (and all other roles) require ACTIVE approval
  if (status === 'PENDING') {
    return {
      allowed: false,
      status: 'PENDING',
      isAdminLock: false,
      deviceId,
      message: 'এই ডিভাইসটি এখনো অ্যাডমিন কর্তৃক অনুমোদিত হয়নি।'
    };
  }

  if (status === 'BLOCKED') {
    return {
      allowed: false,
      status: 'BLOCKED',
      isAdminLock: false,
      deviceId,
      message: 'এই ডিভাইসটি অ্যাডমিন ব্লক করেছেন। এই ডিভাইস থেকে Login করা যাবে না।'
    };
  }

  if (status === 'ACTIVE') {
    return {
      allowed: true,
      status: 'ACTIVE',
      deviceId,
      message: 'Device approved'
    };
  }

  return {
    allowed: false,
    status: status,
    deviceId,
    message: 'ডিভাইস এক্সেস যাচাই করা সম্ভব হয়নি।'
  };
}

/**
 * FEATURE 7: Get all active (non-deleted) registered devices from device_registry table.
 * @returns {Array} Array of active device records
 */
export function getAllRegisteredDevices() {
  try {
    const db = getDb();
    return db.getAllSync("SELECT * FROM device_registry WHERE is_deleted IS NULL OR is_deleted = 0 ORDER BY created_at DESC");
  } catch (err) {
    console.error("[DeviceRegistry] Error fetching all registered devices:", err);
    return [];
  }
}

/**
 * FEATURE 7: Get all soft-deleted devices from device_registry table.
 * @returns {Array} Array of soft-deleted device records
 */
export function getDeletedDevices() {
  try {
    const db = getDb();
    return db.getAllSync("SELECT * FROM device_registry WHERE is_deleted = 1 ORDER BY deleted_at DESC, created_at DESC");
  } catch (err) {
    console.error("[DeviceRegistry] Error fetching deleted devices:", err);
    return [];
  }
}

/**
 * FEATURE 2: Rename a device's display name.
 * Only updates device_name and updated_at/registered_by. Does NOT alter status, allow_login, etc.
 */
export function renameDevice(deviceId, newName, adminUsername = 'admin') {
  try {
    const db = getDb();
    const cleanName = String(newName || '').trim();
    if (!cleanName) throw new Error("Device name cannot be empty");

    const record = db.getFirstSync("SELECT * FROM device_registry WHERE device_id = ?", [deviceId]);
    if (!record) throw new Error(`Device record not found for device_id: ${deviceId}`);

    const now = new Date().toISOString();
    db.runSync(
      "UPDATE device_registry SET device_name = ?, registered_by = ?, updated_at = ? WHERE device_id = ?",
      [cleanName, adminUsername, now, deviceId]
    );

    updateSupabaseDevice(deviceId, {
      device_name: cleanName,
      registered_by: adminUsername
    });
    console.log(`[DeviceRegistry] Admin '${adminUsername}' renamed device '${deviceId}' to '${cleanName}' (Supabase Push)`);
    return true;
  } catch (err) {
    console.error("[DeviceRegistry] Error renaming device:", err);
    return false;
  }
}

/**
 * FEATURE 3: Soft-delete a device (is_deleted = 1, deleted_at = timestamp, deleted_by = admin).
 * Does NOT change status, allow_login, admin_lock, etc.
 */
export function softDeleteDevice(deviceId, adminUsername = 'admin') {
  try {
    const db = getDb();
    const record = db.getFirstSync("SELECT * FROM device_registry WHERE device_id = ?", [deviceId]);
    if (!record) throw new Error(`Device record not found for device_id: ${deviceId}`);

    const now = new Date().toISOString();
    db.runSync(
      "UPDATE device_registry SET is_deleted = 1, deleted_at = ?, deleted_by = ?, updated_at = ? WHERE device_id = ?",
      [now, adminUsername, now, deviceId]
    );

    updateSupabaseDevice(deviceId, {
      is_deleted: true,
      deleted_at: now,
      deleted_by: adminUsername
    });
    console.log(`[DeviceRegistry] Admin '${adminUsername}' soft-deleted device '${deviceId}' (Supabase Push)`);
    return true;
  } catch (err) {
    console.error("[DeviceRegistry] Error soft-deleting device:", err);
    return false;
  }
}

/**
 * FEATURE 5: Restore a soft-deleted device (is_deleted = 0, deleted_at = NULL, deleted_by = NULL).
 * Never forces status = ACTIVE or allow_login = 1. Restores exact previous configuration.
 */
export function restoreDevice(deviceId, adminUsername = 'admin') {
  try {
    const db = getDb();
    const record = db.getFirstSync("SELECT * FROM device_registry WHERE device_id = ?", [deviceId]);
    if (!record) throw new Error(`Device record not found for device_id: ${deviceId}`);

    const now = new Date().toISOString();
    db.runSync(
      "UPDATE device_registry SET is_deleted = 0, deleted_at = NULL, deleted_by = NULL, updated_at = ? WHERE device_id = ?",
      [now, deviceId]
    );

    updateSupabaseDevice(deviceId, {
      is_deleted: false,
      deleted_at: null,
      deleted_by: null
    });
    console.log(`[DeviceRegistry] Admin '${adminUsername}' restored device '${deviceId}' (Supabase Push)`);
    return true;
  } catch (err) {
    console.error("[DeviceRegistry] Error restoring device:", err);
    return false;
  }
}

/**
 * Step 8: Update a device's approval status (Admin action - Immediate Push).
 */
export async function updateDeviceStatus(deviceId, newStatus, adminUsername = 'admin') {
  try {
    const db = getDb();
    const cleanStatus = String(newStatus || '').toUpperCase().trim();
    if (!['ACTIVE', 'BLOCKED', 'PENDING'].includes(cleanStatus)) {
      throw new Error(`Invalid status: ${newStatus}`);
    }

    const record = db.getFirstSync("SELECT * FROM device_registry WHERE device_id = ?", [deviceId]);
    if (!record) {
      throw new Error(`Device record not found for device_id: ${deviceId}`);
    }

    const allowLogin = cleanStatus === 'ACTIVE' ? 1 : 0;
    const now = new Date().toISOString();

    const remoteOk = await updateSupabaseDevice(deviceId, {
      status: cleanStatus,
      allow_login: allowLogin === 1,
      registered_by: adminUsername
    });

    if (!remoteOk) {
      console.warn(`[DeviceRegistry] Remote status update failed for ${deviceId}`);
      return { success: false, error: 'সার্ভারে স্ট্যাটাস আপডেট ব্যর্থ হয়েছে' };
    }

    const sql = `
      UPDATE device_registry
      SET status = ?, allow_login = ?, registered_by = ?, updated_at = ?
      WHERE device_id = ?
    `;
    const params = [cleanStatus, allowLogin, adminUsername, now, deviceId];
    db.runSync(sql, params);

    console.log(`[DeviceRegistry] Admin '${adminUsername}' updated device '${deviceId}' status to '${cleanStatus}' (Supabase Push Confirmed)`);
    return { success: true };
  } catch (err) {
    console.error("[DeviceRegistry] Error updating device status:", err);
    return { success: false, error: err.message };
  }
}

/**
 * Step 8: Update device offline permission (Admin action - Immediate Push).
 */
export async function updateDeviceOfflinePermission(deviceId, allowOffline, adminUsername = 'admin') {
  try {
    const db = getDb();
    const allowVal = allowOffline ? 1 : 0;
    const now = new Date().toISOString();

    const record = db.getFirstSync("SELECT * FROM device_registry WHERE device_id = ?", [deviceId]);
    if (!record) {
      throw new Error(`Device record not found for device_id: ${deviceId}`);
    }

    const remoteOk = await updateSupabaseDevice(deviceId, {
      allow_offline: allowVal === 1,
      registered_by: adminUsername
    });

    if (!remoteOk) {
      console.warn(`[DeviceRegistry] Remote offline permission update failed for ${deviceId}`);
      return { success: false, error: 'সার্ভারে অফলাইন অনুমতি আপডেট ব্যর্থ হয়েছে' };
    }

    db.runSync(`
      UPDATE device_registry
      SET allow_offline = ?, registered_by = ?, updated_at = ?
      WHERE device_id = ?
    `, [allowVal, adminUsername, now, deviceId]);

    console.log(`[DeviceRegistry] Admin '${adminUsername}' set allow_offline=${allowVal} for device '${deviceId}' (Supabase Push Confirmed)`);
    return { success: true };
  } catch (err) {
    console.error("[DeviceRegistry] Error updating offline permission:", err);
    return { success: false, error: err.message };
  }
}

/**
 * Check whether current device has offline permission enabled.
 */
export function checkDeviceOfflinePermission(userRole) {
  const roleUpper = String(userRole || '').toUpperCase().trim();
  if (roleUpper === 'ADMIN') {
    return true;
  }

  const deviceRecord = getCurrentDeviceRecord();
  if (!deviceRecord) return false;

  return Number(deviceRecord.allow_offline || 0) === 1;
}

/**
 * Step 8: Set or remove Admin Lock for a device (Async Verified Push).
 */
export async function setAdminDeviceLock(deviceId, enableLock, adminUsername = 'admin') {
  try {
    const db = getDb();
    const now = new Date().toISOString();

    const record = db.getFirstSync("SELECT * FROM device_registry WHERE device_id = ?", [deviceId]);
    if (!record) {
      throw new Error(`Device record not found for device_id: ${deviceId}`);
    }

    const payload = enableLock ? {
      admin_lock: true,
      status: 'BLOCKED',
      allow_login: false,
      registered_by: adminUsername
    } : {
      admin_lock: false,
      status: 'ACTIVE',
      allow_login: true,
      registered_by: adminUsername
    };

    const remoteOk = await updateSupabaseDevice(deviceId, payload);
    if (!remoteOk) {
      console.warn(`[DeviceRegistry] Failed to update admin lock on Supabase for ${deviceId}`);
      return { success: false, error: 'সার্ভারে ডিভাইস লক আপডেট ব্যর্থ হয়েছে (Network/Supabase error)' };
    }

    if (enableLock) {
      db.runSync(`
        UPDATE device_registry
        SET admin_lock = 1, status = 'BLOCKED', allow_login = 0, registered_by = ?, updated_at = ?
        WHERE device_id = ?
      `, [adminUsername, now, deviceId]);
    } else {
      db.runSync(`
        UPDATE device_registry
        SET admin_lock = 0, status = 'ACTIVE', allow_login = 1, registered_by = ?, updated_at = ?
        WHERE device_id = ?
      `, [adminUsername, now, deviceId]);
    }

    console.log(`[DeviceRegistry] setAdminDeviceLock deviceId='${deviceId}' enableLock=${enableLock} confirmed`);
    return { success: true };
  } catch (err) {
    console.error("[DeviceRegistry] Error setting admin device lock:", err);
    return { success: false, error: err.message };
  }
}

/**
 * Step 8: Trigger Remote Force Logout for a target device (Async Verified Push).
 * Generates a unique revocation token to guarantee distinguishing consecutive commands.
 */
export async function triggerForceLogout(deviceId, adminUsername = 'admin') {
  const t0 = Date.now();
  try {
    const db = getDb();
    const now = new Date().toISOString();
    const forceLogoutToken = 'fl_' + Date.now() + '_' + Math.random().toString(36).substring(2, 10);
    console.log(`[ForceLogout] stage=token_generated deviceId=${deviceId} commandId=${forceLogoutToken} elapsed=0ms`);

    const record = db.getFirstSync("SELECT * FROM device_registry WHERE device_id = ?", [deviceId]);
    if (!record) {
      throw new Error(`Device record not found for device_id: ${deviceId}`);
    }

    console.log(`[ForceLogout] stage=supabase_write_start deviceId=${deviceId} commandId=${forceLogoutToken} elapsed=${Date.now()-t0}ms`);
    const remoteOk = await updateSupabaseDevice(deviceId, {
      force_logout: true,
      force_logout_token: forceLogoutToken,
      updated_at: now
    });

    if (!remoteOk) {
      console.warn(`[ForceLogout] stage=supabase_write_failed deviceId=${deviceId} commandId=${forceLogoutToken} elapsed=${Date.now()-t0}ms`);
      return { success: false, error: 'সার্ভারে ফোর্স লগআউট প্রেরণ ব্যর্থ হয়েছে (Network/Supabase error)' };
    }

    console.log(`[ForceLogout] stage=supabase_write_confirmed deviceId=${deviceId} commandId=${forceLogoutToken} elapsed=${Date.now()-t0}ms`);

    db.runSync(`
      UPDATE device_registry
      SET force_logout = 1, force_logout_token = ?, updated_at = ?
      WHERE device_id = ?
    `, [forceLogoutToken, now, deviceId]);

    console.log(`[ForceLogout] stage=sqlite_local_written deviceId=${deviceId} commandId=${forceLogoutToken} elapsed=${Date.now()-t0}ms by=${adminUsername}`);
    return { success: true, token: forceLogoutToken };
  } catch (err) {
    console.error(`[ForceLogout] stage=trigger_error deviceId=${deviceId} elapsed=${Date.now()-t0}ms error=`, err);
    return { success: false, error: err.message };
  }
}

/**
 * Trigger Global Force Logout for all non-admin devices.
 * Assigns a unique global revocation token across fleet.
 */
export async function triggerGlobalForceLogout(adminUsername = 'admin') {
  try {
    const db = getDb();
    const now = new Date().toISOString();
    const globalToken = 'gfl_' + Date.now() + '_' + Math.random().toString(36).substring(2, 10);

    db.runSync(`
      UPDATE device_registry
      SET force_logout = 1, force_logout_token = ?, updated_at = ?
      WHERE registered_by != 'ADMIN' OR registered_by IS NULL
    `, [globalToken, now]);

    const { getSupabaseClient } = require('./supabaseClient.js');
    const supabase = getSupabaseClient();
    if (supabase) {
      let { error } = await supabase
        .from('devices')
        .update({ force_logout: true, force_logout_token: globalToken, updated_at: now })
        .neq('status', 'ADMIN');
      if (error && (error.message?.includes('force_logout_token') || error.code === 'PGRST204')) {
        const res = await supabase
          .from('devices')
          .update({ force_logout: true, updated_at: now })
          .neq('status', 'ADMIN');
        error = res.error;
      }
      if (error) {
        console.warn('[DeviceRegistry] Global force logout partial failure on Supabase:', error.message);
        return { success: false, error: error.message };
      }
    }

    return { success: true, token: globalToken };
  } catch (err) {
    console.error('[DeviceRegistry] Global force logout error:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Phase 5 Patch: Check whether force_logout is flagged on current device.
 * Acknowledges safely using unique revocation token to prevent erasing newer commands.
 */
export async function checkAndExecuteForceLogout(remoteRecord = null) {
  const t0 = Date.now();
  try {
    const db = getDb();
    const deviceRecord = getCurrentDeviceRecord();
    if (!deviceRecord) return { triggered: false };

    const { getAppConfig, setAppConfig } = require('../database');
    const lastHandledAt = getAppConfig('last_handled_force_logout_at') || '';
    const lastHandledToken = getAppConfig('last_handled_force_logout_token') || '';

    let shouldTrigger = false;
    let commandTimestamp = '';
    let commandToken = '';

    if (remoteRecord && remoteRecord.force_logout) {
      // Safety: ensure this command targets the current device
      if (remoteRecord.device_id && deviceRecord.device_id && remoteRecord.device_id !== deviceRecord.device_id) {
        console.log(`[ForceLogout] stage=wrong_device_skip remoteDeviceId=${remoteRecord.device_id} currentDeviceId=${deviceRecord.device_id} elapsed=${Date.now()-t0}ms`);
        return { triggered: false };
      }

      // Use force_logout_token as primary stable command ID; if missing, derive deterministic ID from server updated_at
      commandTimestamp = remoteRecord.updated_at || new Date().toISOString();
      commandToken = remoteRecord.force_logout_token || ('ts_' + commandTimestamp);

      if (commandToken !== lastHandledToken) {
        shouldTrigger = true;
      } else {
        console.log(`[ForceLogout] stage=check_dedup_skip deviceId=${deviceRecord.device_id} commandId=${commandToken} reason=token_already_handled elapsed=${Date.now()-t0}ms`);
      }
    } else if (Number(deviceRecord.force_logout || 0) === 1) {
      // Reading from local SQLite row (periodic check path or offline path).
      commandTimestamp = deviceRecord.updated_at || new Date().toISOString();
      commandToken = deviceRecord.force_logout_token || ('ts_' + commandTimestamp);

      if (commandToken !== lastHandledToken) {
        shouldTrigger = true;
      } else {
        console.log(`[ForceLogout] stage=sqlite_dedup_skip deviceId=${deviceRecord.device_id} commandId=${commandToken} reason=token_already_handled elapsed=${Date.now()-t0}ms`);
      }
    }

    if (!shouldTrigger) {
      return { triggered: false };
    }

    console.log(`[ForceLogout] stage=session_purge_start deviceId=${deviceRecord.device_id} commandId=${commandToken} elapsed=${Date.now()-t0}ms`);

    setAppConfig('last_handled_force_logout_at', commandTimestamp || new Date().toISOString());
    setAppConfig('last_handled_force_logout_token', commandToken);

    setAppConfig('remembered_username', '');
    setAppConfig('login_session_user', '');
    setAppConfig('login_session_role', '');
    setAppConfig('remember_me_pin', '');
    setAppConfig('active_user_pin', '');
    
    try {
      db.runSync("DELETE FROM app_config WHERE key LIKE 'remember_%' OR key LIKE 'session_%' OR key LIKE '%user%' OR key LIKE '%pin%' OR key = 'login_session_user' OR key = 'login_session_role'");
    } catch (e) {}

    setAppConfig('force_reauth_required', '1');

    const now = new Date().toISOString();
    db.runSync(`
      UPDATE device_registry
      SET force_logout = 0, force_logout_token = NULL, updated_at = ?
      WHERE device_id = ?
    `, [now, deviceRecord.device_id]);

    console.log(`[ForceLogout] stage=sqlite_cleared deviceId=${deviceRecord.device_id} commandId=${commandToken || 'legacy'} elapsed=${Date.now()-t0}ms`);

    await clearForceLogoutIfMatching(deviceRecord.device_id, commandTimestamp, commandToken);

    console.log(`[ForceLogout] stage=supabase_acked deviceId=${deviceRecord.device_id} commandId=${commandToken || 'legacy'} elapsed=${Date.now()-t0}ms`);
    return {
      triggered: true,
      message: 'প্রশাসক আপনার সেশন বন্ধ করেছেন। অনুগ্রহ করে আবার লগইন করুন।'
    };
  } catch (err) {
    console.error(`[ForceLogout] stage=check_error elapsed=${Date.now()-t0}ms error=`, err);
    return { triggered: false };
  }
}

/**
 * Authoritative single-device self-check on cold launch and foreground resume.
 * Strictly queries ONLY this device row from Supabase.
 * Enforces server-authoritative block, force-logout, and fail-closed offline policy.
 *
 * @param {string} [userRole='']
 * @returns {Promise<{ allowed: boolean, blocked?: boolean, forceLogout?: boolean, verificationRequired?: boolean, offline?: boolean, status?: string, isAdminLock?: boolean, message?: string, deviceId?: string }>}
 */
export async function verifyDeviceAccessOnStartupOrResume(userRole = '') {
  try {
    const db = getDb();
    const localRecord = getCurrentDeviceRecord();
    const deviceId = localRecord ? localRecord.device_id : getCurrentDeviceId();

    if (!deviceId) {
      return {
        allowed: false,
        verificationRequired: true,
        message: 'ডিভাইস আইডেন্টিটি পাওয়া যায়নি।'
      };
    }

    const roleUpper = String(userRole || '').toUpperCase().trim();

    // Query authoritative remote row for THIS device
    const remoteRes = await fetchSingleSupabaseDevice(deviceId);

    if (remoteRes.success && remoteRes.record) {
      const remote = remoteRes.record;
      // Authoritative sync to local SQLite
      syncRemoteDeviceToLocal(remote);

      // Check Admin Lock / Block
      if (remote.admin_lock || remote.status === 'BLOCKED') {
        return {
          allowed: false,
          blocked: true,
          status: 'BLOCKED',
          isAdminLock: Boolean(remote.admin_lock),
          deviceId,
          message: remote.admin_lock
            ? 'এই ডিভাইসের অ্যাক্সেস অ্যাডমিন লক দ্বারা নিষ্ক্রিয় করা হয়েছে।'
            : 'এই ডিভাইসটি অ্যাডমিনিস্ট্রেটর কর্তৃক ব্লক করা হয়েছে।'
        };
      }

      // Check Force Logout
      if (remote.force_logout) {
        const forceRes = await checkAndExecuteForceLogout(remote);
        if (forceRes && forceRes.triggered) {
          return {
            allowed: false,
            forceLogout: true,
            deviceId,
            message: forceRes.message
          };
        }
      }

      // Check Pending approval
      if (remote.status === 'PENDING' && roleUpper !== 'ADMIN') {
        return {
          allowed: false,
          status: 'PENDING',
          deviceId,
          message: 'ডিভাইসটি এখনো অনুমোদিত হয়নি।'
        };
      }

      return {
        allowed: true,
        status: remote.status,
        deviceId
      };
    } else if (remoteRes.success && remoteRes.notFound) {
      // Confirmed missing on remote: upsert registration
      if (localRecord) {
        upsertDeviceToSupabase(localRecord);
      }
      return {
        allowed: roleUpper === 'ADMIN',
        status: 'PENDING',
        deviceId,
        message: 'ডিভাইসটি নিবন্ধিত হয়েছে এবং অনুমোদনের অপেক্ষায় রয়েছে।'
      };
    }

    // Remote query failed (Offline / network failure)
    console.warn(`[DeviceRegistry] Supabase unreachable on self-check: ${remoteRes.error || 'Network offline'}`);

    if (localRecord) {
      // Local record says blocked -> block immediately
      if (localRecord.admin_lock || localRecord.status === 'BLOCKED') {
        return {
          allowed: false,
          blocked: true,
          status: 'BLOCKED',
          isAdminLock: Boolean(localRecord.admin_lock),
          deviceId,
          message: 'ডিভাইসটি ব্লক করা হয়েছে।'
        };
      }

      // Check offline permission
      const allowOffline = Number(localRecord.allow_offline || 0) === 1 || roleUpper === 'ADMIN';
      if (allowOffline) {
        return {
          allowed: true,
          offline: true,
          status: localRecord.status,
          deviceId,
          message: 'অফলাইন মোড (সার্ভারের সাথে যাচাই করা সম্ভব হয়নি)'
        };
      }
    }

    // Fail closed: offline without allow_offline permission
    return {
      allowed: false,
      verificationRequired: true,
      offline: true,
      deviceId,
      message: 'আপনার ডিভাইসের স্ট্যাটাস যাচাই করতে ইন্টারনেট সংযোগ প্রয়োজন।'
    };
  } catch (err) {
    console.error("[DeviceRegistry] Error in verifyDeviceAccessOnStartupOrResume:", err);
    return {
      allowed: false,
      verificationRequired: true,
      error: err.message
    };
  }
}

/**
 * Sync remote Supabase device payload into local SQLite database.
 * Ensures local offline SQLite database immediately reflects cloud changes.
 *
 * IMPORTANT: Does NOT blindly overwrite force_logout=1 from remote if this command was already
 * processed. A previously-handled logout command must not cause a repeated logout loop even if
 * Supabase still holds force_logout=true (e.g. because clearForceLogoutIfMatching failed).
 */
export function syncRemoteDeviceToLocal(remoteRecord) {
  if (!remoteRecord || !remoteRecord.device_id) return false;
  try {
    const db = getDb();
    const existing = db.getFirstSync("SELECT id FROM device_registry WHERE device_id = ?", [remoteRecord.device_id]);
    const now = new Date().toISOString();

    const allowLogin = remoteRecord.allow_login ? 1 : 0;
    const allowOffline = remoteRecord.allow_offline ? 1 : 0;
    const adminLock = remoteRecord.admin_lock ? 1 : 0;
    const isDeleted = remoteRecord.is_deleted ? 1 : 0;

    // --- Force Logout deduplication guard ---
    // If the remote record has force_logout=true, check whether this exact command was already
    // handled by this device. If it was, write force_logout=0 to preserve the cleared state,
    // and schedule a background Supabase acknowledgment retry.
    let currentDeviceId = '';
    try {
      const storedRow = db.getFirstSync("SELECT value FROM app_config WHERE key = 'persistent_device_id'");
      if (storedRow && storedRow.value) currentDeviceId = storedRow.value;
    } catch (_) {}
    const isCurrentDevice = Boolean(currentDeviceId && remoteRecord.device_id === currentDeviceId);

    let forceLogout = remoteRecord.force_logout ? 1 : 0;
    const incomingToken = remoteRecord.force_logout_token || '';
    const incomingIssuedAt = remoteRecord.force_logout_issued_at || remoteRecord.updated_at || '';
    let effectiveToken = incomingToken || (forceLogout === 1 ? ('ts_' + (incomingIssuedAt || now)) : null);

    // Only apply client-side deduplication guard if this record belongs to the CURRENT device.
    // When Admin syncs remote fleet devices, other devices must keep their remote force_logout status.
    if (forceLogout === 1 && isCurrentDevice) {
      try {
        const { getAppConfig } = require('../database');
        const lastHandledToken = getAppConfig('last_handled_force_logout_token') || '';

        let alreadyHandled = false;
        if (effectiveToken && lastHandledToken && effectiveToken === lastHandledToken) {
          alreadyHandled = true;
        }

        if (alreadyHandled) {
          // Command was already processed — do NOT restore the force_logout flag.
          // Schedule a background Supabase acknowledgment retry so the server flag gets cleared.
          forceLogout = 0;
          effectiveToken = null;
          console.log(`[ForceLogout] syncRemoteDeviceToLocal: command already handled, preserving force_logout=0 for device=${remoteRecord.device_id}`);
          // Fire-and-forget background retry of Supabase acknowledgment
          const commandTimestamp = incomingIssuedAt || now;
          const commandToken = incomingToken || effectiveToken;
          setTimeout(() => {
            try {
              const { clearForceLogoutIfMatching } = require('./supabaseDeviceControl');
              clearForceLogoutIfMatching(remoteRecord.device_id, commandTimestamp, commandToken).catch(() => {});
            } catch (_) {}
          }, 500);
        }
      } catch (_) {
        // If we can't check, be conservative and allow force_logout from remote
      }
    }
    // --- End force logout deduplication guard ---

    if (existing) {
      db.runSync(`
        UPDATE device_registry
        SET device_name = COALESCE(?, device_name),
            status = COALESCE(?, status),
            allow_login = ?,
            allow_offline = ?,
            admin_lock = ?,
            force_logout = ?,
            force_logout_token = ?,
            is_deleted = ?,
            deleted_at = ?,
            deleted_by = ?,
            last_seen = COALESCE(?, last_seen),
            updated_at = ?
        WHERE device_id = ?
      `, [
        remoteRecord.device_name || null,
        remoteRecord.status || null,
        allowLogin,
        allowOffline,
        adminLock,
        forceLogout,
        effectiveToken,
        isDeleted,
        remoteRecord.deleted_at || null,
        remoteRecord.deleted_by || null,
        remoteRecord.last_seen_at || null,
        remoteRecord.updated_at || now,
        remoteRecord.device_id
      ]);
    } else {
      db.runSync(`
        INSERT INTO device_registry (
          device_id, device_name, manufacturer, brand, model,
          android_version, app_version, first_install_time, last_seen,
          allow_login, allow_offline, status, registered_by, notes,
          admin_lock, force_logout, force_logout_token, is_deleted, deleted_at, deleted_by,
          created_at, updated_at, is_synced
        ) VALUES (
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, 1
        )
      `, [
        remoteRecord.device_id,
        remoteRecord.device_name || '',
        remoteRecord.manufacturer || '',
        remoteRecord.brand || '',
        remoteRecord.model || '',
        remoteRecord.android_version || '',
        remoteRecord.app_version || '',
        remoteRecord.first_install_time || '',
        remoteRecord.last_seen_at || now,
        allowLogin,
        allowOffline,
        remoteRecord.status || 'PENDING',
        remoteRecord.registered_by || 'SYSTEM_AUTO',
        remoteRecord.notes || '',
        adminLock,
        forceLogout,
        effectiveToken,
        isDeleted,
        remoteRecord.deleted_at || null,
        remoteRecord.deleted_by || null,
        remoteRecord.created_at || now,
        remoteRecord.updated_at || now
      ]);
    }
    return true;
  } catch (err) {
    console.error("[DeviceRegistry] Error syncing remote device to local:", err);
    return false;
  }
}

/**
 * Device Control Refresh — Safe Transactional Cache Replacement
 *
 * Implements the Admin Refresh button sequence:
 *   1. Mutex guard — rejects concurrent refresh clicks
 *   2. Fetch latest fleet from Supabase
 *   3. Validate the response (non-empty array, every device has a device_id)
 *   4. ONLY after successful validation:
 *      BEGIN transaction → DELETE old device_registry rows → INSERT new rows → COMMIT
 *   5. On any error before COMMIT: automatic rollback, previous cache preserved
 *
 * NEVER deletes local SQLite data before a successful Supabase fetch.
 * NEVER clears tables unrelated to Device Control.
 * Matches records using exact stable device_id.
 *
 * @returns {{ success: boolean, count: number, error?: string }}
 */
export async function refreshDeviceRegistryFromSupabase() {
  // ── 1. Mutex guard ──────────────────────────────────────────────────────────
  if (isDeviceRegistryRefreshInProgress) {
    console.warn('[DeviceRegistry] refreshDeviceRegistryFromSupabase: refresh already in progress, ignoring duplicate request');
    return { success: false, count: 0, error: 'already_in_progress' };
  }
  isDeviceRegistryRefreshInProgress = true;

  try {
    // ── 2. Fetch latest device fleet from Supabase ───────────────────────────
    console.log('[DeviceRegistry] refreshDeviceRegistryFromSupabase: fetching fleet from Supabase...');
    const remoteDevices = await fetchSupabaseDevices();

    // ── 3. Validate response ─────────────────────────────────────────────────
    // Must be a non-empty array where every entry has a stable device_id.
    // An empty array or fetch error returns [] — treat as failure to preserve cache.
    if (!Array.isArray(remoteDevices)) {
      const errMsg = 'Supabase response is not an array — cache preserved';
      console.error(`[DeviceRegistry] refreshDeviceRegistryFromSupabase: ${errMsg}`);
      return { success: false, count: 0, error: errMsg };
    }
    if (remoteDevices.length === 0) {
      const errMsg = 'Supabase returned 0 devices — cache preserved to prevent data loss';
      console.warn(`[DeviceRegistry] refreshDeviceRegistryFromSupabase: ${errMsg}`);
      return { success: false, count: 0, error: errMsg };
    }
    const invalidEntry = remoteDevices.find(
      (d) => !d || typeof d.device_id !== 'string' || d.device_id.trim() === ''
    );
    if (invalidEntry) {
      const errMsg = 'Supabase response contains entry without valid device_id — cache preserved';
      console.error(`[DeviceRegistry] refreshDeviceRegistryFromSupabase: ${errMsg}`, invalidEntry);
      return { success: false, count: 0, error: errMsg };
    }

    // ── 4. SQLite transactional replace ─────────────────────────────────────
    // BEGIN → DELETE all device_registry rows → INSERT each remote record → COMMIT
    // If anything fails, the exception propagates out and we ROLLBACK below.
    const db = getDb();
    const now = new Date().toISOString();

    db.runSync('BEGIN');
    try {
      // DELETE all existing device_registry records (table is exclusively Device Control data)
      db.runSync('DELETE FROM device_registry');
      console.log('[DeviceRegistry] refreshDeviceRegistryFromSupabase: cleared old device_registry rows in transaction');

      // INSERT each validated remote record
      for (const rem of remoteDevices) {
        const allowLogin = rem.allow_login ? 1 : 0;
        const allowOffline = rem.allow_offline ? 1 : 0;
        const adminLock = rem.admin_lock ? 1 : 0;
        const isDeleted = rem.is_deleted ? 1 : 0;
        const forceLogout = rem.force_logout ? 1 : 0;
        const forceLogoutToken = rem.force_logout_token || null;

        db.runSync(`
          INSERT OR REPLACE INTO device_registry (
            id, device_id, device_name, manufacturer, brand, model,
            android_version, app_version, first_install_time, last_seen,
            allow_login, allow_offline, status, registered_by, notes,
            admin_lock, force_logout, force_logout_token, is_deleted,
            deleted_at, deleted_by, created_at, updated_at, is_synced
          ) VALUES (
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?, ?, 1
          )
        `, [
          rem.device_id,         // use device_id as primary key (id = device_id)
          rem.device_id,
          rem.device_name || '',
          rem.manufacturer || '',
          rem.brand || '',
          rem.model || '',
          rem.android_version || '',
          rem.app_version || '',
          rem.first_install_time || '',
          rem.last_seen_at || rem.last_seen || now,
          allowLogin,
          allowOffline,
          rem.status || 'PENDING',
          rem.registered_by || 'SYSTEM_AUTO',
          rem.notes || '',
          adminLock,
          forceLogout,
          forceLogoutToken,
          isDeleted,
          rem.deleted_at || null,
          rem.deleted_by || null,
          rem.created_at || now,
          rem.updated_at || now,
        ]);
      }

      db.runSync('COMMIT');
      console.log(`[DeviceRegistry] refreshDeviceRegistryFromSupabase: committed ${remoteDevices.length} records successfully`);
      return { success: true, count: remoteDevices.length };

    } catch (txErr) {
      // Roll back to preserve previous data on any transaction error
      try { db.runSync('ROLLBACK'); } catch (_) {}
      const errMsg = `SQLite transaction failed — rolled back, cache preserved: ${txErr.message}`;
      console.error(`[DeviceRegistry] refreshDeviceRegistryFromSupabase: ${errMsg}`);
      return { success: false, count: 0, error: errMsg };
    }

  } catch (outerErr) {
    // Supabase fetch itself threw — previous cache is still intact
    const errMsg = `Supabase fetch failed — cache preserved: ${outerErr.message}`;
    console.error(`[DeviceRegistry] refreshDeviceRegistryFromSupabase: ${errMsg}`);
    return { success: false, count: 0, error: errMsg };
  } finally {
    isDeviceRegistryRefreshInProgress = false;
  }
}

