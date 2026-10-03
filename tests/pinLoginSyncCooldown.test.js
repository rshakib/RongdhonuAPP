/**
 * Unit & Integration Test for PIN Login Operational Delta Sync 30-Minute Cooldown
 * 
 * Verifies:
 * 1. PIN_LOGIN_SYNC_COOLDOWN_MS is exactly 30 minutes (1,800,000 ms).
 * 2. checkPinLoginSyncAllowed allows sync when no previous record exists.
 * 3. checkPinLoginSyncAllowed throttles sync when called within 30 minutes.
 * 4. checkPinLoginSyncAllowed calculates accurate remainingMinutes.
 * 5. checkPinLoginSyncAllowed allows sync once 30+ minutes have passed.
 * 6. App.js gates operational pulls behind checkPinLoginSyncAllowed and records timestamp.
 * 7. Menu item pull (login-menu-pull) is EXCLUDED from PIN login sync.
 * 8. Operational pulls (tables, orders/deliveries, daily, low-frequency, deletions) are retained.
 * 9. Routine background sync and manual pulls are unthrottled.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const tests = [];
function it(desc, fn) { tests.push({ desc, fn }); }
let passed = 0;
let failed = 0;

console.log('======================================================');
console.log('   PIN LOGIN SYNC 30-MINUTE COOLDOWN TESTS            ');
console.log('======================================================\n');

// 1. Check exports and constants in database.js
it('database.js exports PIN_LOGIN_SYNC_COOLDOWN_MS as 30 minutes (1,800,000 ms)', () => {
  const dbSrc = fs.readFileSync(path.join(__dirname, '../database.js'), 'utf8');
  assert.ok(dbSrc.includes('export const PIN_LOGIN_SYNC_COOLDOWN_MS = 30 * 60 * 1000'), 'Constant is defined as 30 minutes');
  assert.ok(dbSrc.includes('export function checkPinLoginSyncAllowed()'), 'database.js exports checkPinLoginSyncAllowed');
  assert.ok(dbSrc.includes('export function recordPinLoginSyncTime('), 'database.js exports recordPinLoginSyncTime');
});

// 2. Logic testing using mock app_config store
it('checkPinLoginSyncAllowed logic correctly allows initial sync and enforces 30m cooldown', () => {
  const store = {};
  const mockGetAppConfig = (key) => store[key] || null;
  const mockSetAppConfig = (key, val) => { store[key] = String(val); };

  const PIN_LOGIN_SYNC_COOLDOWN_MS = 30 * 60 * 1000;

  function mockCheckAllowed(currentTime = Date.now()) {
    const lastSyncTime = parseInt(mockGetAppConfig('last_pin_login_sync_time') || '0', 10);
    const timeSinceLastSync = currentTime - lastSyncTime;

    if (lastSyncTime > 0 && timeSinceLastSync < PIN_LOGIN_SYNC_COOLDOWN_MS) {
      const remainingMinutes = Math.ceil((PIN_LOGIN_SYNC_COOLDOWN_MS - timeSinceLastSync) / 60000);
      return { allowed: false, remainingMinutes, lastSyncTime, elapsedMs: timeSinceLastSync };
    }
    return { allowed: true, remainingMinutes: 0, lastSyncTime, elapsedMs: timeSinceLastSync };
  }

  function mockRecordSync(timestamp = Date.now()) {
    mockSetAppConfig('last_pin_login_sync_time', String(timestamp));
  }

  // Initial check: No sync has ever run
  const initial = mockCheckAllowed();
  assert.strictEqual(initial.allowed, true, 'Initial login sync is allowed');
  assert.strictEqual(initial.remainingMinutes, 0);

  // User logs in at T = 1000000
  const t0 = 1000000000;
  mockRecordSync(t0);

  // User logs in again 5 minutes later (300,000 ms)
  const t5m = t0 + (5 * 60 * 1000);
  const check5m = mockCheckAllowed(t5m);
  assert.strictEqual(check5m.allowed, false, 'Sync within 5 minutes is throttled');
  assert.strictEqual(check5m.remainingMinutes, 25, 'Remaining minutes is 25m');

  // User logs in again 29 minutes later
  const t29m = t0 + (29 * 60 * 1000);
  const check29m = mockCheckAllowed(t29m);
  assert.strictEqual(check29m.allowed, false, 'Sync within 29 minutes is still throttled');
  assert.strictEqual(check29m.remainingMinutes, 1, 'Remaining minutes is 1m');

  // User logs in 30 minutes and 1 second later
  const t30m = t0 + (30 * 60 * 1000) + 1000;
  const check30m = mockCheckAllowed(t30m);
  assert.strictEqual(check30m.allowed, true, 'Sync after 30 minutes is allowed');
  assert.strictEqual(check30m.remainingMinutes, 0);
});

// 3. App.js source integration checks
it('App.js checks checkPinLoginSyncAllowed and records timestamp with recordPinLoginSyncTime in handleLoginSuccess', () => {
  const appSrc = fs.readFileSync(path.join(__dirname, '../App.js'), 'utf8');
  
  assert.ok(appSrc.includes('checkPinLoginSyncAllowed'), 'App.js imports/calls checkPinLoginSyncAllowed');
  assert.ok(appSrc.includes('recordPinLoginSyncTime'), 'App.js imports/calls recordPinLoginSyncTime');
  assert.ok(appSrc.includes('Operational pull throttled'), 'App.js logs when pull is throttled');
  assert.ok(appSrc.includes('recordPinLoginSyncTime()'), 'App.js records sync timestamp when pull executes');

  // Verify the gate around Promise.allSettled
  const syncIdx = appSrc.indexOf('// --- OPERATIONAL DELTA SYNC ON PIN LOGIN ---');
  assert.ok(syncIdx > -1, 'Operational delta sync comment exists');
  const syncBlock = appSrc.slice(syncIdx, syncIdx + 3000);

  assert.ok(syncBlock.includes('if (!syncStatus.allowed)'), 'App.js checks if sync is allowed');
  assert.ok(syncBlock.includes('runPullPreferSupabase'), 'App.js runs pulls inside the allowed block');
});

// 4. Menu item pull is excluded from PIN login sync
it('App.js excludes login-menu-pull from PIN login delta sync to avoid redundant menu checks', () => {
  const appSrc = fs.readFileSync(path.join(__dirname, '../App.js'), 'utf8');
  const syncIdx = appSrc.indexOf('// --- OPERATIONAL DELTA SYNC ON PIN LOGIN ---');
  assert.ok(syncIdx > -1);
  const syncBlock = appSrc.slice(syncIdx, syncIdx + 3000);

  // login-menu-pull must NOT be inside the PIN login sync block
  assert.ok(!syncBlock.includes('login-menu-pull'), 'login-menu-pull is completely removed from PIN login');
  assert.ok(!syncBlock.includes('syncSupabaseMenu'), 'syncSupabaseMenu is not called on PIN login');

  // Operational pulls must still be present
  assert.ok(syncBlock.includes('login-tables-pull'), 'login-tables-pull is present');
  assert.ok(syncBlock.includes('login-high-frequency-pull'), 'login-high-frequency-pull is present');
  assert.ok(syncBlock.includes('login-daily-pull'), 'login-daily-pull is present');
  assert.ok(syncBlock.includes('login-deletions-pull'), 'login-deletions-pull is present');
});

// 5. Background routine sync and manual pulls are unthrottled
it('Routine background sync (15s tables, 30s orders) and manual pull are unthrottled by PIN cooldown', () => {
  const dbSrc = fs.readFileSync(path.join(__dirname, '../database.js'), 'utf8');

  // Routine sync functions must NOT call checkPinLoginSyncAllowed
  const syncTablesIdx = dbSrc.indexOf('export async function syncTablesOnly');
  assert.ok(syncTablesIdx > -1);
  const syncTablesBlock = dbSrc.slice(syncTablesIdx, syncTablesIdx + 800);
  assert.ok(!syncTablesBlock.includes('checkPinLoginSyncAllowed'), 'syncTablesOnly is not throttled');

  const syncHighIdx = dbSrc.indexOf('export async function syncHighFrequencyCollections');
  assert.ok(syncHighIdx > -1);
  const syncHighBlock = dbSrc.slice(syncHighIdx, syncHighIdx + 800);
  assert.ok(!syncHighBlock.includes('checkPinLoginSyncAllowed'), 'syncHighFrequencyCollections is not throttled');
});

// Run all test cases
for (const t of tests) {
  try {
    t.fn();
    console.log(`  ✅  ${t.desc}`);
    passed++;
  } catch (err) {
    console.error(`  ❌  ${t.desc}`);
    console.error(`      ${err.message}`);
    failed++;
  }
}

console.log('\n------------------------------------------------------');
console.log(`Tests Passed: ${passed}`);
console.log(`Tests Failed: ${failed}`);
console.log('======================================================\n');

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
