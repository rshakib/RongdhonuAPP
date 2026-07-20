import * as Device from 'expo-device';
import * as Application from 'expo-application';
import { Platform } from 'react-native';
import { getDb, enqueueSync } from '../database';

/**
 * Device Access Control Layer — Phase 1: Device Registration
 * 
 * Automatically registers the device on first app launch or updates
 * device runtime telemetry (last_seen, app_version) on subsequent launches.
 * Does NOT restrict app login or block devices in Phase 1.
 */

/**
 * Generates or retrieves a stable, persistent device ID.
 * Uses Android ID if available, otherwise generates a unique UUID stored in app_config.
 * @param {object} db 
 * @returns {Promise<string>} Unique persistent device ID
 */
async function getPersistentDeviceId(db) {
  // Try native Android ID first
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

  // Fallback: Check app_config for stored persistent device ID
  try {
    const storedRow = db.getFirstSync("SELECT value FROM app_config WHERE key = 'persistent_device_id'");
    if (storedRow && storedRow.value) {
      return storedRow.value;
    }

    // Generate new fallback UUID and save to app_config
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
 * Ensures the `device_registry` table exists and performs device registration / update.
 */
export async function registerDeviceIfNeeded() {
  const db = getDb();

  // 1. Create `device_registry` table if not exists
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
      updated_at TEXT
    );
  `);

  // 2. Gather device hardware & OS telemetry
  const deviceId = await getPersistentDeviceId(db);
  const deviceName = Device.deviceName || Device.modelName || 'Android Device';
  const manufacturer = Device.manufacturer || 'Android';
  const brand = Device.brand || manufacturer || 'Android';
  const model = Device.modelName || Device.designName || Platform.OS;
  const androidVersion = Device.osVersion || String(Platform.Version || '');
  const appVersion = Application.nativeApplicationVersion || '1.0.0';

  const now = new Date().toISOString();

  // 3. Check if this device is already registered
  const existingRecord = db.getFirstSync(
    "SELECT * FROM device_registry WHERE device_id = ?",
    [deviceId]
  );

  if (!existingRecord) {
    // FRESH INSTALL: Register new device with status = PENDING
    const recordId = `dreg_${deviceId.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 24)}_${Date.now()}`;

    db.runSync(`
      INSERT INTO device_registry (
        id, device_id, device_name, manufacturer, brand, model,
        android_version, app_version, first_install_time, last_seen,
        allow_login, allow_offline, status, registered_by, notes,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'PENDING', 'system', 'Auto registered on app startup', ?, ?)
    `, [
      recordId,
      deviceId,
      deviceName,
      manufacturer,
      brand,
      model,
      androidVersion,
      appVersion,
      now, // first_install_time
      now, // last_seen
      now, // created_at
      now  // updated_at
    ]);

    // Enqueue cloud synchronization for device registration
    enqueueSync("device_registry", recordId, "INSERT");
    console.log(`[DeviceRegistry] Successfully registered new device: ${deviceId} (status: PENDING)`);
  } else {
    // EXISTING DEVICE: Update last_seen, app_version, android_version
    db.runSync(`
      UPDATE device_registry
      SET last_seen = ?, app_version = ?, android_version = ?, updated_at = ?
      WHERE device_id = ?
    `, [now, appVersion, androidVersion, now, deviceId]);

    // Enqueue cloud synchronization for telemetry update
    enqueueSync("device_registry", existingRecord.id, "UPDATE");
    console.log(`[DeviceRegistry] Updated device last_seen timestamp for: ${deviceId}`);
  }
}

/**
 * Get device registry record for the current device.
 * @returns {Promise<object|null>}
 */
export async function getCurrentDeviceRecord() {
  try {
    const db = getDb();
    const deviceId = await getPersistentDeviceId(db);
    return db.getFirstSync("SELECT * FROM device_registry WHERE device_id = ?", [deviceId]);
  } catch (err) {
    console.error("[DeviceRegistry] Error fetching current device record:", err);
    return null;
  }
}
