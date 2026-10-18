const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('--- RUNNING SALES REPORT REDESIGN TESTS ---');

const modalFilePath = path.join(__dirname, '../components/SalesReportModal.js');
const adminDbPath = path.join(__dirname, '../screens/AdminDB.js');
const ownerDashPath = path.join(__dirname, '../screens/OwnerDashboard.js');

// 1. Verify component file exists
assert(fs.existsSync(modalFilePath), 'SalesReportModal.js should exist in components/');
const modalCode = fs.readFileSync(modalFilePath, 'utf8');

// 2. Verify Header elements matching reference image
assert(modalCode.includes('বিক্রয় রিপোর্ট'), 'Modal must have title "বিক্রয় রিপোর্ট"');
assert(modalCode.includes('বিস্তারিত তথ্য দেখুন'), 'Modal must have subtitle "বিস্তারিত তথ্য দেখুন"');
assert(modalCode.includes('headerIconBadge'), 'Modal must have header icon badge');
assert(modalCode.includes('closeCircle'), 'Modal must have circular close (X) button');

// 3. Verify 4 Horizontal Date Filter Cards
assert(modalCode.includes('Today'), 'Filter cards must include "Today"');
assert(modalCode.includes('Yesterday'), 'Filter cards must include "Yesterday"');
assert(modalCode.includes('Last 7 Days'), 'Filter cards must include "Last 7 Days"');
assert(modalCode.includes('Pick Date'), 'Filter cards must include "Pick Date"');
assert(modalCode.includes('filterCardsRow'), 'Filter cards must be laid out horizontally');
assert(modalCode.includes('filterCardActive'), 'Active filter card must have prominent highlight');
assert(modalCode.includes('#FFB703'), 'Active filter card must use brand gold #FFB703 styling');

// 4. Verify Sales Table Columns
assert(modalCode.includes('সময়'), 'Table header must have "সময়" column');
assert(modalCode.includes('টেবিল'), 'Table header must have "টেবিল" column');
assert(modalCode.includes('আইটেম'), 'Table header must have "আইটেম" column');
assert(modalCode.includes('বিক্রয়'), 'Table header must have "বিক্রয়" column');

// 5. Verify Table Row Elements
assert(modalCode.includes('timeMainText') && modalCode.includes('timeSubText'), 'Time column must display time and date');
assert(modalCode.includes('badgePill'), 'Table column must render badges for table numbers');
assert(modalCode.includes('itemSummaryText'), 'Items column must display item breakdown');
assert(modalCode.includes('saleAmountText'), 'Sale amount must be rendered prominently');
assert(modalCode.includes('#34D399'), 'Sale amount must use emerald green color #34D399');
assert(modalCode.includes('printerBtn'), 'Each row must have a printer button');
assert(modalCode.includes('onPrintOrder'), 'Printer button must trigger onPrintOrder');

// 6. Verify Delivery Support with Vector Icon
assert(modalCode.includes('ScooterIcon'), 'Must render vector ScooterIcon for delivery orders');
assert(modalCode.includes('Delivery'), 'Must support delivery badge');

// 7. Verify NO Unicode Emojis Used
assert(!modalCode.includes('🛵'), 'Unicode scooter emoji must NOT be used');
assert(!modalCode.includes('📅'), 'Unicode calendar emoji must NOT be used');
assert(!modalCode.includes('🖨️'), 'Unicode printer emoji must NOT be used');
assert(!modalCode.includes('📄'), 'Unicode document emoji must NOT be used');
assert(!modalCode.includes('📋'), 'Unicode clipboard emoji must NOT be used');

// 8. Verify Bottom Action Buttons
assert(modalCode.includes('PDF ডাউনলোড'), 'Modal must have "PDF ডাউনলোড" button');
assert(modalCode.includes('বন্ধ করুন'), 'Modal must have "বন্ধ করুন" button');
assert(modalCode.includes('pdfBtn'), 'Must have pdfBtn styling');
assert(modalCode.includes('closeActionBtn'), 'Must have closeActionBtn styling');
assert(modalCode.includes('#34D399'), 'PDF download button must use emerald green #34D399');

// 9. Verify Full-screen container height & safe area integration
assert(modalCode.includes('statusBarTranslucent={true}'), 'Modal must have statusBarTranslucent={true}');
assert(modalCode.includes('<SafeAreaView'), 'Modal must wrap content in SafeAreaView');
assert(modalCode.includes('modalRoot'), 'Modal must define modalRoot style');
assert(modalCode.includes('modalCard'), 'Modal must define modalCard style');
assert(modalCode.includes('#0D0D0D'), 'Modal card must use dark background #0D0D0D');
assert(modalCode.includes('#262626'), 'Modal card must use border color #262626');


// 10. Verify AdminDB.js integration
const adminDbCode = fs.readFileSync(adminDbPath, 'utf8');
assert(adminDbCode.includes("import SalesReportModal from '../components/SalesReportModal'"), 'AdminDB.js must import SalesReportModal');
assert(adminDbCode.includes('<SalesReportModal'), 'AdminDB.js must render <SalesReportModal');
assert(adminDbCode.includes('onExportPDF'), 'AdminDB.js must pass onExportPDF to SalesReportModal');
assert(adminDbCode.includes('onPrintOrder'), 'AdminDB.js must pass onPrintOrder to SalesReportModal');

// 11. Verify OwnerDashboard.js integration
const ownerDashCode = fs.readFileSync(ownerDashPath, 'utf8');
assert(ownerDashCode.includes("import SalesReportModal from '../components/SalesReportModal'"), 'OwnerDashboard.js must import SalesReportModal');
assert(ownerDashCode.includes('<SalesReportModal'), 'OwnerDashboard.js must render <SalesReportModal');
assert(ownerDashCode.includes('onExportPDF'), 'OwnerDashboard.js must pass onExportPDF to SalesReportModal');
assert(ownerDashCode.includes('onPrintOrder'), 'OwnerDashboard.js must pass onPrintOrder to SalesReportModal');

console.log('✅ ALL SALES REPORT REDESIGN TESTS PASSED!');
