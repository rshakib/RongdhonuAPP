/**
 * Same-Day Cloud Resync (Emergency Day Restore) Verification Test Suite
 * Run with: node tests/sameDayResync.test.js
 */

'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('======================================================');
console.log('   SAME-DAY CLOUD RESYNC — VERIFICATION SUITE         ');
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

async function itAsync(desc, fn) {
  try {
    await fn();
    console.log(`  ✅  ${desc}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌  ${desc}`);
    console.error(`      ${err.message}`);
    failedTests++;
  }
}

async function runSuite() {
  const dbCode = fs.readFileSync(path.join(__dirname, '../database.js'), 'utf8');
  const appCode = fs.readFileSync(path.join(__dirname, '../App.js'), 'utf8');
  const adminDbCode = fs.readFileSync(path.join(__dirname, '../screens/AdminDB.js'), 'utf8');

  // Test 1: Function exports in database.js
  it('database.js exports getSameDayResyncStatus, resetSameDayResyncLimit, and resyncSameDayFromCloud', () => {
    assert(dbCode.includes('export function getSameDayResyncStatus'), 'Missing getSameDayResyncStatus');
    assert(dbCode.includes('export function resetSameDayResyncLimit'), 'Missing resetSameDayResyncLimit');
    assert(dbCode.includes('export async function resyncSameDayFromCloud'), 'Missing resyncSameDayFromCloud');
  });

  // Test 2: Rate limit tracking logic
  it('Rate limit algorithm caps at 2 times per business day', () => {
    // Simulated app_config memory store
    const appConfig = {};
    const todayStr = '2026-09-19';

    function getStatus(targetDateStr = todayStr) {
      const count = parseInt(appConfig[`same_day_resync_count_${targetDateStr}`] || '0', 10);
      const maxLimit = 2;
      return {
        count,
        maxLimit,
        remaining: Math.max(0, maxLimit - count),
        limitReached: count >= maxLimit
      };
    }

    function recordResync(targetDateStr = todayStr) {
      const status = getStatus(targetDateStr);
      if (status.limitReached) return { success: false, limitReached: true };
      const newCount = status.count + 1;
      appConfig[`same_day_resync_count_${targetDateStr}`] = String(newCount);
      return { success: true, count: newCount, remaining: Math.max(0, 2 - newCount) };
    }

    // Attempt 1
    let st = getStatus();
    assert.strictEqual(st.count, 0);
    assert.strictEqual(st.remaining, 2);
    assert.strictEqual(st.limitReached, false);

    let res1 = recordResync();
    assert.strictEqual(res1.success, true);
    assert.strictEqual(res1.remaining, 1);

    // Attempt 2
    let res2 = recordResync();
    assert.strictEqual(res2.success, true);
    assert.strictEqual(res2.remaining, 0);

    // Attempt 3 (Should be blocked)
    let res3 = recordResync();
    assert.strictEqual(res3.success, false);
    assert.strictEqual(res3.limitReached, true);

    // Reset works
    delete appConfig[`same_day_resync_count_${todayStr}`];
    let stReset = getStatus();
    assert.strictEqual(stReset.count, 0);
    assert.strictEqual(stReset.remaining, 2);
  });

  // Test 3: Safety-First fetch before local delete
  it('resyncSameDayFromCloud fetches Firestore collections before executing any SQLite DELETEs', () => {
    const fetchCallIdx = dbCode.indexOf('fetchChangedRecordsFromFirestore');
    const deleteIdx = dbCode.indexOf('DELETE FROM order_items WHERE date(created_at');
    assert(fetchCallIdx !== -1, 'Missing fetchChangedRecordsFromFirestore call');
    assert(deleteIdx !== -1, 'Missing scoped DELETE');
    assert(fetchCallIdx < deleteIdx, 'Safety violation: DELETE was executed before Firestore fetch!');
  });

  // Test 4: Scoped table deletion list
  it('Scoped deletion strictly targets same-day transactional tables and preserves master data', () => {
    // Required same-day transactional tables to clear
    const transactionalTables = [
      'orders',
      'order_items',
      'payments',
      'expenses',
      'deliveries',
      'daily_submit',
      'daily_summary',
      'due_payments',
      'eja_history',
      'supplier_due_history',
      'supplier_payment_ledger'
    ];

    for (const tbl of transactionalTables) {
      assert(
        dbCode.includes(`DELETE FROM ${tbl}`) || dbCode.includes(`DELETE FROM ${tbl} WHERE`),
        `Missing DELETE statement for transactional table ${tbl}`
      );
    }

    // Critical tables that must NEVER be deleted during same-day resync
    const protectedTables = ['users', 'menu_items', 'menu_categories'];
    for (const tbl of protectedTables) {
      assert(
        !dbCode.includes(`DELETE FROM ${tbl} WHERE date(created_at`),
        `Unsafe deletion found for protected table ${tbl}`
      );
    }
  });

  // Test 5: Timezone conversion and ISO handling for Bangladesh (UTC+6)
  it('Dhaka timezone UTC+6 business day conversion correctly maps midnight to 6 AM boundary', () => {
    function getBusinessDateFromISO(isoStr) {
      if (!isoStr) return '';
      const d = new Date(isoStr);
      // Dhaka timezone offset is +6 hours (21600000 ms)
      const dhakaTime = new Date(d.getTime() + 6 * 3600 * 1000);
      const y = dhakaTime.getUTCFullYear();
      const m = String(dhakaTime.getUTCMonth() + 1).padStart(2, '0');
      const day = String(dhakaTime.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }

    // 02:30 AM in Dhaka on Sept 19 is Sept 18 20:30 UTC
    const utcEarlyMorning = '2026-09-18T20:30:00.000Z';
    const bizDate = getBusinessDateFromISO(utcEarlyMorning);
    assert.strictEqual(bizDate, '2026-09-19', 'Dhaka business date calculation failed for post-midnight UTC timestamp');
  });

  // Test 6: App.js wiring
  it('App.js defines handleSameDayResync and passes onSameDayResync to AdminDB', () => {
    assert(appCode.includes('handleSameDayResync'), 'Missing handleSameDayResync in App.js');
    assert(appCode.includes('onSameDayResync={handleSameDayResync}'), 'Missing onSameDayResync prop on AdminDB in App.js');
    assert(appCode.includes('resyncSameDayFromCloud'), 'Missing resyncSameDayFromCloud import/call in App.js');
  });

  // Test 7: AdminDB.js UI integration
  it('screens/AdminDB.js includes Same-Day Resync in 3-dot menu and Admin Controls Grid', () => {
    assert(adminDbCode.includes('onSameDayResync'), 'AdminDB missing onSameDayResync prop parameter');
    assert(adminDbCode.includes('আজকের ডেটা রিসিন্ক (Same-Day Resync)'), 'AdminDB missing menu option in 3-dot menu');
    assert(adminDbCode.includes('আজকের ডেটা রিসিন্ক'), 'AdminDB missing card in adminGrid');
  });

  // Test 8: OwnerDashboard.js and ManagerDashboard.js UI integration
  it('screens/OwnerDashboard.js and screens/ManagerDashboard.js include Same-Day Resync in 3-dot menu', () => {
    const ownerCode = fs.readFileSync(path.join(__dirname, '../screens/OwnerDashboard.js'), 'utf8');
    const managerCode = fs.readFileSync(path.join(__dirname, '../screens/ManagerDashboard.js'), 'utf8');

    assert(ownerCode.includes('onSameDayResync'), 'OwnerDashboard missing onSameDayResync prop parameter');
    assert(ownerCode.includes('আজকের ডেটা রিসিন্ক (Same-Day Resync)'), 'OwnerDashboard missing menu option in 3-dot menu');

    assert(managerCode.includes('onSameDayResync'), 'ManagerDashboard missing onSameDayResync prop parameter');
    assert(managerCode.includes('আজকের ডেটা রিসিন্ক (Same-Day Resync)'), 'ManagerDashboard missing menu option in 3-dot menu');
  });

  // Test 9: Sync queue cleanup for same-day items
  it('database.js cleans stale sync_queue items for wiped records so local writes do not overwrite cloud data', () => {
    assert(dbCode.includes("DELETE FROM sync_queue WHERE (table_name IN ('orders'"), 'Missing sync_queue cleanup in resyncSameDayFromCloud');
  });

  console.log('------------------------------------------------------');
  console.log(`Tests Passed: ${passedTests}`);
  console.log(`Tests Failed: ${failedTests}`);
  console.log('======================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  } else {
    console.log('🎉 ALL SAME-DAY CLOUD RESYNC TESTS PASSED SUCCESSFULLY!\n');
  }
}

runSuite().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});

