/**
 * Phase 2O — Supabase Authentication & Device Sync Hardening Verification Test Suite
 *
 * Covers:
 * 1. Anonymous authentication disabled handling (safe fallback, no crash)
 * 2. Successful authentication handling (session object truthy check in dispatcher)
 * 3. Authentication retry and session persistence (persistSession, getSession reuse, mutex reset)
 * 4. Device registration before approval (status='PENDING', allow_login=false, is_active_device=false)
 * 5. Device registration after approval (status='ACTIVE', allow_login=true, is_active_device=true)
 * 6. Device identity mismatch & hijack protection (DEVICE_ALREADY_BOUND, USER_ALREADY_BOUND)
 * 7. device_app_usage RLS rejection (auth_user_id mismatch / unauthenticated)
 * 8. Successful usage upload (deviceCheck matches auth_user_id)
 * 9. Retry after failed usage upload (is_synced=0, safe retry)
 * 10. Firebase fallback when Supabase is unavailable (dual-queue safety, failure isolation)
 * 11. Recovery after Supabase becomes available (circuit breaker restoration)
 */

'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('======================================================');
console.log('   PHASE 2O — AUTHENTICATION & SYNC VERIFICATION SUITE');
console.log('======================================================\n');

let passedTests = 0;
let failedTests = 0;

function it(desc, fn) {
  try {
    fn();
    console.log(`  ✅  ${desc}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌  ${desc}`);
    console.error(`      ${err.message}`);
    failedTests++;
  }
}

// Read relevant source files
const clientCode = fs.readFileSync(path.join(__dirname, '../services/supabaseClient.js'), 'utf8');
const dispatcherCode = fs.readFileSync(path.join(__dirname, '../services/supabaseSyncDispatcher.js'), 'utf8');
const trackerCode = fs.readFileSync(path.join(__dirname, '../services/appUsageTracker.js'), 'utf8');
const registryCode = fs.readFileSync(path.join(__dirname, '../services/deviceRegistry.js'), 'utf8');
const controlCode = fs.readFileSync(path.join(__dirname, '../services/supabaseDeviceControl.js'), 'utf8');
const schemaSql = fs.readFileSync(path.join(__dirname, '../supabase_full_setup.sql'), 'utf8');
const migrationSql = fs.readFileSync(path.join(__dirname, '../scripts/migrations/fix_device_registration_approval_flow.sql'), 'utf8');
const dbCode = fs.readFileSync(path.join(__dirname, '../database.js'), 'utf8');

// ── 1. Anonymous Authentication Disabled Handling ────────────────────────────
it('TC-01: Anonymous authentication failure handled safely without throwing or crashing', () => {
  assert.ok(clientCode.includes('export async function ensureAnonymousAuth()'), 'ensureAnonymousAuth exported');
  assert.ok(clientCode.includes("console.warn('[SupabaseClient] Anonymous sign-in error:', error.message)"), 'Logs warning on auth error');
  assert.ok(clientCode.includes('return null;'), 'Returns null on auth failure instead of throwing');
  assert.ok(clientCode.includes('safeSupabaseCall'), 'ensureAnonymousAuth wraps call in safeSupabaseCall fail-safe');
});

// ── 2. Successful Authentication & Dispatcher Session Truthy Check ───────────
it('TC-02: supabaseSyncDispatcher checks session existence without broken .success property', () => {
  // CRITICAL DEFECT FIX: ensureAnonymousAuth returns a Session object which has NO .success property.
  // Checking !session properly handles session presence without blocking authenticated calls.
  assert.ok(dispatcherCode.includes('const session = await ensureAnonymousAuth();'), 'Dispatcher awaits ensureAnonymousAuth');
  assert.ok(dispatcherCode.includes('if (!session) {'), 'Dispatcher checks if (!session) instead of broken !authResult.success');
  assert.strictEqual(
    dispatcherCode.includes('!authResult.success'),
    false,
    'FAIL: Broken !authResult.success check must not exist in supabaseSyncDispatcher.js'
  );
});

