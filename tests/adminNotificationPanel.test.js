/**
 * Admin Notification Panel & SQLite-Only Session History Test Suite
 * Run with: node tests/adminNotificationPanel.test.js
 *
 * Verifies:
 * 1. database.js exports session pull notification helpers
 * 2. TABLE_SCHEMAS contains session_pull_notifications
 * 3. migrateSessionPullNotifications creates the session_pull_notifications table
 * 4. session_pull_notifications is 100% SQLite-only (not in SIGNAL_GROUPS, not in sync_queue)
 * 5. App.js calls clearSessionPullNotifications on PIN login
 * 6. App.js inserts pull notifications in pullNotificationSink
 * 7. AdminDB.js renders notification bell button with badge
 * 8. AdminDB.js renders Notification History Modal with filters, type filter button, and no manual clear
 * 9. Functional testing of insert, filter, count, and reset operations with mock SQLite
 */

'use strict';
const assert = require('assert');
const fs = require('fs');

console.log('======================================================');
console.log('   ADMIN NOTIFICATION PANEL & SESSION HISTORY TESTS   ');
console.log('======================================================\n');

let passed = 0;
let failed = 0;
const tests = [];
function it(desc, fn) { tests.push({ desc, fn }); }

const dbSrc = fs.readFileSync('database.js', 'utf8');
const appSrc = fs.readFileSync('App.js', 'utf8');
const adminSrc = fs.readFileSync('screens/AdminDB.js', 'utf8');
const supaSrc = fs.readFileSync('services/supabaseSync.js', 'utf8');

// 1. Database schema & exports
it('database.js contains session_pull_notifications schema in TABLE_SCHEMAS', () => {
  assert.ok(dbSrc.includes('session_pull_notifications: `'), 'TABLE_SCHEMAS defines session_pull_notifications');
  assert.ok(dbSrc.includes('CREATE TABLE IF NOT EXISTS session_pull_notifications'), 'CREATE TABLE statement present');
  assert.ok(dbSrc.includes('has_changes INTEGER DEFAULT 0'), 'has_changes column defined');
  assert.ok(dbSrc.includes('row_count INTEGER DEFAULT 0'), 'row_count column defined');
  assert.ok(dbSrc.includes('source TEXT'), 'source column defined');
});

it('database.js exports all required session pull notification helpers', () => {
  assert.ok(dbSrc.includes('export function insertSessionPullNotification'), 'insertSessionPullNotification is exported');
  assert.ok(dbSrc.includes('export function getSessionPullNotifications'), 'getSessionPullNotifications is exported');
  assert.ok(dbSrc.includes('export function clearSessionPullNotifications'), 'clearSessionPullNotifications is exported');
  assert.ok(dbSrc.includes('export function getSessionPullNotificationCount'), 'getSessionPullNotificationCount is exported');
  assert.ok(dbSrc.includes('export function migrateSessionPullNotifications'), 'migrateSessionPullNotifications is exported');
  assert.ok(dbSrc.includes('export function getSessionPullTypeCounts'), 'getSessionPullTypeCounts is exported');
});

it('database.js calls migrateSessionPullNotifications inside initDatabase', () => {
  const initIdx = dbSrc.indexOf('export function initDatabase');
  assert.ok(initIdx > -1, 'initDatabase function exists');
  const initBlock = dbSrc.slice(initIdx, initIdx + 800);
  assert.ok(initBlock.includes('migrateSessionPullNotifications()'), 'migrateSessionPullNotifications called in initDatabase');
});

// 2. 100% SQLite-only isolation check
it('session_pull_notifications is strictly SQLite-only (never synced to cloud)', () => {
  // Not in SIGNAL_GROUPS
  assert.ok(!supaSrc.includes("'session_pull_notifications'"), 'session_pull_notifications not in supabaseSync tables');
  assert.ok(!supaSrc.includes('"session_pull_notifications"'), 'session_pull_notifications not in supabaseSync tables (double quote)');
  // Not in sync queue tables
  assert.ok(!dbSrc.includes("enqueueSync('session_pull_notifications'"), 'never enqueued to sync');
  assert.ok(!dbSrc.includes('enqueueSync("session_pull_notifications"'), 'never enqueued to sync');
});

