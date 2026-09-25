/**
 * services/backupRestore.js
 * SQLite Backup & Restore Engine for Rongdhonu POS
 *
 * Implements:
 * 1. createBackup(): Exports all approved persistent tables into a self-contained SQLite `.db` file with `_backup_metadata`.
 * 2. validateBackup(): Pre-flight verification of backup file integrity, schema version, profile matching, and security safety before any DB modification.
 * 3. restoreBackup(): Transaction-safe atomic restore (BEGIN TRANSACTION ... COMMIT / ROLLBACK) that restores business data while strictly preserving authentication secrets, user credentials, device registry, and sync queues.
 */

import * as SQLite from 'expo-sqlite';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import * as Application from 'expo-application';
import { getDb, ACTIVE_APP_PROFILE, initDatabase, getAppConfig, setAppConfig } from '../database';

// ─── 1. TABLE POLICY ─────────────────────────────────────────────────────────

/**
 * All 29 persistent application tables approved for backup & restore.
 */
export const INCLUDED_TABLES = [
  'orders',
  'order_items',
  'payments',
  'expenses',
  'deliveries',
  'daily_submit',
  'daily_summary',
  'daily_submit_priority',
  'restaurant_tables',
  'menu_categories',
  'menu_items',
  'due_payments',
  'eja_history',
  'off_days',
  'weather_data',
  'supplier_due',
  'supplier_due_history',
  'supplier_payment_ledger',
  'owner_employees',
  'owner_salary_ledger',
  'owner_expenses',
  'owner_deposits',
  'owner_home_deposits',
  'activity_logs',
  'delete_history',
  'history_download_log',
  'notifications',
  'device_app_usage',
  'ai_dataset_history',
  'app_config', // Sanitized: auth tokens and session keys strictly excluded
];

/**
 * Security-sensitive and hardware-specific tables that MUST NEVER be overwritten during restore.
 */
export const EXCLUDED_TABLES = [
  'users',            // User credentials & PINs
  'device_registry',  // Hardware device approval and tokens
  'sync_queue',       // Transient outgoing offline cloud sync queue
  'deletions',        // Transient cloud tombstone deletion queue
  'ai_dataset_queue', // Transient AI training dataset transmission queue
];

/**
 * Strict exclusion list for `app_config` keys.
 * Auth tokens, session cookies, passwords, and transient sync flags are never exported or restored.
 */
export const EXCLUDED_CONFIG_KEYS = [
  '_fb_auth_id_token',
  '_fb_auth_refresh_token',
  '_fb_auth_expires_at',
  '_fb_auth_uid',
  'login_session_user',
  'remembered_username',
  'force_reauth_required',
  'restore_in_progress',
  'initial_restore_required',
  'initial_restore_done_v1',
];

/**
 * Returns true if the app_config key is sensitive or an authentication token.
 */
export function isSensitiveConfigKey(key) {
  if (!key || typeof key !== 'string') return true;
  if (key.startsWith('_fb_auth_')) return true;
  return EXCLUDED_CONFIG_KEYS.includes(key);
}

// ─── 2. HELPER UTILITIES ─────────────────────────────────────────────────────

export function toFileUri(path) {
  if (!path) return '';
  if (path.startsWith('file:///')) return path;
  if (path.startsWith('file://')) return path.replace('file://', 'file:///');
  if (path.startsWith('content://')) return path;
  return `file:///${String(path).replace(/^\/+/, '')}`;
}

/**
 * Returns a persistent, app-scoped directory that is 100% permitted for both
 * expo-sqlite and expo-file-system across Expo Go, Dev Client, and standalone APKs.
 */
export function getBackupDirectory() {
  const base = FileSystem.documentDirectory || FileSystem.cacheDirectory || '';
  if (!base) return undefined;
  return `${base.replace(/\/+$/, '')}/SQLiteBackups`;
}

/**
 * Ensures the SQLiteBackups directory exists on disk.
 */
export async function ensureBackupDirectoryExists() {
  const dir = getBackupDirectory();
  if (!dir) return;
  try {
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    }
  } catch (e) {
    console.warn('[BackupRestore] ensureBackupDirectoryExists notice:', e);
  }
}

/**
 * Cleans up temporary inspection database files.
 */