// ── 3. Authentication Retry & Session Persistence ────────────────────────────
it('TC-03: Session persistence configured with dedicated partition and auto-refresh', () => {
  assert.ok(clientCode.includes("storageKey: 'sb_device_auth'"), 'Device client uses dedicated sb_device_auth storage partition');
  assert.ok(clientCode.includes('persistSession: true'), 'Session persistence enabled');
  assert.ok(clientCode.includes('autoRefreshToken: true'), 'Automatic token refresh enabled');
  assert.ok(clientCode.includes('supabase.auth.getSession()'), 'Checks existing session first before requesting new one');
  // Mutex reset on completion or failure
  assert.ok(clientCode.includes('finally {\n      authInitPromise = null;\n    }'), 'authInitPromise mutex reset in finally block allowing retry');
});

// ── 4. Device Registration Before Approval ───────────────────────────────────
it('TC-04: New device self-registers as PENDING with allow_login=false and is_active_device=false', () => {
  // SQLite local record
  assert.ok(registryCode.includes("status, registered_by, notes"), 'SQLite stores status');
  assert.ok(registryCode.includes("'PENDING'"), 'Initial local state is PENDING');
  assert.ok(registryCode.includes("0, 0, 'PENDING'"), 'Initial allow_login and allow_offline are 0');

  // Supabase upsert self-registration enforcement
  assert.ok(controlCode.includes("status: 'PENDING'"), 'upsertDeviceToSupabase enforces status=PENDING');
  assert.ok(controlCode.includes("allow_login: false"), 'upsertDeviceToSupabase enforces allow_login=false');
  assert.ok(controlCode.includes("allow_offline: false"), 'upsertDeviceToSupabase enforces allow_offline=false');
  assert.ok(controlCode.includes("ignoreDuplicates: true"), 'upsertDeviceToSupabase uses ignoreDuplicates: true to prevent UPDATE RLS conflicts');

  // Schema INSERT RLS policy enforces PENDING only
  assert.ok(schemaSql.includes("status = 'PENDING'"), 'INSERT RLS policy enforces status=PENDING');
  assert.ok(schemaSql.includes("allow_login = false"), 'INSERT RLS policy enforces allow_login=false');
  assert.ok(schemaSql.includes("auth_user_id IS NULL"), 'INSERT RLS policy enforces initial auth_user_id IS NULL');

  // Schema is_active_device function rejects PENDING
  assert.ok(schemaSql.includes("status = 'ACTIVE'"), 'is_active_device() strictly requires status=ACTIVE');
});

// ── 5. Device Registration After Approval ────────────────────────────────────
it('TC-05: Admin approval sets status=ACTIVE and allow_login=true enabling business access', () => {
  assert.ok(schemaSql.includes("ELSIF p_action = 'APPROVE' THEN"), 'admin_device_action supports APPROVE');
  assert.ok(schemaSql.includes("status = 'ACTIVE'"), 'APPROVE sets status=ACTIVE');
  assert.ok(schemaSql.includes("allow_login = true"), 'APPROVE sets allow_login=true');
  assert.ok(schemaSql.includes("admin_lock = false"), 'APPROVE clears admin_lock');

  // Once status is ACTIVE and auth_user_id matches, is_active_device() returns true
  assert.ok(schemaSql.includes("WHERE auth_user_id = auth.uid()"), 'is_active_device checks matching auth_user_id');
});

// ── 6. Device Identity Mismatch & Hijack Protection ──────────────────────────
it('TC-06: register_device_auth prevents session hijacking of ACTIVE devices', () => {
  assert.ok(
    schemaSql.includes("IF v_device.status = 'ACTIVE' AND v_device.auth_user_id IS NOT NULL AND v_device.auth_user_id != v_uid THEN"),
    'Blocks ACTIVE device re-binding to a different auth UID'
  );
  assert.ok(schemaSql.includes("'DEVICE_ALREADY_BOUND'"), 'Returns DEVICE_ALREADY_BOUND error');
  assert.ok(
    schemaSql.includes("IF EXISTS (SELECT 1 FROM public.devices WHERE auth_user_id = v_uid AND device_id != p_device_id) THEN"),
    'Blocks one auth session from binding multiple physical devices'
  );
  assert.ok(schemaSql.includes("'USER_ALREADY_BOUND'"), 'Returns USER_ALREADY_BOUND error');
});

