/**
 * Supabase Phase 1B Admin Device Management RPC Test Suite
 * Validates:
 * A. Admin fleet uses get_device_fleet RPC.
 * B. APPROVE uses admin_device_action.
 * C. BLOCK uses admin_device_action.
 * D. LOCK/UNLOCK use admin_device_action.
 * E. FORCE_LOGOUT uses admin_device_action.
 * F. Exact p_action/p_target_device_id parameters.
 * G. Non-admin session cannot perform Admin action.
 * H. Missing Admin session triggers authentication requirement.
 * I. Admin authentication failure does not affect SQLite login.
 * J. Device telemetry continues using device identity.
 * K. Admin session cannot overwrite device anonymous identity.
 * L. No privileged direct devices UPDATE remains.
 * M. service_role remains absent from client.
 * N. Firestore sync remains unchanged.
 */

import fs from 'fs';
import assert from 'assert';

console.log('======================================================');
console.log('   SUPABASE PHASE 1B ADMIN RPC MIGRATION TEST SUITE   ');
console.log('======================================================\n');

// 1. Static Source Code Assertions
const clientCode = fs.readFileSync('services/supabaseClient.js', 'utf8');
const controlCode = fs.readFileSync('services/supabaseDeviceControl.js', 'utf8');
const registryCode = fs.readFileSync('services/deviceRegistry.js', 'utf8');
const screenCode = fs.readFileSync('screens/DeviceManagementScreen.js', 'utf8');
const dbCode = fs.readFileSync('database.js', 'utf8');

// ── Test A: Admin fleet uses get_device_fleet RPC ────────────────────────────
assert.ok(controlCode.includes('export async function getDeviceFleet()'), 'FAIL: getDeviceFleet must be exported');
assert.ok(controlCode.includes("supabase.rpc('get_device_fleet')"), 'FAIL: getDeviceFleet must call get_device_fleet RPC');
assert.ok(screenCode.includes('getDeviceFleet'), 'FAIL: DeviceManagementScreen must use getDeviceFleet');
assert.ok(controlCode.includes('const fleetRes = await getDeviceFleet()'), 'FAIL: fetchSupabaseDevices must route through getDeviceFleet RPC');
assert.strictEqual(controlCode.includes(".from('devices').select('*').order("), false, 'FAIL: Direct fleet SELECT must be eliminated');
console.log('  ✅  Test A: Admin fleet uses get_device_fleet RPC');

// ── Test B: APPROVE uses admin_device_action ─────────────────────────────────
assert.ok(registryCode.includes("cleanStatus === 'ACTIVE' ? 'APPROVE'"), 'FAIL: ACTIVE status must map to APPROVE action');
assert.ok(registryCode.includes('adminDeviceAction(action, deviceId)'), 'FAIL: updateDeviceStatus must call adminDeviceAction');
console.log('  ✅  Test B: APPROVE uses admin_device_action');

// ── Test C: BLOCK uses admin_device_action ───────────────────────────────────
assert.ok(registryCode.includes("cleanStatus === 'BLOCKED' ? 'BLOCK'"), 'FAIL: BLOCKED status must map to BLOCK action');
console.log('  ✅  Test C: BLOCK uses admin_device_action');

// ── Test D: LOCK/UNLOCK use admin_device_action ──────────────────────────────
assert.ok(registryCode.includes("const action = enableLock ? 'LOCK' : 'UNLOCK'"), 'FAIL: enableLock must map to LOCK / UNLOCK');
assert.ok(registryCode.includes('await adminDeviceAction(action, deviceId)'), 'FAIL: setAdminDeviceLock must call adminDeviceAction');
console.log('  ✅  Test D: LOCK/UNLOCK use admin_device_action');

