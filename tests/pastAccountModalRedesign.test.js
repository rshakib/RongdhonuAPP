const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('--- RUNNING PAST ACCOUNT MODAL REDESIGN TESTS ---');

const modalFilePath = path.join(__dirname, '../components/PastAccountModal.js');
const adminDbPath = path.join(__dirname, '../screens/AdminDB.js');
const ownerDashPath = path.join(__dirname, '../screens/OwnerDashboard.js');
const managerDashPath = path.join(__dirname, '../screens/ManagerDashboard.js');

// 1. Verify component file exists
assert(fs.existsSync(modalFilePath), 'PastAccountModal.js should exist in components/');
const modalCode = fs.readFileSync(modalFilePath, 'utf8');

// 2. Verify Header elements from reference screenshot
assert(modalCode.includes('অতীতের হিসাব যোগ করুন'), 'Modal must have title "অতীতের হিসাব যোগ করুন"');
assert(modalCode.includes('নির্দিষ্ট তারিখের আয়, খরচ ও অন্যান্য তথ্য দিন'), 'Modal must have subtitle "নির্দিষ্ট তারিখের আয়, খরচ ও অন্যান্য তথ্য দিন"');
assert(modalCode.includes('grabberBar'), 'Modal must have a top grabber bar matching the mobile bottom-sheet styling');
assert(modalCode.includes('closeBtn'), 'Modal must have top-right close (X) button');
assert(modalCode.includes('headerIconBadge'), 'Modal must have header icon badge');

// 3. Verify Date picker
assert(modalCode.includes('fieldLabel') && modalCode.includes('তারিখ'), 'Modal must have "তারিখ" label');
assert(modalCode.includes('dateSelector'), 'Modal must have dateSelector container');
assert(modalCode.includes('onOpenDatePicker'), 'Modal must trigger onOpenDatePicker');
assert(modalCode.includes('ChevronDown'), 'Modal date selector must display ChevronDown');

// 4. Verify Section 1: মোট বিক্রয় (আয়)
assert(modalCode.includes('মোট বিক্রয় (আয়)'), 'Section 1 title must be "মোট বিক্রয় (আয়)"');
assert(modalCode.includes('BarChart3'), 'Section 1 must display BarChart3 icon');
assert(modalCode.includes('bKash'), 'Section 1 must include bKash');
assert(modalCode.includes('Nagad'), 'Section 1 must include Nagad');
assert(modalCode.includes('Rocket'), 'Section 1 must include Rocket');
assert(modalCode.includes('Cash'), 'Section 1 must include Cash');
assert(modalCode.includes('Delivery Sell'), 'Section 1 must include Delivery Sell');
assert(modalCode.includes('Delivery Charge'), 'Section 1 must include Delivery Charge');
assert(modalCode.includes('BkashIcon'), 'Section 1 must include bKash icon badge');
assert(modalCode.includes('NagadIcon'), 'Section 1 must include Nagad icon badge');
assert(modalCode.includes('RocketIcon'), 'Section 1 must include Rocket icon badge');
assert(modalCode.includes('CashIcon'), 'Section 1 must include Cash icon badge');
assert(modalCode.includes('🛵'), 'Section 1 must include scooter icon for Delivery Sell');
assert(modalCode.includes('🏷️'), 'Section 1 must include tag icon for Delivery Charge');
assert(modalCode.includes("width: '48.5%'"), 'Fields must be laid out in a 2-column grid');

// 5. Verify Section 2: খরচসমূহ (Expenses)
assert(modalCode.includes('খরচসমূহ (Expenses)'), 'Section 2 title must be "খরচসমূহ (Expenses)"');
assert(modalCode.includes('Wallet'), 'Section 2 must display Wallet icon');
assert(modalCode.includes('isExpensesExpanded'), 'Section 2 must support collapsible toggle');
assert(modalCode.includes('দুধ মিয়া'), 'Section 2 must include দুধ মিয়া');
assert(modalCode.includes('আকাশ মুরগী'), 'Section 2 must include আকাশ মুরগী');
assert(modalCode.includes('বার্গার বান'), 'Section 2 must include বার্গার বান');
assert(modalCode.includes('বাজার খরচ'), 'Section 2 must include বাজার খরচ');
assert(modalCode.includes('অন্যান্য খরচ'), 'Section 2 must include অন্যান্য খরচ');
assert(modalCode.includes('ইজারা (Ijara)'), 'Section 2 must include ইজারা (Ijara)');
assert(modalCode.includes('🛍️'), 'Section 2 must include shopping bag icon for দুধ মিয়া');
assert(modalCode.includes('🐔'), 'Section 2 must include chicken icon for আকাশ মুরগী');
assert(modalCode.includes('🍔'), 'Section 2 must include burger icon for বার্গার বান');
assert(modalCode.includes('🛒'), 'Section 2 must include shopping cart icon for বাজার খরচ');
assert(modalCode.includes('📦'), 'Section 2 must include box icon for অন্যান্য খরচ');
assert(modalCode.includes('🏛️'), 'Section 2 must include landmark icon for ইজারা (Ijara)');