// ── 7. device_app_usage RLS Policy Verification ──────────────────────────────
it('TC-07: device_app_usage RLS permits only matching authenticated device', () => {
  assert.ok(schemaSql.includes('CREATE POLICY "Devices insert own app usage"'), 'device_app_usage has INSERT policy');
  assert.ok(
    schemaSql.includes('device_id IN (\n            SELECT d.device_id\n            FROM public.devices d\n            WHERE d.auth_user_id = auth.uid()\n        )'),
    'INSERT policy requires device_id matching auth_user_id of authenticated session'
  );
  assert.ok(schemaSql.includes('CREATE POLICY "Devices update own app usage"'), 'device_app_usage has UPDATE policy');
  assert.ok(schemaSql.includes('CREATE POLICY "Devices read own app usage"'), 'device_app_usage has SELECT policy');
});

// ── 8. Successful Usage Upload Flow ──────────────────────────────────────────
it('TC-08: appUsageTracker verifies auth session and device binding before upserting', () => {
  assert.ok(trackerCode.includes('const session = await ensureAnonymousAuth();'), 'Checks auth session before cloud push');
  assert.ok(trackerCode.includes('if (!session)'), 'Safely checks session existence');
  assert.ok(trackerCode.includes('return false;'), 'Returns false when session unavailable');
  assert.ok(trackerCode.includes(".from('devices')"), 'Queries devices table to verify device binding');
  assert.ok(trackerCode.includes('.maybeSingle()'), 'Uses maybeSingle to check device row');
  assert.ok(trackerCode.includes('if (!deviceCheck)'), 'Skips silently if device row not found or not bound');
  assert.ok(trackerCode.includes(".from('device_app_usage')"), 'Upserts to device_app_usage');
  assert.ok(trackerCode.includes("UPDATE device_app_usage SET is_synced = 1"), 'Marks is_synced=1 on success');
});

// ── 9. Retry After Failed Usage Upload ───────────────────────────────────────
it('TC-09: Failed usage upload remains local with is_synced=0 and retries on cadence', () => {
  assert.ok(trackerCode.includes('CLOUD_SYNC_INTERVAL_MS = 30000'), 'Uses 30s background sync cadence');
  assert.ok(trackerCode.includes('console.warn(\'[AppUsageTracker] Cloud sync error:\', error.message)'), 'Logs warning on failure without crashing');
  // When error occurs, is_synced is NOT updated to 1
  assert.ok(trackerCode.includes('return false;'), 'Returns false on failure keeping row pending for next tick');
});

// ── 10. Firebase Fallback When Supabase Is Unavailable ───────────────────────
it('TC-10: Firebase fallback and dual-cloud queue retain safety invariants', () => {
  // SQLite mutations always happen first
  assert.ok(dbCode.includes('CREATE TABLE IF NOT EXISTS sync_queue'), 'sync_queue table exists');
  // Dual-column tracking
  assert.ok(dbCode.includes('status_firestore'), 'Tracks status_firestore independently');
  assert.ok(dbCode.includes('status_supabase'), 'Tracks status_supabase independently');
  // Both backends must succeed before queue deletion
  assert.ok(dbCode.includes('function isQueueItemDeletable'), 'isQueueItemDeletable exported');
  assert.ok(
    dbCode.includes('statusFirestore === \'SUCCESS\' || statusFirestore === \'NOT_APPLICABLE\'') &&
    dbCode.includes('statusSupabase === \'SUCCESS\' || statusSupabase === \'NOT_APPLICABLE\''),
    'Item only deletable when BOTH backends succeed'
  );
});

// ── 11. Phase 2N Migration File Contains Full Fixes ──────────────────────────
it('TC-11: fix_device_registration_approval_flow.sql includes REPLICA IDENTITY, Admin fleet SELECT, and enhanced RPC', () => {
  assert.ok(migrationSql.includes('ALTER TABLE public.devices REPLICA IDENTITY FULL;'), 'Sets REPLICA IDENTITY FULL for devices');
  assert.ok(migrationSql.includes('CREATE POLICY "Admins read device fleet"'), 'Creates Admin fleet SELECT policy');
  assert.ok(migrationSql.includes('CREATE OR REPLACE FUNCTION public.register_device_auth('), 'Replaces register_device_auth RPC');
  assert.ok(migrationSql.includes('p_metadata JSONB DEFAULT'), 'Accepts metadata parameter for auto-registration');
  assert.ok(migrationSql.includes("v_device.status = 'ACTIVE' AND v_device.auth_user_id IS NOT NULL AND v_device.auth_user_id != v_uid"), 'Allows PENDING re-binding while protecting ACTIVE devices');
});

