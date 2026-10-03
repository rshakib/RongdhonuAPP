/**
 * Daily Submit Indicator & Non-Admin Dashboard Lock Test Suite
 * Run with: node tests/dailySubmitLockAndBanner.test.js
 *
 * Verifies:
 * 1. database.js exports getTodaySubmissionDetails
 * 2. App.js passes todaySubmissionDetails to AdminDB, OwnerDashboard, and ManagerDashboard
 * 3. App.js blocks table selection & delivery creation when daily submit is completed for non-admin
 * 4. AdminDB.js renders the Daily Submit Status Card while preserving full access
 * 5. ManagerDashboard.js renders the Post-Submit Locked Screen (Next Day Ijara, Total Sales & breakdown)
 *    and hides tables, deliveries, order log, and floating action buttons (FABs)
 * 6. ManagerDashboard.js keeps hamburger menu (☰) accessible
 * 7. OwnerDashboard.js renders the Daily Submit Status Card while preserving full access
 */

'use strict';
const assert = require('assert');
const fs = require('fs');

console.log('======================================================');
console.log('   DAILY SUBMIT INDICATOR & MANAGER LOCK TESTS        ');
console.log('======================================================\n');

let passed = 0;
let failed = 0;
const tests = [];
function it(desc, fn) { tests.push({ desc, fn }); }

const dbSrc = fs.readFileSync('database.js', 'utf8');
const appSrc = fs.readFileSync('App.js', 'utf8');
const adminSrc = fs.readFileSync('screens/AdminDB.js', 'utf8');
const managerSrc = fs.readFileSync('screens/ManagerDashboard.js', 'utf8');
const ownerSrc = fs.readFileSync('screens/OwnerDashboard.js', 'utf8');

// 1. database.js
it('database.js exports getTodaySubmissionDetails', () => {
  assert.ok(dbSrc.includes('export function getTodaySubmissionDetails'), 'getTodaySubmissionDetails is exported');
  assert.ok(dbSrc.includes('SELECT * FROM daily_submit WHERE date = ?'), 'queries daily_submit by date');
  assert.ok(dbSrc.includes('nextDayIjara'), 'computes and attaches nextDayIjara');
});

// 2. App.js integration
it('App.js loads todaySubmissionDetails and passes it to dashboards', () => {
  assert.ok(appSrc.includes('getTodaySubmissionDetails'), 'App.js imports getTodaySubmissionDetails');
  assert.ok(appSrc.includes('const [todaySubmissionDetails, setTodaySubmissionDetails] = useState(null)'), 'has state for submission details');
  assert.ok(appSrc.includes('todaySubmissionDetails={todaySubmissionDetails}'), 'passes todaySubmissionDetails prop');
});

// 3. App.js guards against post-submit order actions for non-admin
it('App.js blocks handleTableSelect and handleCreateDelivery when daily submit is done for non-admin', () => {
  assert.ok(appSrc.includes("if (roleNormalized !== 'admin' && isDailySubmitted)"), 'guards handleTableSelect');
  const dIdx = appSrc.indexOf('const handleCreateDelivery = async () =>');
  assert.ok(dIdx > -1, 'handleCreateDelivery exists');
  const dBlock = appSrc.slice(dIdx, dIdx + 400);
  assert.ok(dBlock.includes("if (roleNormalized !== 'admin' && isDailySubmitted)"), 'guards handleCreateDelivery');
});

// 4. AdminDB.js status banner & full access
it('AdminDB.js renders submit status banner with breakdown and preserves full access', () => {
  assert.ok(adminSrc.includes('todaySubmissionDetails'), 'accepts todaySubmissionDetails prop');
  assert.ok(adminSrc.includes('isDailySubmitted && submitInfo'), 'checks submit status for banner');
  assert.ok(adminSrc.includes('submitStatusCardSuccess'), 'has success card styling');
  assert.ok(adminSrc.includes('nextDayIjaraBanner'), 'displays next day ijara callout');
  assert.ok(adminSrc.includes('submitStatusCardPending'), 'shows pending status when not submitted');
});

// 5. ManagerDashboard.js locked screen & hiding restaurant tables/deliveries/FAB
it('ManagerDashboard.js renders Post-Submit Locked Screen and hides tables, deliveries, order log, and FAB', () => {
  assert.ok(managerSrc.includes('isDailySubmitted && submitInfo'), 'conditional post-submit check exists');
  assert.ok(managerSrc.includes('lockHeaderCard'), 'renders lockHeaderCard');
  assert.ok(managerSrc.includes('nextDayIjaraCard'), 'renders nextDayIjaraCard prominently');
  assert.ok(managerSrc.includes('summaryBreakdownCard'), 'renders summaryBreakdownCard');
  assert.ok(managerSrc.includes('sidebarNoticeBox'), 'renders sidebarNoticeBox reminding staff to use ☰');
  assert.ok(managerSrc.includes('!isDailySubmitted && ('), 'hides fabContainer when daily submit is completed');
});

// 6. ManagerDashboard.js preserves hamburger menu
it('ManagerDashboard.js preserves top hamburger menu button (☰) for full sidebar access', () => {
  assert.ok(managerSrc.includes("styles.menuDotsButton"), 'menuDotsButton exists');
  assert.ok(managerSrc.includes("setMenuModalVisible(true)"), 'hamburger button triggers side menu');
});

// 7. OwnerDashboard.js renders submit status card
it('OwnerDashboard.js renders submit status banner with breakdown and next day ijara', () => {
  assert.ok(ownerSrc.includes('todaySubmissionDetails'), 'accepts todaySubmissionDetails prop');
  assert.ok(ownerSrc.includes('isDailySubmitted && submitInfo'), 'checks submit status for banner');
  assert.ok(ownerSrc.includes('submitStatusCardSuccess'), 'has success card styling');
  assert.ok(ownerSrc.includes('nextDayIjaraBanner'), 'displays next day ijara callout');
});

// Run all tests
for (const t of tests) {
  try {
    t.fn();
    console.log(`  \x1b[32m✔\x1b[0m ${t.desc}`);
    passed++;
  } catch (err) {
    console.error(`  \x1b[31m✘\x1b[0m ${t.desc}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

console.log('\n------------------------------------------------------');
console.log(`Results: ${passed} passed, ${failed} failed (${tests.length} total)`);
console.log('------------------------------------------------------\n');

if (failed > 0) process.exit(1);