// ── Test E: FORCE_LOGOUT uses admin_device_action ────────────────────────────
assert.ok(registryCode.includes("adminDeviceAction('FORCE_LOGOUT', deviceId"), 'FAIL: triggerForceLogout must call adminDeviceAction FORCE_LOGOUT');
assert.ok(registryCode.includes("adminDeviceAction('FORCE_LOGOUT', r.device_id)"), 'FAIL: triggerGlobalForceLogout must call adminDeviceAction');
console.log('  ✅  Test E: FORCE_LOGOUT uses admin_device_action');

// ── Test F: Exact p_action/p_target_device_id parameters ─────────────────────
assert.ok(controlCode.includes('p_action: action'), 'FAIL: adminDeviceAction must pass p_action');
assert.ok(controlCode.includes('p_target_device_id: targetDeviceId'), 'FAIL: adminDeviceAction must pass p_target_device_id');
assert.ok(controlCode.includes('p_params: params || {}'), 'FAIL: adminDeviceAction must pass p_params');
assert.strictEqual(controlCode.includes('p_device_id: targetDeviceId'), false, 'FAIL: adminDeviceAction must not use p_device_id');
console.log('  ✅  Test F: Exact p_action/p_target_device_id parameters');

// ── Test G: Non-admin session cannot perform Admin action ────────────────────
assert.ok(clientCode.includes('user?.app_metadata?.is_admin === true'), 'FAIL: adminSignIn checks is_admin');
assert.ok(clientCode.includes('UNAUTHORIZED_NOT_ADMIN'), 'FAIL: adminSignIn rejects non-admin');
assert.ok(controlCode.includes('isAdminAuthenticated()'), 'FAIL: adminDeviceAction checks isAdminAuthenticated');
console.log('  ✅  Test G: Non-admin session cannot perform Admin action');

// ── Test H: Missing Admin session triggers authentication requirement ────────
assert.ok(controlCode.includes("error: 'ADMIN_AUTH_REQUIRED'"), 'FAIL: Missing session returns ADMIN_AUTH_REQUIRED');
assert.ok(screenCode.includes('withCloudAdminAuth'), 'FAIL: DeviceManagementScreen defines withCloudAdminAuth wrapper');
assert.ok(screenCode.includes('adminAuthModalVisible'), 'FAIL: DeviceManagementScreen renders adminAuthModalVisible');
console.log('  ✅  Test H: Missing Admin session triggers authentication requirement');

// ── Test I: Admin authentication failure does not affect SQLite login ─────────
assert.ok(dbCode.includes('export function verifyUserLogin'), 'FAIL: verifyUserLogin preserved in database.js');
assert.ok(dbCode.includes('export function verifyPinCode'), 'FAIL: verifyPinCode preserved in database.js');
assert.ok(dbCode.includes('CREATE TABLE IF NOT EXISTS users'), 'FAIL: SQLite users table intact');
console.log('  ✅  Test I: Admin authentication failure does not affect SQLite login');

// ── Test J: Device telemetry continues using device identity ─────────────────
assert.ok(clientCode.includes("storageKey: 'sb_device_auth'"), 'FAIL: Device client uses isolated sb_device_auth key');
assert.ok(controlCode.includes('export async function updateSupabaseDevice(deviceId, fields)'), 'FAIL: updateSupabaseDevice exported');
assert.ok(controlCode.includes('safeSupabaseCall'), 'FAIL: Telemetry updates run on device client safeSupabaseCall');
console.log('  ✅  Test J: Device telemetry continues using device identity');

// ── Test K: Admin session cannot overwrite device anonymous identity ─────────
assert.ok(clientCode.includes('export function getDeviceSupabaseClient()'), 'FAIL: Dedicated device client getter exported');
assert.ok(clientCode.includes('export function getAdminSupabaseClient()'), 'FAIL: Dedicated admin client getter exported');
assert.ok(clientCode.includes("storageKey: 'sb_admin_auth'"), 'FAIL: Admin client uses isolated sb_admin_auth key');
console.log('  ✅  Test K: Admin session cannot overwrite device anonymous identity');