export async function cleanupInspectBackup(inspectDbName) {
  if (!inspectDbName) return;
  const backupDir = getBackupDirectory();
  try { SQLite.deleteDatabaseSync(inspectDbName, backupDir); } catch (_) {}
  if (backupDir) {
    try { await FileSystem.deleteAsync(`${backupDir}/${inspectDbName}`, { idempotent: true }); } catch (_) {}
  }
}


function formatDisplayDate(date) {
  try {
    const d = new Date(date);
    if (isNaN(d.getTime())) return String(date || '');
    return d.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch (_) {
    return String(date || '');
  }
}

function getTimestampString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hour = String(d.getHours()).padStart(2, '0');
  const minute = String(d.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}_${hour}-${minute}`;
}

// ─── 3. CREATE BACKUP ────────────────────────────────────────────────────────

/**
 * Generates a self-contained SQLite `.db` file containing all approved persistent data
 * and triggers Android's native share/save sheet so the user can save outside app-private storage.
 *
 * @returns {Promise<{ success: boolean, fileName?: string, uri?: string, metadata?: object, error?: string }>}
 */
export async function createBackup() {
  let tempDb = null;
  const timeSlug = getTimestampString();
  const finalFileName = `rongdhonu_backup_${timeSlug}.db`;
  const backupDir = getBackupDirectory();

  try {
    const localDb = getDb();
    if (!localDb) {
      throw new Error('Database connection is not available.');
    }

    await ensureBackupDirectoryExists();

    // 1. Create clean standalone backup directly in app-scoped SQLiteBackups directory
    tempDb = SQLite.openDatabaseSync(finalFileName, { useNewConnection: true }, backupDir);
    // Use DELETE journal mode so the backup is a 100% self-contained single .db file (no -wal or -shm needed)
    tempDb.execSync('PRAGMA journal_mode = DELETE;');

    // 2. Create the backup metadata header table
    tempDb.execSync(`
      CREATE TABLE IF NOT EXISTS _backup_metadata (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);

    // 3. Inspect existing tables in the live rongdhonu.db
    const masterTables = localDb.getAllSync(
      "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';"
    );
    const existingTableMap = {};
    for (const t of masterTables) {
      existingTableMap[t.name] = t.sql;
    }

    const tableStats = {};
    let totalRecords = 0;

    // 4. Export each approved persistent table
    for (const tableName of INCLUDED_TABLES) {
      if (!existingTableMap[tableName]) {
        // Table doesn't exist in live database, skip
        continue;
      }

      // Re-create the exact table schema in backupDb
      tempDb.execSync(existingTableMap[tableName]);

      if (tableName === 'app_config') {
        // Sanitized export for app_config: strip all auth tokens and session keys
        const allConfig = localDb.getAllSync('SELECT * FROM app_config;');
        const safeConfig = allConfig.filter(row => !isSensitiveConfigKey(row.key));

        if (safeConfig.length > 0) {
          const cols = Object.keys(safeConfig[0]);
          const placeholders = cols.map(() => '?').join(', ');
          const insertSql = `INSERT INTO app_config (${cols.join(', ')}) VALUES (${placeholders});`;

          tempDb.withTransactionSync(() => {
            for (const row of safeConfig) {
              tempDb.runSync(insertSql, cols.map(c => row[c]));
            }
          });
        }
        tableStats['app_config'] = safeConfig.length;
        totalRecords += safeConfig.length;
      } else {
        // General business table export
        const rows = localDb.getAllSync(`SELECT * FROM ${tableName};`);
        if (rows && rows.length > 0) {
          const cols = Object.keys(rows[0]);
          const placeholders = cols.map(() => '?').join(', ');
          const insertSql = `INSERT INTO ${tableName} (${cols.join(', ')}) VALUES (${placeholders});`;

          tempDb.withTransactionSync(() => {
            for (const row of rows) {
              tempDb.runSync(insertSql, cols.map(c => row[c]));
            }
          });
        }
        tableStats[tableName] = rows ? rows.length : 0;
        totalRecords += (rows ? rows.length : 0);
      }
    }

    // 5. Populate _backup_metadata table with full audit details
    const nowIso = new Date().toISOString();
    const appVersion = Application.nativeApplicationVersion || '1.0.5';
    const currentProfile = String(ACTIVE_APP_PROFILE || 'ADMIN').toUpperCase().trim();
    const packageName = Application.applicationId || 'com.riajulshakib.rongdhonu';

    const metadataEntries = [
      ['backup_timestamp', nowIso],
      ['app_version', appVersion],
      ['schema_version', '1'],
      ['total_tables', String(Object.keys(tableStats).length)],
      ['total_records', String(totalRecords)],
      ['table_stats', JSON.stringify(tableStats)],
      ['backup_source', 'Rongdhonu POS'],
      ['app_profile', currentProfile],
      ['package_name', packageName],
    ];

    for (const [k, v] of metadataEntries) {
      tempDb.runSync(
        'INSERT OR REPLACE INTO _backup_metadata (key, value) VALUES (?, ?);',
        [k, v]
      );
    }

    // 6. Close the temporary backup database connection so the file is completely flushed
    tempDb.closeSync();
    tempDb = null;
    await new Promise(res => setTimeout(res, 100));

    // 7. Resolve the backup file URI inside SQLiteBackups
    const finalBackupUri = backupDir
      ? toFileUri(`${backupDir}/${finalFileName}`)
      : toFileUri(`${(FileSystem.cacheDirectory || FileSystem.documentDirectory || '').replace(/\/+$/, '')}/${finalFileName}`);

    let shareUri = finalBackupUri;

    // Optional copy to cache directory for maximum Android Share Sheet compatibility
    if (FileSystem.cacheDirectory) {
      try {
        const cacheDestUri = toFileUri(`${FileSystem.cacheDirectory.replace(/\/+$/, '')}/${finalFileName}`);
        await FileSystem.copyAsync({ from: finalBackupUri, to: cacheDestUri });
        shareUri = cacheDestUri;
      } catch (cacheCopyErr) {
        console.warn('[BackupRestore] Cache copy skipped, sharing directly from backup storage:', cacheCopyErr);
        shareUri = finalBackupUri;
      }
    }

    // 8. Open Android native share/save sheet so user can choose persistent location
    const isShareAvailable = await Sharing.isAvailableAsync();
    if (isShareAvailable) {
      await Sharing.shareAsync(shareUri, {
        mimeType: 'application/x-sqlite3',
        dialogTitle: 'Rongdhonu POS Backup — Save to Downloads or Drive',
        UTI: 'public.database',
      });
    }

    // 9. Update last backup timestamp in local app_config
    setAppConfig('last_backup_timestamp', nowIso);
    setAppConfig('last_backup_file_name', finalFileName);

    // 10. Record activity log if logger is available
    try {
      const { logActivity } = require('./activityLogger');
      logActivity({
        actionType: 'DATA_BACKUP',
        actionTitle: 'Local SQLite Backup Created',
        description: `Exported ${totalRecords} records across ${Object.keys(tableStats).length} tables into ${finalFileName}`,
        metadata: { fileName: finalFileName, totalRecords, tableStats },
      });
    } catch (_) {}

    return {
      success: true,
      fileName: finalFileName,
      uri: shareUri,
      metadata: {
        backup_timestamp: nowIso,
        app_version: appVersion,
        schema_version: '1',
        total_tables: Object.keys(tableStats).length,
        total_records: totalRecords,
        table_stats: tableStats,
        backup_source: 'Rongdhonu POS',
        app_profile: currentProfile,
      },
    };
  } catch (error) {
    console.error('[BackupRestore] createBackup failed:', error);
    if (tempDb) {
      try { tempDb.closeSync(); } catch (_) {}
    }
    const backupDir = getBackupDirectory();
    try { SQLite.deleteDatabaseSync(finalFileName, backupDir); } catch (_) {}
    if (backupDir) {
      try { await FileSystem.deleteAsync(`${backupDir}/${finalFileName}`, { idempotent: true }); } catch (_) {}
    }
    return { success: false, error: error.message || 'Failed to create database backup.' };
  }
}