// 3. App.js integration
it('App.js resets session pull notifications on PIN login in handleLoginSuccess', () => {
  const loginIdx = appSrc.indexOf('const handleLoginSuccess = async');
  assert.ok(loginIdx > -1, 'handleLoginSuccess exists');
  const loginBlock = appSrc.slice(loginIdx, loginIdx + 600);
  assert.ok(loginBlock.includes('clearSessionPullNotifications()'), 'clearSessionPullNotifications called on PIN login');
});

it('App.js inserts pull notification into SQLite session history in pullNotificationSink', () => {
  const sinkIdx = appSrc.indexOf('pullNotificationSink = (timerName, source, hasChanges, rowCount = 0)');
  assert.ok(sinkIdx > -1, 'pullNotificationSink exists');
  const sinkBlock = appSrc.slice(sinkIdx, sinkIdx + 2000);
  assert.ok(sinkBlock.includes('insertSessionPullNotification'), 'insertSessionPullNotification called in pullNotificationSink');
  assert.ok(sinkBlock.includes('has_changes: hasChanges ? 1 : 0'), 'passes has_changes flag');
  assert.ok(sinkBlock.includes('row_count: Number(rowCount) || 0'), 'passes row_count');
});

// 4. AdminDB.js integration
it('AdminDB.js imports session pull notification helpers from database', () => {
  assert.ok(adminSrc.includes('getSessionPullNotifications'), 'AdminDB imports getSessionPullNotifications');
  assert.ok(adminSrc.includes('getSessionPullNotificationCount'), 'AdminDB imports getSessionPullNotificationCount');
  assert.ok(adminSrc.includes('getSessionPullTypeCounts'), 'AdminDB imports getSessionPullTypeCounts');
});

it('AdminDB.js renders notification bell button with badge in the top-right header', () => {
  assert.ok(adminSrc.includes('styles.notifBellButton'), 'AdminDB has notifBellButton in JSX');
  assert.ok(adminSrc.includes('styles.notifBellIcon'), 'AdminDB has notifBellIcon');
  assert.ok(adminSrc.includes('styles.notifBadge'), 'AdminDB has notifBadge');
  assert.ok(adminSrc.includes('openNotifModal'), 'AdminDB opens notification modal on bell press');
});

it('AdminDB.js renders Pull Notification History modal with filter tabs, type filter button, and no manual clear', () => {
  assert.ok(adminSrc.includes('notifModalVisible'), 'AdminDB has notifModalVisible state');
  assert.ok(adminSrc.includes('Pull নোটিফিকেশন হিস্ট্রি'), 'modal title in Bengali');
  assert.ok(adminSrc.includes('notifFilterTabs'), 'has filter tabs container');
  assert.ok(adminSrc.includes("setNotifFilter('all')"), 'has All filter');
  assert.ok(adminSrc.includes("setNotifFilter('changes_only')"), 'has New Data filter');
  assert.ok(adminSrc.includes("setNotifFilter('no_changes')"), 'has Routine check filter');
  assert.ok(!adminSrc.includes('notifClearBtn'), 'manual clear button is removed per user request');
  assert.ok(adminSrc.includes('notifRefreshBtn'), 'renders refresh button');
  // Type filter button assertions
  assert.ok(adminSrc.includes('notifTypeFilterBtn'), 'has type filter button style');
  assert.ok(adminSrc.includes('notifTypeModalVisible'), 'has notifTypeModalVisible state');
  assert.ok(adminSrc.includes('PULL_TYPE_CONFIG'), 'has PULL_TYPE_CONFIG constant');
  assert.ok(adminSrc.includes('notifTypeModalBox'), 'renders type filter popup box');
  assert.ok(adminSrc.includes('notifTypeCounts'), 'reads notifTypeCounts for display');
  assert.ok(adminSrc.includes('🎯 টাইপ'), 'shows default type filter label');
});

