import * as Device from 'expo-device';
import * as Application from 'expo-application';
import { Platform } from 'react-native';
import { getDb, enqueueSync, setAppConfig, syncRecordImmediately } from '../database';

/**
 * Device Access Control Layer — Phase 1, 2, 3, 4, 5 & Phase 6 + Dedicated Sync Optimization
 */

let lastFlushedLastSeen = null;

/**
 * Step 7: Flush last_seen update to sync_queue if changed (5-minute batch).
 */
export function checkAndFlushLastSeen() {
  try {
    const record = getCurrentDeviceRecord();
    if (!record) return false;

    const currentLastSeen = record.last_seen || record.updated_at;
    if (currentLastSeen && currentLastSeen !== lastFlushedLastSeen) {
      lastFlushedLastSeen = currentLastSeen;
      enqueueSync("device_registry", record.id, "UPDATE");
      console.log(`[DeviceRegistry] Batched last_seen flushed for device '${record.device_id}': ${currentLastSeen}`);
      return true;
    }
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
  try {
    let androidId = null;
    if (typeof Application.getAndroidIdAsync === 'function') {
      androidId = await Application.getAndroidIdAsync();
    } else if (Application.androidId) {
      androidId = Application.androidId;
    }
    if (androidId && typeof androidId === 'string' && androidId.trim().length > 0) {
      return `android_${androidId.trim()}`;
    }
  } catch (e) {}

  try {
    const storedRow = db.getFirstSync("SELECT value FROM app_config WHERE key = 'persistent_device_id'");
    if (storedRow && storedRow.value) {
      return storedRow.value;
    }

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

/**
 * Ensures `device_registry` table exists and registers / updates current device telemetry.
 */
export async function registerDeviceIfNeeded() {
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
      force_logout INTEGER DEFAULT 0
    );
  `);

  // Migration: Ensure missing columns (is_synced, admin_lock, force_logout) exist
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
  } catch (e) {}

  const deviceId = await getPersistentDeviceId(db);
  const deviceName = Device.deviceName || Device.modelName || 'Android Device';
  const manufacturer = Device.manufacturer || 'Android';
  const brand = Device.brand || manufacturer || 'Android';
  const model = Device.modelName || Device.designName || Platform.OS;
  const androidVersion = Device.osVersion || String(Platform.Version || '');
  const appVersion = Application.nativeApplicationVersion || '1.0.0';

  const now = new Date().toISOString();

  const existingRecord = db.getFirstSync(
    "SELECT * FROM device_registry WHERE device_id = ?",
    [deviceId]
  );

  if (!existingRecord) {
    const recordId = `dreg_${deviceId.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 24)}_${Date.now()}`;

    db.runSync(`
      INSERT INTO device_registry (
        id, device_id, device_name, manufacturer, brand, model,
        android_version, app_version, first_install_time, last_seen,
        allow_login, allow_offline, status, registered_by, notes,
        created_at, updated_at, admin_lock, force_logout
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'PENDING', 'system', 'Auto registered on app startup', ?, ?, 0, 0)
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

    enqueueSync("device_registry", recordId, "INSERT");
    syncRecordImmediately("device_registry", recordId);
    lastFlushedLastSeen = now;
    console.log(`[DeviceRegistry] Successfully registered new device: ${deviceId} (status: PENDING)`);
  } else {
    db.runSync(`
      UPDATE device_registry
      SET last_seen = ?, app_version = ?, android_version = ?, updated_at = ?
      WHERE device_id = ?
    `, [now, appVersion, androidVersion, now, deviceId]);

    console.log(`[DeviceRegistry] Updated device last_seen locally for: ${deviceId}`);
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
      return db.getFirstSync("SELECT * FROM device_registry ORDER BY created_at DESC LIMIT 1");
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
  const status = deviceRecord ? String(deviceRecord.status || 'PENDING').toUpperCase().trim() : 'PENDING';
  const adminLock = deviceRecord ? Number(deviceRecord.admin_lock || 0) : 0;

  // 1. ADMIN LOCK CHECK (Stolen Device Protection)
  if (adminLock === 1) {
    return {
      allowed: false,
      status: 'BLOCKED',
      isAdminLock: true,
      deviceId,
      message: 'Administrator access has been disabled for this device. This device has been marked as lost/stolen. Please contact another Administrator.'
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
        message: 'এই ডিভাইসটি Administrator ব্লক করেছেন। এই ডিভাইস থেকে Login করা যাবে না।'
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
      message: 'এই ডিভাইসটি এখনো Administrator কর্তৃক অনুমোদিত হয়নি।'
    };
  }

  if (status === 'BLOCKED') {
    return {
      allowed: false,
      status: 'BLOCKED',
      isAdminLock: false,
      deviceId,
      message: 'এই ডিভাইসটি Administrator ব্লক করেছেন। এই ডিভাইস থেকে Login করা যাবে না।'
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
 * Get all registered devices from device_registry table.
 * @returns {Array} Array of device records
 */
export function getAllRegisteredDevices() {
  try {
    const db = getDb();
    return db.getAllSync("SELECT * FROM device_registry ORDER BY created_at DESC");
  } catch (err) {
    console.error("[DeviceRegistry] Error fetching all registered devices:", err);
    return [];
  }
}

/**
 * Step 8: Update a device's approval status (Admin action - Immediate Push).
 */
export function updateDeviceStatus(deviceId, newStatus, adminUsername = 'admin') {
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

    const sql = `
      UPDATE device_registry
      SET status = ?, allow_login = ?, registered_by = ?, updated_at = ?
      WHERE device_id = ?
    `;
    const params = [cleanStatus, allowLogin, adminUsername, now, deviceId];

    db.runSync(sql, params);

    // Immediate Enqueue & Immediate Sync Push for Security Policy Action
    enqueueSync("device_registry", record.id, "UPDATE");
    syncRecordImmediately("device_registry", record.id);
    console.log(`[DeviceRegistry] Admin '${adminUsername}' updated device '${deviceId}' status to '${cleanStatus}' (Immediate Push)`);
    return true;
  } catch (err) {
    console.error("[DeviceRegistry] Error updating device status:", err);
    return false;
  }
}

/**
 * Step 8: Update device offline permission (Admin action - Immediate Push).
 */
export function updateDeviceOfflinePermission(deviceId, allowOffline, adminUsername = 'admin') {
  try {
    const db = getDb();
    const allowVal = allowOffline ? 1 : 0;
    const now = new Date().toISOString();

    const record = db.getFirstSync("SELECT * FROM device_registry WHERE device_id = ?", [deviceId]);
    if (!record) {
      throw new Error(`Device record not found for device_id: ${deviceId}`);
    }

    db.runSync(`
      UPDATE device_registry
      SET allow_offline = ?, registered_by = ?, updated_at = ?
      WHERE device_id = ?
    `, [allowVal, adminUsername, now, deviceId]);

    // Immediate Enqueue & Immediate Sync Push for Security Policy Action
    enqueueSync("device_registry", record.id, "UPDATE");
    syncRecordImmediately("device_registry", record.id);
    console.log(`[DeviceRegistry] Admin '${adminUsername}' set allow_offline=${allowVal} for device '${deviceId}' (Immediate Push)`);
    return true;
  } catch (err) {
    console.error("[DeviceRegistry] Error updating offline permission:", err);
    return false;
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
 * Step 8: Set or remove Admin Lock for a device (Immediate Push).
 */
export function setAdminDeviceLock(deviceId, enableLock, adminUsername = 'admin') {
  try {
    const db = getDb();
    const now = new Date().toISOString();

    const record = db.getFirstSync("SELECT * FROM device_registry WHERE device_id = ?", [deviceId]);
    if (!record) {
      throw new Error(`Device record not found for device_id: ${deviceId}`);
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

    // Immediate Enqueue & Immediate Sync Push for Security Policy Action
    enqueueSync("device_registry", record.id, "UPDATE");
    syncRecordImmediately("device_registry", record.id);
    console.log(`[DeviceRegistry] setAdminDeviceLock deviceId='${deviceId}' enableLock=${enableLock} by '${adminUsername}' (Immediate Push)`);
    return true;
  } catch (err) {
    console.error("[DeviceRegistry] Error setting admin device lock:", err);
    return false;
  }
}

/**
 * Step 8: Trigger Remote Force Logout for a target device (Immediate Push).
 */
export function triggerForceLogout(deviceId, adminUsername = 'admin') {
  try {
    const db = getDb();
    const now = new Date().toISOString();

    const record = db.getFirstSync("SELECT * FROM device_registry WHERE device_id = ?", [deviceId]);
    if (!record) {
      throw new Error(`Device record not found for device_id: ${deviceId}`);
    }

    db.runSync(`
      UPDATE device_registry
      SET force_logout = 1, updated_at = ?
      WHERE device_id = ?
    `, [now, deviceId]);

    // Immediate Enqueue & Immediate Sync Push for Security Policy Action
    enqueueSync("device_registry", record.id, "UPDATE");
    syncRecordImmediately("device_registry", record.id);
    console.log(`[DeviceRegistry] Remote force_logout triggered for deviceId='${deviceId}' by '${adminUsername}' (Immediate Push)`);
    return true;
  } catch (err) {
    console.error("[DeviceRegistry] Error triggering force logout:", err);
    return false;
  }
}

/**
 * Phase 5 Patch: Check whether force_logout is flagged on current device.
 */
export function checkAndExecuteForceLogout() {
  try {
    const db = getDb();
    const deviceRecord = getCurrentDeviceRecord();
    if (!deviceRecord) return { triggered: false };

    const forceLogoutFlag = Number(deviceRecord.force_logout || 0);
    if (forceLogoutFlag !== 1) {
      return { triggered: false };
    }

    console.log("[DeviceRegistry] FORCE LOGOUT FLAGGED FOR DEVICE! Destroying all sessions...");

    setAppConfig('remembered_username', '');
    setAppConfig('login_session_user', '');
    setAppConfig('login_session_role', '');
    setAppConfig('remember_me_pin', '');
    setAppConfig('active_user_pin', '');
    
    try {
      db.runSync("DELETE FROM app_config WHERE key LIKE 'remember_%' OR key LIKE 'session_%' OR key LIKE '%user%' OR key LIKE '%pin%' OR key = 'login_session_user' OR key = 'login_session_role'");
    } catch (e) {}

    const now = new Date().toISOString();
    db.runSync(`
      UPDATE device_registry
      SET force_logout = 0, updated_at = ?
      WHERE device_id = ?
    `, [now, deviceRecord.device_id]);

    enqueueSync("device_registry", deviceRecord.id, "UPDATE");
    syncRecordImmediately("device_registry", deviceRecord.id);

    console.log(`[DeviceRegistry] Successfully executed Force Logout session purge for device '${deviceRecord.device_id}'`);
    return {
      triggered: true,
      message: 'Administrator has signed you out.\nPlease login again using your Username and PIN.'
    };
  } catch (err) {
    console.error("[DeviceRegistry] Error in checkAndExecuteForceLogout:", err);
    return { triggered: false };
  }
}
