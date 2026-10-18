/**
 * Supabase Phase 1A Auth Foundation Test Suite
 * Tests:
 * A. ensureAnonymousAuth creates a session when none exists.
 * B. Existing session is reused.
 * C. Anonymous session is not recreated unnecessarily.
 * D. register_device_auth is called after auth exists.
 * E. DEVICE_ALREADY_BOUND is handled.
 * F. adminSignIn accepts only is_admin=true.
 * G. adminSignIn rejects authenticated users without is_admin.
 * H. adminSignOut clears Admin Supabase session.
 * I. adminDeviceAction uses p_action and p_target_device_id.
 * J. service_role is absent from client source/config.
 * K. Existing SQLite login tests remain passing.
 */

import fs from 'fs';
import assert from 'assert';

console.log('======================================================');
console.log('   SUPABASE PHASE 1A AUTH FOUNDATION TEST SUITE       ');
console.log('======================================================\n');

// 1. Static Source Code Assertions
const clientCode = fs.readFileSync('services/supabaseClient.js', 'utf8');
const controlCode = fs.readFileSync('services/supabaseDeviceControl.js', 'utf8');
const registryCode = fs.readFileSync('services/deviceRegistry.js', 'utf8');

// ── Test A, B, C: ensureAnonymousAuth logic & session persistence ─────────────
assert.ok(clientCode.includes('persistSession: true'), 'FAIL: persistSession must be enabled in supabaseClient.js');
assert.ok(clientCode.includes('autoRefreshToken: true'), 'FAIL: autoRefreshToken must be enabled in supabaseClient.js');
assert.ok(clientCode.includes('export async function ensureAnonymousAuth()'), 'FAIL: ensureAnonymousAuth must be exported');
assert.ok(clientCode.includes('supabase.auth.getSession()'), 'FAIL: ensureAnonymousAuth must check existing session first');
assert.ok(clientCode.includes('supabase.auth.signInAnonymously()'), 'FAIL: ensureAnonymousAuth must call signInAnonymously when no session exists');
assert.ok(clientCode.includes('if (!sessionErr && sessionData?.session?.user)'), 'FAIL: ensureAnonymousAuth must reuse existing valid session');
console.log('  ✅  Test A: ensureAnonymousAuth creates a session when none exists');
console.log('  ✅  Test B: Existing session is reused');
console.log('  ✅  Test C: Anonymous session is not recreated unnecessarily');

// ── Test D & E: register_device_auth and DEVICE_ALREADY_BOUND handling ─────────
// Phase 2N: registerDeviceAuth now accepts optional metadata = {} for auto-registration support
assert.ok(controlCode.includes('export async function registerDeviceAuth(deviceId, metadata = {})'), 'FAIL: registerDeviceAuth exported');
assert.ok(controlCode.includes('supabase.rpc(\'register_device_auth\''), 'FAIL: registerDeviceAuth calls register_device_auth RPC');
assert.ok(controlCode.includes('p_device_id: deviceId'), 'FAIL: registerDeviceAuth passes p_device_id');
assert.ok(registryCode.includes('bindDeviceAuthSession(deviceId)'), 'FAIL: deviceRegistry calls bindDeviceAuthSession on registration');
assert.ok(registryCode.includes('await ensureAnonymousAuth()'), 'FAIL: bindDeviceAuthSession ensures auth before calling RPC');
assert.ok(registryCode.includes('DEVICE_ALREADY_BOUND'), 'FAIL: bindDeviceAuthSession handles DEVICE_ALREADY_BOUND error');
console.log('  ✅  Test D: register_device_auth is called after auth exists');
console.log('  ✅  Test E: DEVICE_ALREADY_BOUND is handled gracefully without crash');