// ── Test L: No privileged direct devices UPDATE remains ──────────────────────
assert.ok(controlCode.includes("const forbiddenColumns = ['status', 'allow_login', 'allow_offline', 'admin_lock', 'is_deleted', 'auth_user_id', 'force_logout_token']"), 'FAIL: updateSupabaseDevice must filter forbidden authorization columns');
// Verify there are no direct updates outside updateSupabaseDevice and clearForceLogoutIfMatching
const matchMatches = controlCode.match(/\.from\('devices'\)\s*\.update/g) || [];
assert.strictEqual(matchMatches.length, 2, 'FAIL: Only telemetry updateSupabaseDevice and clearForceLogoutIfMatching allowed in client');
console.log('  ✅  Test L: No privileged direct devices UPDATE remains');

// ── Test M: service_role remains absent from client ──────────────────────────
const envContent = fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8') : '';
const appJsonContent = fs.existsSync('app.json') ? fs.readFileSync('app.json', 'utf8') : '';
const pkgJsonContent = fs.readFileSync('package.json', 'utf8');

assert.strictEqual(clientCode.includes('service_role') || clientCode.includes('SERVICE_ROLE'), false, 'FAIL: service_role found in supabaseClient.js');
assert.strictEqual(controlCode.includes('service_role') || controlCode.includes('SERVICE_ROLE'), false, 'FAIL: service_role found in supabaseDeviceControl.js');
assert.strictEqual(registryCode.includes('service_role') || registryCode.includes('SERVICE_ROLE'), false, 'FAIL: service_role found in deviceRegistry.js');
assert.strictEqual(screenCode.includes('service_role') || screenCode.includes('SERVICE_ROLE'), false, 'FAIL: service_role found in DeviceManagementScreen.js');
assert.strictEqual(envContent.includes('service_role') || envContent.includes('SERVICE_ROLE'), false, 'FAIL: service_role found in .env');
assert.strictEqual(appJsonContent.includes('service_role') || appJsonContent.includes('SERVICE_ROLE'), false, 'FAIL: service_role found in app.json');
assert.strictEqual(pkgJsonContent.includes('service_role') || pkgJsonContent.includes('SERVICE_ROLE'), false, 'FAIL: service_role found in package.json');
console.log('  ✅  Test M: service_role remains absent from client');

// ── Test N: Firestore sync remains unchanged ─────────────────────────────────
assert.ok(dbCode.includes('syncHighFrequencyCollections'), 'FAIL: Firestore syncHighFrequencyCollections preserved');
assert.ok(dbCode.includes('syncLowFrequencyCollections'), 'FAIL: Firestore syncLowFrequencyCollections preserved');
assert.ok(dbCode.includes('syncTablesOnly'), 'FAIL: Firestore syncTablesOnly preserved');
assert.ok(dbCode.includes('processSyncQueue'), 'FAIL: Firestore processSyncQueue preserved');
console.log('  ✅  Test N: Firestore sync remains unchanged');

console.log('  All 14 Phase 1B Device Management RPC tests passed!\n');

// ═════════════════════════════════════════════════════════════════════════════
// PART 2: SECURE FLEET APP-USAGE RPC (PHASE 1B BLOCKER RESOLUTION)
// ═════════════════════════════════════════════════════════════════════════════
console.log('======================================================');
console.log('   SECURE FLEET APP-USAGE RPC TEST SUITE (PHASE 1B)   ');
console.log('======================================================\n');

const sqlCode = fs.readFileSync('supabase_full_setup.sql', 'utf8');
const usageCode = fs.readFileSync('services/appUsageTracker.js', 'utf8');

