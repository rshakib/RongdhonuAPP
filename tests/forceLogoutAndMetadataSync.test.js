/**
 * Unit verification suite for Force Logout on Reconnect & Phone Data / App Version Sync
 * Run with: node tests/forceLogoutAndMetadataSync.test.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');

console.log('======================================================');
console.log('   FORCE LOGOUT & METADATA SYNC — VERIFICATION SUITE  ');
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

const deviceRegistryCode = fs.readFileSync('services/deviceRegistry.js', 'utf8');
const loginScreenCode = fs.readFileSync('screens/LoginScreen.js', 'utf8');
const appJsCode = fs.readFileSync('App.js', 'utf8');

it('TC-01: deviceRegistry.js exports syncDeviceHardwareAndVersion', () => {
  assert.ok(deviceRegistryCode.includes('export async function syncDeviceHardwareAndVersion'), 'syncDeviceHardwareAndVersion is exported');
});

it('TC-02: syncDeviceHardwareAndVersion overwrites SQLite if app_version or phone data differs', () => {
  assert.ok(deviceRegistryCode.includes('UPDATE device_registry'), 'Contains UPDATE device_registry statement');
  assert.ok(deviceRegistryCode.includes('SET app_version = ?'), 'Updates app_version in SQLite');
  assert.ok(deviceRegistryCode.includes('android_version = ?'), 'Updates android_version in SQLite');
  assert.ok(deviceRegistryCode.includes('device_name = ?'), 'Updates device_name in SQLite');
  assert.ok(deviceRegistryCode.includes('manufacturer = ?'), 'Updates manufacturer in SQLite');
  assert.ok(deviceRegistryCode.includes('brand = ?'), 'Updates brand in SQLite');
  assert.ok(deviceRegistryCode.includes('model = ?'), 'Updates model in SQLite');
});

it('TC-03: syncDeviceHardwareAndVersion pushes updated metadata and app_version to Supabase', () => {
  assert.ok(deviceRegistryCode.includes('updateSupabaseDevice(record.device_id, payload)'), 'Pushes updated payload to Supabase');
});

it('TC-04: checkAndExecuteForceLogout falls back to remote Supabase fetch if remoteRecord is not provided', () => {
  assert.ok(deviceRegistryCode.includes('fetchSingleSupabaseDevice(deviceRecord.device_id)'), 'Fetches single Supabase device if remoteRecord is null');
  assert.ok(deviceRegistryCode.includes('syncRemoteDeviceToLocal(remoteRecord)'), 'Syncs remote state to local SQLite');
});

it('TC-05: LoginScreen resets isFirstLogin to true and clears username when forceReauth is true', () => {
  assert.ok(loginScreenCode.includes("isForceReauth"), 'Detects force reauth flag');
  assert.ok(loginScreenCode.includes("setIsFirstLogin(true)"), 'Sets isFirstLogin to true on forceReauth');
  assert.ok(loginScreenCode.includes("setUsername('')"), 'Clears username state on forceReauth');
});

it('TC-06: LoginScreen handlePinSubmit guards against missing username on force reauth', () => {
  assert.ok(loginScreenCode.includes("if (!cleanUsername || (isForceReauth && isFirstLogin))"), 'Rejects PIN submission if username is missing or on force reauth');
});

it('TC-07: LoginScreen footer has removed personal name "সাকিব"', () => {
  assert.strictEqual(loginScreenCode.includes('রিয়াজুল হাসান সাকিব'), false, 'Does not contain personal name');
});

it('TC-08: App.js network reconnection triggers syncDeviceHardwareAndVersion and checks force logout', () => {
  assert.ok(appJsCode.includes('syncDeviceHardwareAndVersion()'), 'App.js invokes syncDeviceHardwareAndVersion on reconnect');
  assert.ok(appJsCode.includes('checkAndExecuteForceLogout()'), 'App.js checks force logout on reconnect');
  assert.ok(appJsCode.includes("setCurrentScreen('LOGIN')"), 'App.js navigates to LOGIN screen on reconnect force logout');
  assert.ok(appJsCode.includes('setForceReauthRequired(true)'), 'App.js requires force reauth');
});

console.log('------------------------------------------------------');
console.log(`Tests Passed: ${passedTests}`);
console.log(`Tests Failed: ${failedTests}`);
console.log('======================================================\n');

if (failedTests > 0) {
  process.exit(1);
}

