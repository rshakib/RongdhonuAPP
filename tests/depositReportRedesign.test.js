const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('======================================================');
console.log('   DEPOSIT REPORT (জমা রিপোর্ট) REDESIGN TEST SUITE   ');
console.log('======================================================\n');

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✅  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌  ${name}:`, err.message);
    failed++;
  }
}

const modalCode = fs.readFileSync(path.join(__dirname, '../components/DepositReportModal.js'), 'utf8');
const adminDbCode = fs.readFileSync(path.join(__dirname, '../screens/AdminDB.js'), 'utf8');
const ownerCode = fs.readFileSync(path.join(__dirname, '../screens/OwnerDashboard.js'), 'utf8');

// 1. Header Structure & Elements
runTest('TC-01: Header contains top grabber, icon, title, subtitle, and close button', () => {
  assert(modalCode.includes('styles.grabberBar'), 'Grabber bar missing');
  assert(modalCode.includes('জমা রিপোর্ট'), 'Modal title "জমা রিপোর্ট" missing');
  assert(modalCode.includes('পুরো মাসের দৈনিক হিসাব'), 'Modal subtitle "পুরো মাসের দৈনিক হিসাব" missing');
  assert(modalCode.includes('onRequestClose={onClose}'), 'onRequestClose missing');
  assert(modalCode.includes('styles.closeBtn'), 'Close button missing');
});

// 2. Month and Year Selectors
runTest('TC-02: Modern Month and Year selector cards with Bengali labels', () => {
  assert(modalCode.includes('মাস নির্বাচন করুন'), '"মাস নির্বাচন করুন" label missing');
  assert(modalCode.includes('বছর নির্বাচন করুন'), '"বছর নির্বাচন করুন" label missing');
  assert(modalCode.includes('onOpenMonthPicker'), 'onOpenMonthPicker handler missing');
  assert(modalCode.includes('onOpenYearPicker'), 'onOpenYearPicker handler missing');
});

// 3. 2x2 Summary Cards Grid
runTest('TC-03: Exactly 4 summary cards: মোট বিক্রয়, মোট খরচ, মোট জমা, মোট দিন', () => {
  assert(modalCode.includes('মোট বিক্রয়'), '"মোট বিক্রয়" summary card missing');
  assert(modalCode.includes('মোট খরচ'), '"মোট খরচ" summary card missing');
  assert(modalCode.includes('মোট জমা'), '"মোট জমা" summary card missing');
  assert(modalCode.includes('মোট দিন'), '"মোট দিন" summary card missing');
  assert(modalCode.includes('totalSell'), 'totalSell calculation missing');
  assert(modalCode.includes('totalExpense'), 'totalExpense calculation missing');
  assert(modalCode.includes('totalDeposit'), 'totalDeposit calculation missing');
  assert(modalCode.includes('totalDays'), 'totalDays calculation missing');
});

// 4. Search and Filter Bar
runTest('TC-04: Rounded search field with Bengali placeholder and filter toggle', () => {
  assert(modalCode.includes('placeholder="তারিখ দিয়ে সার্চ করুন..."'), 'Search placeholder missing');
  assert(modalCode.includes('setSearchQuery'), 'setSearchQuery state setter missing');
  assert(modalCode.includes('setShowAllColumns'), 'setShowAllColumns toggle missing');
  assert(modalCode.includes('SlidersHorizontal'), 'Filter slider icon missing');
});

// 5. Daily Report Table & Primary Columns
runTest('TC-05: Table renders primary columns: তারিখ, মোট বিক্রয়, মোট খরচ, জমা, and detail arrow', () => {
  assert(modalCode.includes('তারিখ'), 'তারিখ column missing');
  assert(modalCode.includes('মোট বিক্রয়'), 'মোট বিক্রয় column missing');
  assert(modalCode.includes('মোট খরচ'), 'মোট খরচ column missing');
  assert(modalCode.includes('জমা'), 'জমা column missing');
  assert(modalCode.includes('ChevronRight'), 'Row detail ChevronRight arrow missing');
  assert(modalCode.includes('onSelectDay'), 'onSelectDay row navigation handler missing');
});

// 6. Horizontal Scrolling & All Existing Report Columns Accessible
runTest('TC-06: Horizontal scrolling and all breakdown columns preserved', () => {
  assert(modalCode.includes('horizontal={true}'), 'Horizontal ScrollView missing');
  assert(modalCode.includes('bKash'), 'bKash column missing');
  assert(modalCode.includes('Nagad'), 'Nagad column missing');
  assert(modalCode.includes('Cash'), 'Cash column missing');
  assert(modalCode.includes('Deliv'), 'Delivery column missing');
  assert(modalCode.includes('দুদু'), 'দুদু column missing');
  assert(modalCode.includes('আকাশ'), 'আকাশ column missing');
  assert(modalCode.includes('বার্গার'), 'বার্গার column missing');
  assert(modalCode.includes('বাজার'), 'বাজার column missing');
  assert(modalCode.includes('অন্য'), 'অন্য column missing');
  assert(modalCode.includes('ইজা'), 'ইজা column missing');
});

// 7. Monthly Total Row
runTest('TC-07: Monthly total row at bottom of table', () => {
  assert(modalCode.includes('মোট (Total)'), '"মোট (Total)" label missing');
  assert(modalCode.includes('styles.tableFooter'), 'Table footer row missing');
});

// 8. PDF Download and Secondary Actions
runTest('TC-08: PDF ডাউনলোড button with onExportPDF and secondary close action', () => {
  assert(modalCode.includes('PDF ডাউনলোড'), 'PDF ডাউনলোড button text missing');
  assert(modalCode.includes('onPress={onExportPDF}'), 'onExportPDF onPress missing');
  assert(modalCode.includes('onPress={onClose}'), 'onClose secondary button missing');
});

// 9. Integration in AdminDB.js
runTest('TC-09: AdminDB imports and renders DepositReportModal with full history and admin features', () => {
  assert(adminDbCode.includes('import DepositReportModal from \'../components/DepositReportModal\';'), 'DepositReportModal import missing in AdminDB');
  assert(adminDbCode.includes('<DepositReportModal'), 'DepositReportModal JSX missing in AdminDB');
  assert(adminDbCode.includes('exportDepositReportPDF(fullHistory, activeFilter)'), 'PDF export missing in AdminDB');
  assert(adminDbCode.includes('isAdmin={true}'), 'isAdmin prop missing in AdminDB');
});

// 10. Integration in OwnerDashboard.js
runTest('TC-10: OwnerDashboard imports and renders DepositReportModal with filtered history and breakdown', () => {
  assert(ownerCode.includes('import DepositReportModal from \'../components/DepositReportModal\';'), 'DepositReportModal import missing in OwnerDashboard');
  assert(ownerCode.includes('<DepositReportModal'), 'DepositReportModal JSX missing in OwnerDashboard');
  assert(ownerCode.includes('exportDepositReportPDF(filteredHistory, activeFilter)'), 'PDF export missing in OwnerDashboard');
  assert(ownerCode.includes('breakdownSummary={true}'), 'breakdownSummary prop missing in OwnerDashboard');
  assert(ownerCode.includes('onEditPastAccount={handleEditPastAccount}'), 'onEditPastAccount missing in OwnerDashboard');
});

// 11. Date Edit Functionality Parity
runTest('TC-11: DepositReportModal shows edit pencil icon based on onEditPastAccount prop (Admin & Owner parity)', () => {
  assert(modalCode.includes('Boolean(onEditPastAccount)'), 'Pencil icon should check Boolean(onEditPastAccount) to support Owner app');
  assert(modalCode.includes('onEditPastAccount(item)'), 'onEditPastAccount callback missing on pencil tap');
});

// 12. 4 Primary Columns Responsive Fit & Direct Container Sizing
runTest('TC-12: Primary 4 columns use responsive flex layout without unwanted horizontal scrolling', () => {
  assert(modalCode.includes('showAllColumns ?'), 'showAllColumns conditional rendering missing');
  assert(modalCode.includes('minWidth: 1160'), 'Expanded table minWidth missing');
  assert(modalCode.includes('tableInnerCard'), 'tableInnerCard container for 4 primary columns missing');
  assert(modalCode.includes('styles.col1'), 'Primary column 1 flex layout missing');
  assert(modalCode.includes('styles.col2'), 'Primary column 2 flex layout missing');
  assert(modalCode.includes('styles.col3'), 'Primary column 3 flex layout missing');
  assert(modalCode.includes('styles.col4'), 'Primary column 4 flex layout missing');
});

// 13. Monthly Expense Breakdown in Admin Deposit Report
runTest('TC-13: Monthly Expense Breakdown renders 6 categories with vector icons in Admin Deposit Report', () => {
  assert(modalCode.includes('মাসিক খরচের বিবরণ (Breakdown)'), 'Breakdown title missing');
  assert(modalCode.includes('দুধ মিয়া'), '"দুধ মিয়া" category missing');
  assert(modalCode.includes('আকাশ মুরগী'), '"আকাশ মুরগী" category missing');
  assert(modalCode.includes('বার্গার বান'), '"বার্গার বান" category missing');
  assert(modalCode.includes('বাজার খরচ'), '"বাজার খরচ" category missing');
  assert(modalCode.includes('অন্যান্য'), '"অন্যান্য" category missing');
  assert(modalCode.includes('ইজারা'), '"ইজারা" category missing');
  assert(modalCode.includes('breakdownCard'), 'breakdownCard container missing');
  assert(modalCode.includes('breakdownGrid'), 'breakdownGrid missing');
  assert(modalCode.includes('breakdownItem'), 'breakdownItem missing');
  assert(adminDbCode.includes('breakdownSummary={true}'), 'AdminDB must pass breakdownSummary={true}');
});

console.log('\n======================================================');
console.log(`   TEST EXECUTION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
console.log('======================================================\n');

if (failed > 0) {
  process.exit(1);
}