// ─── 4. DOCUMENT PICKER & VALIDATION ─────────────────────────────────────────

/**
 * Opens native document picker for the user to select an existing `.db` backup file,
 * then rigorously validates its format, metadata, security contents, and profile compatibility.
 *
 * @returns {Promise<{ valid: boolean, inspectDbName?: string, metadata?: object, formattedDate?: string, fileName?: string, fileSize?: number, error?: string }>}
 */
export async function pickAndValidateBackup() {
  let inspectDb = null;
  const inspectDbName = `inspect_${Date.now()}.db`;
  const backupDir = getBackupDirectory();
  await ensureBackupDirectoryExists();
  const inspectTargetUri = backupDir
    ? toFileUri(`${backupDir}/${inspectDbName}`)
    : toFileUri(`${(FileSystem.cacheDirectory || FileSystem.documentDirectory || '').replace(/\/+$/, '')}/${inspectDbName}`);

  try {
    // 1. Prompt user to select backup file
    const pickerResult = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      type: '*/*',
    });

    if (pickerResult.canceled || !pickerResult.assets || pickerResult.assets.length === 0) {
      return { valid: false, canceled: true };
    }

    const asset = pickerResult.assets[0];
    const sourceUri = toFileUri(asset.uri);
    const fileName = asset.name || 'backup.db';
    const fileSize = asset.size || 0;

    // 2. Copy selected file to safe SQLiteBackups directory to inspect using expo-sqlite
    await FileSystem.copyAsync({ from: sourceUri, to: inspectTargetUri });

    // 3. Open database using scoped backupDir
    try {
      inspectDb = SQLite.openDatabaseSync(inspectDbName, { useNewConnection: true }, backupDir);
    } catch (openErr) {
      throw new Error('Selected file is not a valid SQLite database. (নির্বাচিত ফাইলটি সঠিক SQLite ডাটাবেজ নয়)');
    }

    // 4. Verify _backup_metadata table exists
    const metaTableCheck = inspectDb.getFirstSync(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='_backup_metadata';"
    );
    if (!metaTableCheck) {
      throw new Error(
        'Invalid backup file: _backup_metadata header is missing. (অকার্যকর ব্যাকআপ ফাইল: মেটাডাটা হেডার পাওয়া যায়নি)'
      );
    }

    // 5. Read metadata keys
    const metaRows = inspectDb.getAllSync('SELECT key, value FROM _backup_metadata;');
    const metadata = {};
    for (const row of metaRows) {
      metadata[row.key] = row.value;
    }

    // 6. Validate backup_source
    if (metadata.backup_source !== 'Rongdhonu POS') {
      throw new Error(
        'Incompatible backup source. File was not generated by Rongdhonu POS. (অপরিচিত সোর্স: এই ব্যাকআপ ফাইলটি রংধনু অ্যাপের তৈরি নয়)'
      );
    }

    // 7. Validate schema_version
    if (metadata.schema_version !== '1') {
      throw new Error(
        `Unsupported schema version (${metadata.schema_version}). Please update your app. (অসমর্থিত স্কিমা ভার্সন)`
      );
    }

    // 8. Validate app_profile compatibility
    const currentProfile = String(ACTIVE_APP_PROFILE || 'ADMIN').toUpperCase().trim();
    const backupProfile = String(metadata.app_profile || '').toUpperCase().trim();

    if (backupProfile && backupProfile !== currentProfile) {
      throw new Error(
        `App Profile Mismatch: This backup was created from the "${backupProfile}" app profile and cannot be restored into "${currentProfile}". (প্রোফাইল অমিল: এই ব্যাকআপটি "${backupProfile}" অ্যাপের, "${currentProfile}" অ্যাপে রিস্টোর করা যাবে না)`
      );
    }

    // 9. Validate table_stats JSON
    let tableStats = {};
    try {
      tableStats = JSON.parse(metadata.table_stats || '{}');
    } catch (_) {
      throw new Error('Corrupted backup table statistics in metadata. (মেটাডাটা টেবিল পরিসংখ্যান ক্ষতিগ্রস্ত)');
    }

    // 10. Security check: verify no credentials or excluded tables exist in backup
    const backupTables = inspectDb.getAllSync(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';"
    );
    const tableNames = backupTables.map(t => t.name);

    for (const forbidden of EXCLUDED_TABLES) {
      if (tableNames.includes(forbidden)) {
        console.warn(`[BackupRestore] Warning: Excluded table ${forbidden} found in backup file. It will NOT be restored.`);
      }
    }

    // Verify app_config in backup doesn't contain auth credentials
    if (tableNames.includes('app_config')) {
      const leakedAuthKeys = inspectDb.getAllSync(
        "SELECT key FROM app_config WHERE key LIKE '_fb_auth_%' OR key IN ('login_session_user', 'remembered_username', 'force_reauth_required');"
      );
      if (leakedAuthKeys && leakedAuthKeys.length > 0) {
        throw new Error(
          'Security check failed: Backup contains sensitive authentication tokens. (নিরাপত্তা ত্রুটি: ব্যাকআপে অথেনটিকেশন টোকেন বিদ্যমান)'
        );
      }
    }

    // Close inspectDb connection cleanly
    inspectDb.closeSync();
    inspectDb = null;

    return {
      valid: true,
      inspectDbName,
      fileName,
      fileSize,
      metadata: {
        ...metadata,
        table_stats: tableStats,
      },
      formattedDate: formatDisplayDate(metadata.backup_timestamp),
      totalTables: Number(metadata.total_tables) || Object.keys(tableStats).length,
      totalRecords: Number(metadata.total_records) || 0,
    };
  } catch (error) {
    console.error('[BackupRestore] pickAndValidateBackup failed:', error);
    if (inspectDb) {
      try { inspectDb.closeSync(); } catch (_) {}
    }
    try { SQLite.deleteDatabaseSync(inspectDbName, backupDir); } catch (_) {}
    if (inspectTargetUri) {
      try { await FileSystem.deleteAsync(inspectTargetUri, { idempotent: true }); } catch (_) {}
    }
    return {
      valid: false,
      error: error.message || 'Validation failed. The file could not be verified.',
    };
  }
}

