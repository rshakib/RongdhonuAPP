const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('======================================================');
console.log('   ADMIN DASHBOARD MERGE & ROLE RESTRICTION SUITE     ');
console.log('======================================================\n');

const adminDbPath = path.join(__dirname, '../screens/AdminDB.js');
const appPath = path.join(__dirname, '../App.js');
const ownerDbPath = path.join(__dirname, '../screens/OwnerDashboard.js');
const managerDbPath = path.join(__dirname, '../screens/ManagerDashboard.js');

const adminDbCode = fs.readFileSync(adminDbPath, 'utf8');
const appCode = fs.readFileSync(appPath, 'utf8');
const ownerDbCode = fs.readFileSync(ownerDbPath, 'utf8');
const managerDbCode = fs.readFileSync(managerDbPath, 'utf8');

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✅  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌  ${name}: ${err.message}`);
    failed++;
  }
}

// 1. Table grid renders all tables correctly in 4 columns
runTest('TC-01: Table grid renders 4-column responsive layout with tableDisplayId and status', () => {
  assert(adminDbCode.includes('styles.tableVisualGrid'), 'Missing tableVisualGrid container in AdminDB.js');
  assert(adminDbCode.includes('styles.tableGridCard'), 'Missing tableGridCard style in AdminDB.js');
  assert(adminDbCode.includes("width: '23.5%'"), 'tableGridCard must be 23.5% for 4-column layout');
  assert(adminDbCode.includes('tables.map('), 'Must dynamically map over all tables');
});

// 2. Busy table shows the correct active order amount
runTest('TC-02: Busy tables show elapsed time and active order amount derived from items', () => {
  assert(adminDbCode.includes('getTableElapsedMinutes(t)'), 'Missing elapsed minutes helper call');
  assert(adminDbCode.includes('getTableAmount(t)'), 'Missing active order amount helper call');
  assert(adminDbCode.includes('isBusy ? `৳${tblAmt.toLocaleString()}` : \'-\''), 'Busy table must display formatted amount or dash for free');
});

// 3. Active Delivery appears inside the combined section
runTest('TC-03: Active Delivery is merged inside the single card titled "টেবিল ও সক্রিয় ডেলিভারি"', () => {
  assert(adminDbCode.includes('টেবিল ও সক্রিয় ডেলিভারি'), 'Section must use exact title "টেবিল ও সক্রিয় ডেলিভারি"');
  assert(adminDbCode.includes('───── সক্রিয় ডেলিভারি ─────'), 'Must include "───── সক্রিয় ডেলিভারি ─────" divider inside same card');
  assert(adminDbCode.includes('deliveryDividerContainer'), 'Must style deliveryDividerContainer inside the combined card');
});

// 4. Completed/cancelled deliveries are excluded from active list
runTest('TC-04: Active deliveries strictly filter for status === "BUSY"', () => {
  assert(adminDbCode.includes("d.status === 'BUSY'"), 'Active deliveries must strictly filter on d.status === BUSY');
  assert(!adminDbCode.includes("d.status === 'Done'"), 'Completed orders must not be included in active deliveries');
});

// 5. Empty delivery state works
runTest('TC-05: Clean empty state rendered when there are no active deliveries', () => {
  assert(adminDbCode.includes('emptyDeliveryBox'), 'Missing empty delivery box container');
  assert(adminDbCode.includes('বর্তমানে কোনো সক্রিয় ডেলিভারি নেই'), 'Missing empty delivery message');
});

// 6. ADMIN cannot access order creation through dashboard actions
runTest('TC-06: Free table press is blocked for ADMIN with alert notice', () => {
  assert(adminDbCode.includes('অ্যাডমিন এক্সেস') || adminDbCode.includes('নতুন অর্ডার তৈরি করার অনুমতি নেই'), 'Admin must be restricted from order creation on free tables');
  // App.js router guard
  assert(appCode.includes("roleNormalized === 'admin'"), 'App.js must check normalized admin role');
  assert(appCode.includes('!isBusy && !isDoneOrder'), 'App.js must guard free table navigation for admin');
});

// 7. ADMIN cannot access delivery creation through dashboard actions
runTest('TC-07: ADMIN cannot access delivery creation and create delivery button is removed', () => {
  // App.js must guard handleCreateDelivery
  assert(appCode.includes("if (roleNormalized === 'admin')"), 'handleCreateDelivery in App.js must block admin role');
  // AdminDB must not receive onCreateDelivery prop in App.js
  const adminDbInvocation = appCode.substring(appCode.indexOf('<AdminDB'), appCode.indexOf('</AdminDB>') || appCode.indexOf('/>', appCode.indexOf('<AdminDB')));
  assert(!adminDbInvocation.includes('onCreateDelivery={handleCreateDelivery}'), 'onCreateDelivery must not be passed to AdminDB in App.js');
  // AdminDB does not render "➕ নতুন ডেলিভারি শুরু করুন"
  assert(!adminDbCode.includes('➕ নতুন ডেলিভারি শুরু করুন'), 'AdminDB must not contain "➕ নতুন ডেলিভারি শুরু করুন" button');
});

// 8. OWNER and MANAGER behavior remains consistent with existing permission rules
runTest('TC-08: OWNER and MANAGER retain createDelivery and table selection intact', () => {
  assert(ownerDbCode.includes('onCreateDelivery'), 'OwnerDashboard must retain onCreateDelivery');
  assert(managerDbCode.includes('onCreateDelivery'), 'ManagerDashboard must retain onCreateDelivery');
  assert(appCode.includes('onCreateDelivery={handleCreateDelivery}'), 'App.js must pass onCreateDelivery to Owner and Manager');
});

// 9. Existing viewing/management functionality still works
runTest('TC-09: Busy table selection and delivery monitoring preserved for ADMIN', () => {
  assert(adminDbCode.includes('if (isBusy)'), 'AdminDB must allow selecting busy tables');
  assert(adminDbCode.includes('onTableSelect(delivery.id)'), 'AdminDB must allow inspecting active deliveries');
  assert(adminDbCode.includes('handleTableLongPress(t)'), 'Admin table rename functionality preserved');
});

// 10. No unrelated navigation or sync behavior is broken
runTest('TC-10: Preserved 3-dot menu, PDF exports, modals, and sync functions', () => {
  assert(adminDbCode.includes('onLogout'), 'onLogout preserved');
  assert(adminDbCode.includes('onSameDayResync'), 'onSameDayResync preserved');
  assert(adminDbCode.includes('onNavigateToEditMenu'), 'onNavigateToEditMenu preserved');
  assert(adminDbCode.includes('onNavigateToAnalytics'), 'onNavigateToAnalytics preserved');
  assert(adminDbCode.includes('onNavigateToDeviceManagement'), 'onNavigateToDeviceManagement preserved');
  assert(adminDbCode.includes('setSalesReportVisible(true)'), 'Sales report PDF modal preserved');
  assert(adminDbCode.includes('setDepositReportVisible(true)'), 'Deposit report PDF modal preserved');
});

console.log('\n======================================================');
console.log(`   TEST EXECUTION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
console.log('======================================================');

if (failed > 0) {
  process.exit(1);
}