// 6. Verify Section 3: Owner কে জমা (Deposit)
assert(modalCode.includes('Owner কে জমা (Deposit)'), 'Section 3 title must be "Owner কে জমা (Deposit)"');
assert(modalCode.includes('depositCard'), 'Section 3 must have dedicated depositCard styling');
assert(modalCode.includes('User'), 'Section 3 must have User icon badge');
assert(modalCode.includes('#10B981'), 'Section 3 must feature green theme colors');

// 7. Verify Note section & Bottom Buttons
assert(modalCode.includes('নোট (ঐচ্ছিক)'), 'Modal must have "নোট (ঐচ্ছিক)"');
assert(modalCode.includes('অতিরিক্ত তথ্য লিখুন...'), 'Note input must have placeholder "অতিরিক্ত তথ্য লিখুন..."');
assert(modalCode.includes('বাতিল'), 'Modal must have "বাতিল" cancel button');
assert(modalCode.includes('সেভ করুন'), 'Modal must have "সেভ করুন" save button');
assert(modalCode.includes('deleteButton') && modalCode.includes('isEditingPast'), 'Modal must preserve Admin-only delete button when editing');

// 8. Verify AdminDB.js integration
const adminDbCode = fs.readFileSync(adminDbPath, 'utf8');
assert(adminDbCode.includes("import PastAccountModal from '../components/PastAccountModal'"), 'AdminDB.js must import PastAccountModal');
assert(adminDbCode.includes('<PastAccountModal'), 'AdminDB.js must render <PastAccountModal');
assert(adminDbCode.includes('onDelete={onDeletePastAccount}'), 'AdminDB.js must pass onDeletePastAccount to PastAccountModal');
assert(adminDbCode.includes('onSave={handleSavePastEntry}'), 'AdminDB.js must pass handleSavePastEntry to PastAccountModal');

// 9. Verify OwnerDashboard.js integration
const ownerDashCode = fs.readFileSync(ownerDashPath, 'utf8');
assert(ownerDashCode.includes("import PastAccountModal from '../components/PastAccountModal'"), 'OwnerDashboard.js must import PastAccountModal');
assert(ownerDashCode.includes('<PastAccountModal'), 'OwnerDashboard.js must render <PastAccountModal');
assert(ownerDashCode.includes('onSave={handleSavePastEntry}'), 'OwnerDashboard.js must pass handleSavePastEntry to PastAccountModal');

// 10. Verify ManagerDashboard.js integration
const managerDashCode = fs.readFileSync(managerDashPath, 'utf8');
assert(managerDashCode.includes("import PastAccountModal from '../components/PastAccountModal'"), 'ManagerDashboard.js must import PastAccountModal');
assert(managerDashCode.includes('<PastAccountModal'), 'ManagerDashboard.js must render <PastAccountModal');

// 11. Verify Full-screen container height & safe area integration
assert(modalCode.includes('statusBarTranslucent={true}'), 'Modal must have statusBarTranslucent={true}');
assert(modalCode.includes('<SafeAreaView'), 'Modal must wrap content in SafeAreaView');
assert(modalCode.includes('modalRoot'), 'Modal must define modalRoot style');
assert(modalCode.includes("height: '100%'"), 'Modal must use 100% height');
assert(modalCode.includes("width: '100%'"), 'Modal must use 100% width');

// 12. Verify Rongdhonu dark & gold theme alignment
assert(modalCode.includes("backgroundColor: '#0D0D0D'"), 'Modal container background must match Rongdhonu dark #0D0D0D');
assert(modalCode.includes("backgroundColor: '#374151'"), 'Grabber bar must use #374151');
assert(modalCode.includes("backgroundColor: '#FFB703'"), 'Save button must use brand gold #FFB703');
assert(modalCode.includes("color: '#000000'"), 'Save button text must be #000000 for contrast on gold button');
assert(modalCode.includes("borderColor: '#262626'"), 'Cards and borders must use standard #262626 border');

console.log('✅ ALL PAST ACCOUNT MODAL REDESIGN TESTS PASSED!');

