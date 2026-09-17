import { getDb, enqueueSync, syncRecordImmediately, ACTIVE_APP_PROFILE } from '../database';
import { getCurrentDeviceRecord } from './deviceRegistry';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

/**
 * Standard Action Categories for Activity & Audit Logging
 */
export const ACTION_TYPES = {
  DELETE: 'DELETE',         // Deleted log (order delete, menu delete, past account delete)
  SUBMISSION: 'SUBMISSION', // Daily submission log (daily sheet submit, lock reset)
  EXPENSE: 'EXPENSE',       // Daily koroch edit log
  IJARA: 'IJARA',           // Eja edit log (ijara entry, reset, rollback)
  // Backward compatibility keys
  ORDER: 'ORDER',
  PAYMENT: 'PAYMENT',
  MENU: 'MENU',
  SETTLEMENT: 'SETTLEMENT',
  DEVICE: 'DEVICE',
  SECURITY: 'SECURITY',
  SYSTEM: 'SYSTEM',
};

/**
 * Log an activity across any app (Waiter, Manager, Owner, Admin)
 * Captures full hardware device telemetry, user role, app profile, and timestamp.
 * 
 * @param {object} params
 * @param {string} params.actionType - Category (e.g. ACTION_TYPES.ORDER)
 * @param {string} params.actionTitle - Short title (e.g. 'নতুন অর্ডার তৈরি')
 * @param {string} params.description - Detailed description (e.g. 'Table 4: 2 items (৳ 350)')
 * @param {object|null} params.metadata - Structured details (orderId, table, amount, etc.)
 * @param {string|null} params.businessDate - YYYY-MM-DD (defaults to today)
 * @param {string|null} params.userRole - User role ('owner', 'admin', 'manager', 'waiter')
 * @param {string|null} params.userName - Logged-in user's display name
 * @returns {Promise<string|null>} - Returns the generated log ID or null if failed
 */
export async function logActivity({
  actionType = ACTION_TYPES.SYSTEM,
  actionTitle = 'Activity',
  description = '',
  metadata = null,
  businessDate = null,
  userRole = null,
  userName = null,
}) {
  try {
    const db = getDb();
    if (!db) return null;

    // 1. Resolve Timestamps & Business Date
    const now = new Date();
    const resolvedDate = businessDate || now.toISOString().split('T')[0];
    const timestamp = now.toISOString();

    // 2. Resolve Hardware Device Telemetry
    let deviceRecord = null;
    try {
      deviceRecord = getCurrentDeviceRecord();
    } catch (e) {}

    const deviceId = deviceRecord?.device_id || Device.modelName || 'dev_unknown';
    const deviceName = deviceRecord?.device_name || Device.deviceName || Device.modelName || 'POS Terminal';
    const deviceModel = deviceRecord?.model || Device.modelName || Device.brand || Platform.OS;
    const devicePlatform = `${Platform.OS} ${Device.osVersion || Platform.Version || ''}`.trim();

    // 3. Resolve App Profile & User Role
    const appProfile = String(ACTIVE_APP_PROFILE || 'UNKNOWN').toUpperCase().trim();
    const resolvedRole = userRole || deviceRecord?.role || appProfile.toLowerCase();
    const resolvedUserName = userName || resolvedRole;

    // 4. Generate Unique Log ID
    const logId = `act_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    const metadataStr = metadata 
      ? (typeof metadata === 'object' ? JSON.stringify(metadata) : String(metadata)) 
      : null;

    // 5. Insert Record into Local SQLite activity_logs
    db.runSync(`
      INSERT INTO activity_logs (
        id, business_date, timestamp, action_type, action_title,
        description, app_profile, user_role, user_name,
        device_id, device_name, device_model, device_platform,
        metadata, created_at, updated_at, is_synced
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `, [
      logId,
      resolvedDate,
      timestamp,
      String(actionType),
      String(actionTitle),
      String(description),
      appProfile,
      String(resolvedRole),
      String(resolvedUserName),
      String(deviceId),
      String(deviceName),
      String(deviceModel),
      String(devicePlatform),
      metadataStr,
      timestamp,
      timestamp
    ]);

    // 6. Enqueue for Sync and Trigger Background Upload
    try {
      enqueueSync('activity_logs', logId, 'INSERT');
      // Fire and forget immediate sync upload
      syncRecordImmediately('activity_logs', logId).catch(() => {});
    } catch (syncErr) {
      // Sync enqueue failure is non-fatal; periodic sync will catch it
    }

    return logId;
  } catch (err) {
    console.warn('[ActivityLogger] Error logging activity:', err.message);
    return null;
  }
}