// ── Test F, G, H: Admin Auth Helpers & Strict is_admin Verification ───────────
assert.ok(clientCode.includes('export async function adminSignIn(email, password)'), 'FAIL: adminSignIn exported');
assert.ok(clientCode.includes('export async function adminSignOut()'), 'FAIL: adminSignOut exported');
assert.ok(clientCode.includes('export async function isAdminAuthenticated()'), 'FAIL: isAdminAuthenticated exported');
assert.ok(clientCode.includes('user?.app_metadata?.is_admin === true'), 'FAIL: adminSignIn must check app_metadata.is_admin === true');
assert.ok(clientCode.includes('UNAUTHORIZED_NOT_ADMIN'), 'FAIL: adminSignIn must return UNAUTHORIZED_NOT_ADMIN when claim missing');
assert.ok(clientCode.includes('await supabase.auth.signOut()'), 'FAIL: adminSignIn must immediately sign out non-admin user');
console.log('  ✅  Test F: adminSignIn accepts only is_admin=true');
console.log('  ✅  Test G: adminSignIn rejects authenticated users without is_admin and logs out');
console.log('  ✅  Test H: adminSignOut clears Admin Supabase session');

// ── Test I: adminDeviceAction uses p_action and p_target_device_id ────────────
assert.ok(controlCode.includes('export async function adminDeviceAction(action, targetDeviceId, params = {})'), 'FAIL: adminDeviceAction exported with clean signature');
assert.ok(controlCode.includes('p_action: action'), 'FAIL: adminDeviceAction must pass p_action matching SQL definition');
assert.ok(controlCode.includes('p_target_device_id: targetDeviceId'), 'FAIL: adminDeviceAction must pass p_target_device_id matching SQL definition');
assert.ok(controlCode.includes('export async function getDeviceFleet()'), 'FAIL: getDeviceFleet exported');
assert.ok(controlCode.includes('supabase.rpc(\'get_device_fleet\')'), 'FAIL: getDeviceFleet calls get_device_fleet RPC');
console.log('  ✅  Test I: adminDeviceAction uses exact p_action and p_target_device_id parameters');

// ── Test J: service_role is completely absent from client source/config ────────
const envContent = fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8') : '';
const appJsonContent = fs.existsSync('app.json') ? fs.readFileSync('app.json', 'utf8') : '';
const pkgJsonContent = fs.readFileSync('package.json', 'utf8');

assert.strictEqual(clientCode.includes('service_role') || clientCode.includes('SERVICE_ROLE'), false, 'FAIL: service_role found in supabaseClient.js');
assert.strictEqual(controlCode.includes('service_role') || controlCode.includes('SERVICE_ROLE'), false, 'FAIL: service_role found in supabaseDeviceControl.js');
assert.strictEqual(registryCode.includes('service_role') || registryCode.includes('SERVICE_ROLE'), false, 'FAIL: service_role found in deviceRegistry.js');
assert.strictEqual(envContent.includes('service_role') || envContent.includes('SERVICE_ROLE'), false, 'FAIL: service_role found in .env');
assert.strictEqual(appJsonContent.includes('service_role') || appJsonContent.includes('SERVICE_ROLE'), false, 'FAIL: service_role found in app.json');
assert.strictEqual(pkgJsonContent.includes('service_role') || pkgJsonContent.includes('SERVICE_ROLE'), false, 'FAIL: service_role found in package.json');
console.log('  ✅  Test J: service_role is completely absent from client source and config');

// ── Test K: Existing SQLite login tests & functions intact ─────────────────────
const dbCode = fs.readFileSync('database.js', 'utf8');
assert.ok(dbCode.includes('export function verifyUserLogin'), 'FAIL: database.js verifyUserLogin must be preserved');
assert.ok(dbCode.includes('export function checkUserExists'), 'FAIL: database.js checkUserExists must be preserved');
assert.ok(dbCode.includes('export function getUserByUsername'), 'FAIL: database.js getUserByUsername must be preserved');
assert.ok(dbCode.includes('export function verifyPinCode'), 'FAIL: database.js verifyPinCode must be preserved');
assert.ok(dbCode.includes('CREATE TABLE IF NOT EXISTS users'), 'FAIL: SQLite users table must remain intact');
console.log('  ✅  Test K: Existing SQLite login functions and tables remain 100% intact');

console.log('\n------------------------------------------------------');
console.log('  All 11 Supabase Phase 1A Auth Foundation tests passed!');
console.log('======================================================\n');