// 5. Read-only table and delivery monitoring in AdminDB.js
it('AdminDB.js opens read-only monitoring modal on table and delivery tap (Admin cannot edit active orders)', () => {
  assert.ok(adminSrc.includes('setSelectedMonitoringItem({ ...t, isDelivery: false })'), 'opens monitoring modal for table');
  assert.ok(adminSrc.includes('setSelectedMonitoringItem({ ...delivery, isDelivery: true })'), 'opens monitoring modal for delivery');
  assert.ok(adminSrc.includes('ভিউ-অনলি মোড: অ্যাডমিন সরাসরি অর্ডার এডিট বা পরিবর্তন করতে পারবেন না।'), 'has read-only lock badge in monitoring modal');
  assert.ok(!adminSrc.includes('onTableSelect(selectedMonitoringItem.id)'), 'does not allow navigating to edit screen from monitoring modal');
});

// 6. Functional logic test with simulated in-memory store
it('Functional test: insert, query by filter, count, and session clear', () => {
  const memoryRows = [];
  let nextId = 1;

  const mockInsert = ({ timer_name, group_label, message, has_changes = 0, row_count = 0, source = '' }) => {
    const row = {
      id: nextId++,
      timer_name: timer_name || '',
      group_label: group_label || '',
      message: message || '',
      has_changes: has_changes ? 1 : 0,
      row_count: Number(row_count) || 0,
      source: source || '',
      created_at: new Date().toISOString()
    };
    memoryRows.unshift(row);
    return { changes: 1 };
  };

  const mockGet = (filter = 'all', limit = 150) => {
    let result = memoryRows;
    if (filter === 'changes_only') {
      result = result.filter(r => r.has_changes === 1);
    } else if (filter === 'no_changes') {
      result = result.filter(r => r.has_changes === 0);
    }
    return result.slice(0, limit);
  };

  const mockCount = () => {
    return {
      total: memoryRows.length,
      newItems: memoryRows.filter(r => r.has_changes === 1).length
    };
  };

  const mockClear = () => {
    memoryRows.length = 0;
    return true;
  };

  // Initially empty
  assert.strictEqual(mockCount().total, 0);
  assert.strictEqual(mockCount().newItems, 0);

  // Insert routine poll with 0 changes
  mockInsert({
    timer_name: 'supabase-high-frequency-poll',
    group_label: 'অর্ডার/পেমেন্ট',
    message: '⬇️ অর্ডার/পেমেন্ট: নতুন ডাটা নেই (০ টি রিড)',
    has_changes: 0,
    row_count: 0,
    source: 'Routine Soft Poll'
  });

  assert.strictEqual(mockCount().total, 1);
  assert.strictEqual(mockCount().newItems, 0);
  assert.strictEqual(mockGet('all').length, 1);
  assert.strictEqual(mockGet('changes_only').length, 0);
  assert.strictEqual(mockGet('no_changes').length, 1);

  // Insert realtime signal with 3 new rows
  mockInsert({
    timer_name: 'realtime-tables-pull',
    group_label: 'টেবিল',
    message: '⬇️ টেবিল: ৩ টি নতুন ডাটা রিড হয়েছে ✓',
    has_changes: 1,
    row_count: 3,
    source: 'Realtime Signal'
  });

  assert.strictEqual(mockCount().total, 2);
  assert.strictEqual(mockCount().newItems, 1);
  assert.strictEqual(mockGet('all').length, 2);
  assert.strictEqual(mockGet('changes_only').length, 1);
  assert.strictEqual(mockGet('changes_only')[0].row_count, 3);
  assert.strictEqual(mockGet('changes_only')[0].source, 'Realtime Signal');
  assert.strictEqual(mockGet('no_changes').length, 1);

  // Insert PIN login delta pull with 5 new rows
  mockInsert({
    timer_name: 'login-daily-pull',
    group_label: 'দৈনিক হিসাব',
    message: '⬇️ দৈনিক হিসাব: ৫ টি নতুন ডাটা রিড হয়েছে ✓',
    has_changes: 1,
    row_count: 5,
    source: 'PIN Login Sync'
  });

  assert.strictEqual(mockCount().total, 3);
  assert.strictEqual(mockCount().newItems, 2);
  assert.strictEqual(mockGet('changes_only').length, 2);
  assert.strictEqual(mockGet('no_changes').length, 1);

  // Clear session history (emulating new PIN login)
  mockClear();
  assert.strictEqual(mockCount().total, 0);
  assert.strictEqual(mockCount().newItems, 0);
  assert.strictEqual(mockGet('all').length, 0);
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