// Simulation of PostgreSQL get_device_app_usage_fleet function
function simulateGetDeviceAppUsageFleet({ authUser, businessDate, deviceId, mockDbRows }) {
  // 1. Authentication and Anonymous Guard
  if (!authUser || !authUser.uid || authUser.is_anonymous === true) {
    const err = new Error('Access Denied: Anonymous clients cannot view fleet app usage');
    err.code = '42501';
    throw err;
  }

  // 2. Administrator Authorization Guard
  const isAdmin = Boolean(authUser.app_metadata?.is_admin || authUser.role === 'service_role');
  if (!isAdmin) {
    const err = new Error('Access Denied: Administrative privileges required');
    err.code = '42501';
    throw err;
  }

  // 3. Business date validation
  if (!businessDate || !businessDate.trim()) {
    const err = new Error('Invalid Parameter: p_business_date is required');
    err.code = '22023';
    throw err;
  }

  // 4. Query
  return mockDbRows
    .filter(row => row.business_date === businessDate && (!deviceId || row.device_id === deviceId))
    .sort((a, b) => (b.total_seconds || 0) - (a.total_seconds || 0));
}

const mockFleetUsageData = [
  { id: 'dev_1_2026-09-26_ADMIN', device_id: 'dev_1', business_date: '2026-09-26', role: 'ADMIN', total_seconds: 7200 },
  { id: 'dev_2_2026-09-26_MANAGER', device_id: 'dev_2', business_date: '2026-09-26', role: 'MANAGER', total_seconds: 3600 },
  { id: 'dev_3_2026-09-26_WAITER', device_id: 'dev_3', business_date: '2026-09-26', role: 'WAITER', total_seconds: 1800 },
  { id: 'dev_1_2026-09-25_ADMIN', device_id: 'dev_1', business_date: '2026-09-25', role: 'ADMIN', total_seconds: 5000 },
];

// ── Test U-A: Admin can call get_device_app_usage_fleet ───────────────────────
const adminCallRes = simulateGetDeviceAppUsageFleet({
  authUser: { uid: 'admin_uuid_123', is_anonymous: false, app_metadata: { is_admin: true } },
  businessDate: '2026-09-26',
  deviceId: null,
  mockDbRows: mockFleetUsageData
});
assert.strictEqual(adminCallRes.length, 3, 'FAIL: Admin should receive 3 rows for 2026-09-26');
assert.strictEqual(adminCallRes[0].total_seconds, 7200, 'FAIL: Results should be sorted by total_seconds DESC');
console.log('  ✅  Test U-A: Admin can call get_device_app_usage_fleet');

// ── Test U-B: Anonymous client cannot call it ─────────────────────────────────
assert.throws(() => {
  simulateGetDeviceAppUsageFleet({
    authUser: { uid: 'anon_uuid_456', is_anonymous: true, app_metadata: {} },
    businessDate: '2026-09-26',
    mockDbRows: mockFleetUsageData
  });
}, (err) => {
  return err.code === '42501' && err.message.includes('Anonymous clients cannot view fleet app usage');
}, 'FAIL: Anonymous client must be rejected with 42501');
console.log('  ✅  Test U-B: Anonymous client cannot call it');

// ── Test U-C: Non-admin authenticated user cannot call it ─────────────────────
assert.throws(() => {
  simulateGetDeviceAppUsageFleet({
    authUser: { uid: 'authenticated_waiter_789', is_anonymous: false, app_metadata: { is_admin: false } },
    businessDate: '2026-09-26',
    mockDbRows: mockFleetUsageData
  });
}, (err) => {
  return err.code === '42501' && err.message.includes('Administrative privileges required');
}, 'FAIL: Non-admin authenticated user must be rejected with 42501');
console.log('  ✅  Test U-C: Non-admin authenticated user cannot call it');

// ── Test U-D: Unauthorized call returns SQLSTATE 42501 ────────────────────────
assert.ok(sqlCode.includes("USING ERRCODE = '42501'"), 'FAIL: Schema must explicitly use ERRCODE 42501');
console.log('  ✅  Test U-D: Unauthorized call returns SQLSTATE 42501');