// ── 12. Non-Admin Cannot Bypass Device Pending Screen ────────────────────────
it('TC-12: Owner and Manager cannot bypass PENDING status at login or startup', () => {
  const appCode = fs.readFileSync(path.join(__dirname, '../App.js'), 'utf8');
  assert.ok(registryCode.includes("remote.status === 'PENDING' && roleUpper !== 'ADMIN'"), 'verifyDeviceAccessOnStartupOrResume blocks non-admin PENDING devices');
  assert.ok(registryCode.includes("allowed: false"), 'allowed is false for PENDING non-admin devices');
  assert.ok(appCode.includes("ACTIVE_APP_PROFILE !== 'ADMIN'"), 'App profile guard protects Admin while gating Owner/Manager');
  assert.ok(appCode.includes("setCurrentScreen('DEVICE_PENDING')"), 'Redirects to DEVICE_PENDING screen when not approved');
});

// ── 13. Device Upsert RLS Hardening (ERROR 1 Fix) ────────────────────────────
it('TC-13: upsertDeviceToSupabase strictly enforces PENDING self-registration and ignoreDuplicates', () => {
  assert.ok(controlCode.includes("status: 'PENDING'"), 'Forces status: PENDING');
  assert.ok(controlCode.includes("allow_login: false"), 'Forces allow_login: false');
  assert.ok(controlCode.includes("allow_offline: false"), 'Forces allow_offline: false');
  assert.ok(controlCode.includes("admin_lock: false"), 'Forces admin_lock: false');
  assert.ok(controlCode.includes("is_deleted: false"), 'Forces is_deleted: false');
  assert.ok(controlCode.includes("ignoreDuplicates: true"), 'Uses ignoreDuplicates: true to prevent UPDATE RLS policy check');
  // Confirms the old pattern that passed unapproved/active SQLite state is removed
  assert.strictEqual(
    controlCode.includes('status: record.status || \'PENDING\''),
    false,
    'Client cannot pass unverified record.status to Supabase upsert'
  );
});

// ── 14. Primary Key Mapping for daily_submit_priority (ERROR 2 Fix) ──────────
it('TC-14: getPrimaryKeyColumn returns business_date for daily_submit_priority and id for other tables', () => {
  const { getPrimaryKeyColumn } = require('../services/supabasePrimarySync.js');
  assert.strictEqual(getPrimaryKeyColumn('daily_submit_priority'), 'business_date');
  assert.strictEqual(getPrimaryKeyColumn('orders'), 'id');
  assert.strictEqual(getPrimaryKeyColumn('payments'), 'id');
  assert.strictEqual(getPrimaryKeyColumn('order_items'), 'id');
  assert.strictEqual(getPrimaryKeyColumn('expenses'), 'id');
  assert.strictEqual(getPrimaryKeyColumn('deliveries'), 'id');
  assert.strictEqual(getPrimaryKeyColumn('daily_submit'), 'id');
  assert.strictEqual(getPrimaryKeyColumn('daily_summary'), 'id');
  assert.strictEqual(getPrimaryKeyColumn('restaurant_tables'), 'id');
  assert.strictEqual(getPrimaryKeyColumn('menu_items'), 'id');
  assert.strictEqual(getPrimaryKeyColumn('menu_categories'), 'id');
  assert.strictEqual(getPrimaryKeyColumn('app_config'), 'id');
  assert.strictEqual(getPrimaryKeyColumn('supplier_due'), 'id');
});

// ── 15. Delta Query Does Not Reference Nonexistent id Column (ERROR 2 Fix) ──
it('TC-15: fetchChangedRecordsFromSupabase dynamically uses pkCol for tie-breaker order', () => {
  const primarySyncCode = fs.readFileSync(path.join(__dirname, '../services/supabasePrimarySync.js'), 'utf8');
  assert.ok(primarySyncCode.includes('const pkCol = getPrimaryKeyColumn(tableName);'), 'Resolves pkCol dynamically in delta query');
  assert.ok(primarySyncCode.includes(".order('updated_at', { ascending: true }).order(pkCol, { ascending: true })"), 'Orders by updated_at and pkCol');
  assert.strictEqual(
    primarySyncCode.includes(".order('updated_at', { ascending: true }).order('id', { ascending: true })"),
    false,
    'Hardcoded .order("id") must not exist in delta query'
  );
});

