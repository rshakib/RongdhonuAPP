/**
 * Admin Pull Toast Notification Verification
 * Run with: node tests/adminPullToastNotification.test.js
 *
 * Verifies:
 * 1. App.js defines pullNotificationSink and reportPullCheck with rowCount.
 * 2. App.js maps each pull group to its detailed Bengali label via getPullGroupName.
 * 3. runAutoPull invokes reportPullCheck with timer name, pullSource, didChange, and rowCount.
 * 4. Explicitly mentions whether new data was read:
 *    - New data read: "⬇️ {group}: {N} টি নতুন ডাটা রিড হয়েছে ✓"
 *    - No new data: "⬇️ {group}: নতুন ডাটা নেই (০ টি রিড)"
 * 5. Pull notifications are guarded by isTargetAdmin (Admin app only).
 * 6. Toast position is elevated (bottom: 105) above bottom navigation/elements.
 * 7. Smooth toast queue (toastQueueRef) handles sequential display of rapid pull checks.
 */

'use strict';
const assert = require('assert');
const fs = require('fs');

console.log('======================================================');
console.log('   ADMIN PULL TOAST NOTIFICATION VERIFICATION         ');
console.log('======================================================\n');

let passed = 0;
let failed = 0;
const tests = [];
function it(desc, fn) { tests.push({ desc, fn }); }

const appSrc = fs.readFileSync('App.js', 'utf8');

// 1. Plumbing
it('App.js defines pullNotificationSink and reportPullCheck with rowCount', () => {
  assert.ok(appSrc.includes('let pullNotificationSink = null;'), 'pullNotificationSink variable exists');
  assert.ok(appSrc.includes('const reportPullCheck = (name, source, didChange, rowCount = 0) =>'), 'reportPullCheck function exists with rowCount');
});

// 2. Group Name Mapping
it('App.js defines getPullGroupName and maps all pull groups correctly', () => {
  assert.ok(appSrc.includes('const getPullGroupName = (name) =>'), 'getPullGroupName function exists');
  assert.ok(appSrc.includes("if (n.includes('daily')) return 'দৈনিক হিসাব';"), 'daily group mapped');
  assert.ok(appSrc.includes("if (n.includes('high') || n.includes('order')) return 'অর্ডার/পেমেন্ট';"), 'high/order group mapped');
  assert.ok(appSrc.includes("if (n.includes('table')) return 'টেবিল';"), 'table group mapped');
  assert.ok(appSrc.includes("if (n.includes('menu')) return 'মেনু';"), 'menu group mapped');
  assert.ok(appSrc.includes("if (n.includes('deletion')) return 'ডিলিট ডাটা';"), 'deletion group mapped');
  assert.ok(appSrc.includes("if (n.includes('low')) return 'সেটিংস ও স্টাফ ডাটা';"), 'low freq group mapped');
});

// 3. runAutoPull Integration
it('runAutoPull invokes reportPullCheck for every pull execution with rowCount', () => {
  assert.ok(appSrc.includes('reportPullCheck(name, pullSource, didChange, rowCount);'), 'runAutoPull reports pull checks with rowCount');
  assert.ok(appSrc.includes("const pullSource = String(name || '').startsWith('auto-') ? 'firebase' : 'supabase';"), 'pullSource determined dynamically');
});

// 4. Mention whether new data was read or not
it('Pull notification explicitly mentions if new data was read vs no new data', () => {
  assert.ok(appSrc.includes('টি নতুন ডাটা রিড হয়েছে ✓'), 'mentions new data read when changes present');
  assert.ok(appSrc.includes('নতুন ডাটা নেই (০ টি রিড)'), 'mentions 0 new records when no changes present');
  assert.ok(appSrc.includes("showToast(msg, hasChanges ? 'online' : 'sync');"), 'green for new data, blue for 0 items');
});

// 5. Admin-Only Guard
it('Pull notifications are guarded for Admin app only', () => {
  assert.ok(appSrc.includes('isTargetAdmin'), 'isTargetAdmin helper exists');
  assert.ok(
    appSrc.includes("ACTIVE_APP_PROFILE).toUpperCase() === 'ADMIN'") ||
    appSrc.includes("userRoleRef.current || userRole).toLowerCase() === 'admin'"),
    'checks both ACTIVE_APP_PROFILE and userRole'
  );
  assert.ok(appSrc.includes('if (!isTargetAdmin()) return;'), 'sink early exits for non-admin');
});

// 6. Toast Position
it('toastContainer is positioned at bottom: 105 for better clearance above bottom elements', () => {
  assert.ok(appSrc.includes('bottom: 105'), 'toastContainer bottom style is 105');
});

// 7. Sequential Toast Queue
it('showToast uses toastQueueRef for smooth sequential toasts without flashing', () => {
  assert.ok(appSrc.includes('toastQueueRef'), 'toastQueueRef is defined');
  assert.ok(appSrc.includes('processToastQueue'), 'processToastQueue function is defined');
  assert.ok(appSrc.includes('toastTimerRef'), 'toastTimerRef is defined');
});

(async () => {
  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log(`  ✔ ${t.desc}`);
    } catch (err) {
      failed++;
      console.error(`  ✖ ${t.desc}`);
      console.error(`    ${err.message}`);
    }
  }

  console.log('\n------------------------------------------------------');
  console.log(`Results: ${passed} passed, ${failed} failed (${tests.length} total)`);
  console.log('------------------------------------------------------\n');

  if (failed > 0) process.exit(1);
})();