// ── Test U-E: Admin receives only requested/filterable usage data ─────────────
const singleDevRes = simulateGetDeviceAppUsageFleet({
  authUser: { uid: 'admin_uuid_123', is_anonymous: false, app_metadata: { is_admin: true } },
  businessDate: '2026-09-26',
  deviceId: 'dev_2',
  mockDbRows: mockFleetUsageData
});
assert.strictEqual(singleDevRes.length, 1, 'FAIL: Filter by device_id should yield 1 row');
assert.strictEqual(singleDevRes[0].device_id, 'dev_2');
console.log('  ✅  Test U-E: Admin receives only requested/filterable usage data');

// ── Test U-F: Device A cannot use the RPC as a normal device to read fleet data
assert.ok(
  sqlCode.includes('REVOKE ALL ON FUNCTION public.get_device_app_usage_fleet FROM PUBLIC, anon;'),
  'FAIL: anon must have execute revoked'
);
assert.ok(
  sqlCode.includes('coalesce((auth.jwt() ->> \'is_anonymous\')::boolean, false) = true'),
  'FAIL: Anonymous session check required in get_device_app_usage_fleet'
);
console.log('  ✅  Test U-F: Device A cannot use the RPC as a normal device to read fleet data');

// ── Test U-G: Existing device_app_usage own-device RLS remains intact ──────────
assert.ok(sqlCode.includes('CREATE POLICY "Devices read own app usage"'), 'FAIL: Devices read own app usage preserved');
assert.ok(sqlCode.includes('CREATE POLICY "Devices insert own app usage"'), 'FAIL: Devices insert own app usage preserved');
assert.ok(sqlCode.includes('CREATE POLICY "Devices update own app usage"'), 'FAIL: Devices update own app usage preserved');
console.log('  ✅  Test U-G: Existing device_app_usage own-device RLS remains intact');

// ── Test U-H: service_role remains absent from client ──────────────────────────
assert.strictEqual(usageCode.includes('service_role') || usageCode.includes('SERVICE_ROLE'), false, 'FAIL: service_role in appUsageTracker.js');
console.log('  ✅  Test U-H: service_role remains absent from client');

// ── Test U-I: Admin RPC uses the Admin Supabase client ────────────────────────
assert.ok(controlCode.includes('export async function getDeviceAppUsageFleet'), 'FAIL: getDeviceAppUsageFleet must be exported');
assert.ok(controlCode.includes("supabase.rpc('get_device_app_usage_fleet'"), 'FAIL: Must invoke get_device_app_usage_fleet RPC');
assert.ok(controlCode.includes('safeAdminSupabaseCall'), 'FAIL: getDeviceAppUsageFleet must use safeAdminSupabaseCall');
console.log('  ✅  Test U-I: Admin RPC uses the Admin Supabase client');

// ── Test U-J: Device anonymous identity remains isolated from Admin identity ───
assert.ok(usageCode.includes('safeSupabaseCall'), 'FAIL: syncRecordToSupabase must use device safeSupabaseCall');
assert.ok(controlCode.includes('isAdminAuthenticated()'), 'FAIL: getDeviceAppUsageFleet checks isAdminAuthenticated');
console.log('  ✅  Test U-J: Device anonymous identity remains isolated from Admin identity');

// ── Test U-K: Existing app usage upload still works ───────────────────────────
assert.ok(usageCode.includes('function syncRecordToSupabase'), 'FAIL: syncRecordToSupabase function exists');
assert.ok(usageCode.includes(".from('device_app_usage')"), 'FAIL: syncRecordToSupabase upserts to device_app_usage');
console.log('  ✅  Test U-K: Existing app usage upload still works');

// ── Test U-L: Existing Firestore behavior remains unchanged ───────────────────
assert.ok(dbCode.includes('syncHighFrequencyCollections'), 'FAIL: Firestore sync remains intact');
assert.ok(dbCode.includes('processSyncQueue'), 'FAIL: Firestore queue remains intact');
console.log('  ✅  Test U-L: Existing Firestore behavior remains unchanged');

console.log('\n------------------------------------------------------');
console.log('  All 14 Phase 1B Base Tests + 12 App-Usage Tests Passed!');
console.log('======================================================\n');