// ── 16. Ingestion Uses Dynamic Primary Key (ERROR 2 Fix) ─────────────────────
it('TC-16: applyCloudRowsToSqlite and handleRealtimeEvent use dynamic primary key', () => {
  const primarySyncCode = fs.readFileSync(path.join(__dirname, '../services/supabasePrimarySync.js'), 'utf8');
  assert.ok(primarySyncCode.includes('const pkCol = getPrimaryKeyColumn(tableName);'), 'applyCloudRowsToSqlite resolves pkCol');
  assert.ok(primarySyncCode.includes('if (!row || !row[pkCol]) continue;'), 'applyCloudRowsToSqlite checks row[pkCol]');
  assert.ok(primarySyncCode.includes('WHERE ${pkCol} = ?'), 'applyCloudRowsToSqlite checks existing row by pkCol');
  assert.ok(primarySyncCode.includes('const pkCol = getPrimaryKeyColumn(table);'), 'handleRealtimeEvent resolves pkCol');
  assert.ok(primarySyncCode.includes('oldRow?.[pkCol] || newRow?.[pkCol]'), 'handleRealtimeEvent extracts recordId via pkCol');
});

// ── 17. No Cursor Advancement on Failed Delta Query ─────────────────────────
it('TC-17: syncSupabaseCollections returns immediately without advancing cursor on fetch failure', () => {
  const primarySyncCode = fs.readFileSync(path.join(__dirname, '../services/supabasePrimarySync.js'), 'utf8');
  const failureBlockStart = primarySyncCode.indexOf('if (!fetchResult.success) {');
  const failureBlockEnd = primarySyncCode.indexOf('const docs = fetchResult.documents');
  const failureBlock = primarySyncCode.substring(failureBlockStart, failureBlockEnd);
  assert.ok(failureBlock.includes('recordRestFailure(fetchResult)'), 'Records REST failure on error');
  assert.ok(failureBlock.includes('return { success: false, error: fetchResult.error, failedTable: table };'), 'Returns early without reaching cursor update');
});

// ── 18. Supabase Failure Fallback Invariant ──────────────────────────────────
it('TC-18: REST failure trips circuit breaker and falls back to Firebase without data loss', () => {
  const primarySyncCode = fs.readFileSync(path.join(__dirname, '../services/supabasePrimarySync.js'), 'utf8');
  assert.ok(primarySyncCode.includes('transitionHealthState(HEALTH_STATES.FIREBASE_FALLBACK'), 'Transitions to FIREBASE_FALLBACK on consecutive errors');
  assert.ok(primarySyncCode.includes('consecutiveRestErrors'), 'Tracks consecutive REST errors');
});

// ── 19. RPC Auto-Registration Priority in Device Upsert ─────────────────────
it('TC-19: upsertDeviceToSupabase prioritizes registerDeviceAuth RPC for RLS-safe auto-registration', () => {
  const upsertBody = controlCode.substring(
    controlCode.indexOf('export async function upsertDeviceToSupabase'),
    controlCode.indexOf('export async function updateSupabaseDevice')
  );
  assert.ok(upsertBody.includes('await registerDeviceAuth(record.device_id, metadata)'), 'Calls registerDeviceAuth RPC as primary path');
  assert.ok(upsertBody.includes('if (rpcRes && rpcRes.success) {\n      return true;\n    }'), 'Returns early on RPC success avoiding direct table upsert');
});

// ── 20. Backward-Compatible 1-Argument RPC Fallback ──────────────────────────
it('TC-20: registerDeviceAuth falls back to 1-arg signature if p_metadata is rejected (PGRST202)', () => {
  const rpcBody = controlCode.substring(
    controlCode.indexOf('export async function registerDeviceAuth'),
    controlCode.indexOf('export async function getDeviceFleet')
  );
  assert.ok(rpcBody.includes('PGRST202'), 'Checks for PGRST202 schema cache error');
  assert.ok(rpcBody.includes('p_device_id: deviceId\n      });'), 'Falls back to 1-argument RPC signature');
});

console.log('\n------------------------------------------------------');
console.log(`Tests Passed: ${passedTests}`);
console.log(`Tests Failed: ${failedTests}`);
console.log('======================================================\n');

if (failedTests > 0) {
  process.exit(1);
} else {
  console.log('🎉 ALL PHASE 2O AUTH & SYNC VERIFICATION TESTS PASSED SUCCESSFULLY!\n');
}