// ─── 5. ATOMIC RESTORE ───────────────────────────────────────────────────────

/**
 * Performs transaction-safe atomic data restoration from the validated backup.
 * On ANY error, rolls back completely without leaving partial data.
 * Strictly preserves local users table, device_registry, sync queues, and active auth tokens.
 *
 * @param {string} inspectDbName The verified temporary database file name
 * @param {object} validatedMetadata The validated metadata object
 * @returns {Promise<{ success: boolean, totalRestored?: number, error?: string }>}
 */
export async function restoreBackup(inspectDbName, validatedMetadata) {
  let backupDb = null;
  const localDb = getDb();
  const backupDir = getBackupDirectory();

  if (!localDb) {
    return { success: false, error: 'Local database is not initialized.' };
  }

  try {
    backupDb = SQLite.openDatabaseSync(inspectDbName, { useNewConnection: true }, backupDir);
    const tableStats = validatedMetadata?.metadata?.table_stats || validatedMetadata?.table_stats || {};
    let totalRestored = 0;

    // Temporarily disable foreign keys during mass data reconstruction to prevent FK constraint deadlock
    localDb.execSync('PRAGMA foreign_keys = OFF;');

    try {
      localDb.execSync('BEGIN TRANSACTION;');

      for (const tableName of Object.keys(tableStats)) {
        // Enforce table policy
        if (EXCLUDED_TABLES.includes(tableName)) {
          // Strictly skip security/transient tables!
          continue;
        }
        if (!INCLUDED_TABLES.includes(tableName)) {
          // Skip unrecognized tables
          continue;
        }

        if (tableName === 'app_config') {
          // Special atomic handling for app_config:
          // Delete all non-sensitive config keys from localdb, but PRESERVE existing active auth tokens
          localDb.runSync(`
            DELETE FROM app_config 
            WHERE key NOT LIKE '_fb_auth_%' 
              AND key NOT IN ('login_session_user', 'remembered_username', 'force_reauth_required', 'restore_in_progress', 'initial_restore_required', 'initial_restore_done_v1');
          `);

          // Insert sanitized config keys from backup
          const backupConfigs = backupDb.getAllSync('SELECT * FROM app_config;');
          const nowIso = new Date().toISOString();

          for (const row of backupConfigs) {
            if (!isSensitiveConfigKey(row.key)) {
              localDb.runSync(
                'INSERT OR REPLACE INTO app_config (id, key, value, created_at, updated_at, is_synced) VALUES (?, ?, ?, ?, ?, ?);',
                [row.id || row.key, row.key, row.value, row.created_at || nowIso, row.updated_at || nowIso, 0]
              );
              totalRestored++;
            }
          }
          continue;
        }

        // Standard persistent business tables:
        // 1. Wipe existing rows in local table
        localDb.execSync(`DELETE FROM ${tableName};`);

        // 2. Fetch rows from backup
        const rows = backupDb.getAllSync(`SELECT * FROM ${tableName};`);
        if (rows && rows.length > 0) {
          const cols = Object.keys(rows[0]);
          const placeholders = cols.map(() => '?').join(', ');
          const insertSql = `INSERT INTO ${tableName} (${cols.join(', ')}) VALUES (${placeholders});`;

          for (const r of rows) {
            localDb.runSync(insertSql, cols.map(c => r[c]));
            totalRestored++;
          }
        }
      }

      // Commit the transaction atomically
      localDb.execSync('COMMIT;');
    } catch (txError) {
      localDb.execSync('ROLLBACK;');
      throw txError;
    } finally {
      // Re-enable foreign key constraints
      localDb.execSync('PRAGMA foreign_keys = ON;');
    }

    // Close and clean up the temporary inspect database file
    try { backupDb.closeSync(); } catch (_) {}
    try { SQLite.deleteDatabaseSync(inspectDbName, backupDir); } catch (_) {}
    if (backupDir) {
      try { await FileSystem.deleteAsync(`${backupDir}/${inspectDbName}`, { idempotent: true }); } catch (_) {}
    }

    // Ensure database integrity and default seeds (like fixed tables/users) are preserved if missing
    try {
      initDatabase(true);
    } catch (initErr) {
      console.warn('[BackupRestore] Post-restore initDatabase notice:', initErr);
    }

    // Update last restore timestamp in app_config
    const now = new Date().toISOString();
    setAppConfig('last_restore_timestamp', now);

    // Record activity log
    try {
      const { logActivity } = require('./activityLogger');
      logActivity({
        actionType: 'DATA_RESTORE',
        actionTitle: 'Local SQLite Backup Restored',
        description: `Successfully restored ${totalRestored} records from backup file ${validatedMetadata?.fileName || ''}`,
        metadata: {
          backupTimestamp: validatedMetadata?.metadata?.backup_timestamp,
          totalRestored,
        },
      });
    } catch (_) {}

    return {
      success: true,
      totalRestored,
    };
  } catch (restoreError) {
    console.error('[BackupRestore] restoreBackup failed:', restoreError);
    if (backupDb) {
      try { backupDb.closeSync(); } catch (_) {}
    }
    try { SQLite.deleteDatabaseSync(inspectDbName, backupDir); } catch (_) {}
    if (backupDir) {
      try { await FileSystem.deleteAsync(`${backupDir}/${inspectDbName}`, { idempotent: true }); } catch (_) {}
    }
    return {
      success: false,
      error: restoreError.message || 'Restore failed. Local database rolled back completely to previous state.',
    };
  }
}

// ─── 6. AUDIT STATUS GETTER ──────────────────────────────────────────────────

/**
 * Returns the current backup and restore status timestamps.
 */
export function getBackupStatus() {
  try {
    const lastBackup = getAppConfig('last_backup_timestamp');
    const lastBackupFile = getAppConfig('last_backup_file_name');
    const lastRestore = getAppConfig('last_restore_timestamp');

    return {
      lastBackupTimestamp: lastBackup,
      lastBackupDisplay: lastBackup ? formatDisplayDate(lastBackup) : 'Never (কখনও করা হয়নি)',
      lastBackupFile: lastBackupFile || 'None',
      lastRestoreTimestamp: lastRestore,
      lastRestoreDisplay: lastRestore ? formatDisplayDate(lastRestore) : 'Never (কখনও করা হয়নি)',
      appProfile: String(ACTIVE_APP_PROFILE || 'ADMIN').toUpperCase().trim(),
    };
  } catch (_) {
    return {
      lastBackupDisplay: 'Unavailable',
      lastRestoreDisplay: 'Unavailable',
      appProfile: 'ADMIN',
    };
  }
}
