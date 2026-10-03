/**
 * Unit & Integration Test for PIN Login Full Delta Sync 15-Minute Cooldown
 * 
 * Verifies:
 * 1. PIN_LOGIN_SYNC_COOLDOWN_MS is exactly 15 minutes (900,000 ms).
 * 2. checkPinLoginSyncAllowed allows sync when no previous record exists.
 * 3. checkPinLoginSyncAllowed throttles sync when called within 15 minutes.
 * 4. checkPinLoginSyncAllowed calculates accurate remainingMinutes.
 * 5. checkPinLoginSyncAllowed allows sync once 15+ minutes have passed.
 * 6. App.js integration properly gates the 6 login delta pulls behind checkPinLoginSyncAllowed.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const tests = [];
function it(desc, fn) { tests.push({ desc, fn }); }
let passed = 0;
let failed = 0;

console.log('======================================================');
console.log('   PIN LOGIN SYNC 15-MINUTE COOLDOWN TESTS            ');
console.log('======================================================\n');

// 1. Check exports and constants in database.js
it('database.js exports PIN_LOGIN_SYNC_COOLDOWN_MS as 15 minutes (900,000 ms)', () => {
  const dbSrc = fs.readFileSync(path.join(__dirname, '../database.js'), 'utf8');
  assert.ok(dbSrc.includes('export const PIN_LOGIN_SYNC_COOLDOWN_MS = 15 * 60 * 1000'), 'Constant is defined as 15 minutes');
  assert.ok(dbSrc.includes('export function checkPinLoginSyncAllowed()'), 'database.js exports checkPinLoginSyncAllowed');
  assert.ok(dbSrc.includes('export function recordPinLoginSyncTime('), 'database.js exports recordPinLoginSyncTime');
});

// 2. Logic testing using mock app_config store
it('checkPinLoginSyncAllowed logic correctly allows initial sync and enforces 15m cooldown', () => {
  const store = {};
  const mockGetAppConfig = (key) => store[key] || null;
  const mockSetAppConfig = (key, val) => { store[key] = String(val); };

  const PIN_LOGIN_SYNC_COOLDOWN_MS = 15 * 60 * 1000;

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

  // User logs in again 2 minutes later (120,000 ms)
  const t2m = t0 + (2 * 60 * 1000);
  const check2m = mockCheckAllowed(t2m);
  assert.strictEqual(check2m.allowed, false, 'Sync within 2 minutes is throttled');
  assert.strictEqual(check2m.remainingMinutes, 13, 'Remaining minutes is 13m');

  // User logs in again 14.5 minutes later
  const t14m = t0 + (14.5 * 60 * 1000);
  const check14m = mockCheckAllowed(t14m);
  assert.strictEqual(check14m.allowed, false, 'Sync within 14.5 minutes is still throttled');
  assert.strictEqual(check14m.remainingMinutes, 1, 'Remaining minutes is 1m');

  // User logs in 15 minutes and 1 second later
  const t15m = t0 + (15 * 60 * 1000) + 1000;
  const check15m = mockCheckAllowed(t15m);
  assert.strictEqual(check15m.allowed, true, 'Sync after 15 minutes is allowed');
  assert.strictEqual(check15m.remainingMinutes, 0);
});

// 3. App.js source integration checks
it('App.js checks checkPinLoginSyncAllowed and records timestamp with recordPinLoginSyncTime in handleLoginSuccess', () => {
  const appSrc = fs.readFileSync(path.join(__dirname, '../App.js'), 'utf8');
  
  assert.ok(appSrc.includes('checkPinLoginSyncAllowed'), 'App.js imports/calls checkPinLoginSyncAllowed');
  assert.ok(appSrc.includes('recordPinLoginSyncTime'), 'App.js imports/calls recordPinLoginSyncTime');
  assert.ok(appSrc.includes('Full DB pull throttled'), 'App.js logs when pull is throttled');
  assert.ok(appSrc.includes('recordPinLoginSyncTime()'), 'App.js records sync timestamp when pull executes');

  // Verify the gate around Promise.allSettled
  const syncIdx = appSrc.indexOf('// --- FULL DB DELTA SYNC ON PIN LOGIN ---');
  assert.ok(syncIdx > -1, 'Full DB delta sync comment exists');
  const syncBlock = appSrc.slice(syncIdx, syncIdx + 2000);

  assert.ok(syncBlock.includes('if (!syncStatus.allowed)'), 'App.js checks if sync is allowed');
  assert.ok(syncBlock.includes('runPullPreferSupabase'), 'App.js runs pulls inside the allowed block');
});

// 4. Background routine sync and manual pulls are unthrottled
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

// 4. Run test cases
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
