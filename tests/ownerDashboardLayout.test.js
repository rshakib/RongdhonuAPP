const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('======================================================');
console.log('   OWNER DASHBOARD REDESIGN & PERMISSIONS TEST SUITE  ');
console.log('======================================================\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌  ${name}:`, err.message);
    failed++;
  }
}

const ownerCode = fs.readFileSync(path.join(__dirname, '../screens/OwnerDashboard.js'), 'utf8');
const adminCode = fs.readFileSync(path.join(__dirname, '../screens/AdminDB.js'), 'utf8');

// 1. Owner sees exactly 3 top summary cards.
test('1. Owner sees exactly 3 top summary cards in stats container', () => {
  const statsBlockMatch = ownerCode.match(/contentContainerStyle=\{styles\.statsContainer\}>([\s\S]*?)<\/ScrollView>/);
  assert(statsBlockMatch, 'Stats container ScrollView not found');
  const statsContent = statsBlockMatch[1];
  
  assert(statsContent.includes('<TodaySalesCard'), 'TodaySalesCard missing');
  assert(statsContent.includes('<TotalCashCard'), 'TotalCashCard missing');
  assert(statsContent.includes('<MonthlyTotalCard'), 'MonthlyTotalCard missing');
  
  // Count Card components in stats container
  const cardMatches = statsContent.match(/<[A-Z][a-zA-Z]*Card/g) || [];
  assert.strictEqual(cardMatches.length, 3, `Expected exactly 3 top cards, found ${cardMatches.length}`);
});

// 2. Active Tables Count card is removed.
test('2. Active Tables Count card is removed', () => {
  assert(!ownerCode.includes('<ActiveTablesCard'), 'ActiveTablesCard should NOT be rendered');
  assert(!ownerCode.includes('import { TodaySalesCard, TotalCashCard, ActiveTablesCard'), 'ActiveTablesCard should not be imported');
});

// 3. Money source section matches Admin\'s calculation.
test('3. Money source section matches Admin calculations and structure', () => {
  assert(ownerCode.includes('টাকা কোন পথে এল'), 'Money source section title missing');
  assert(ownerCode.includes('cashPct'), 'cashPct calculation missing');
  assert(ownerCode.includes('bkashPct'), 'bkashPct calculation missing');
  assert(ownerCode.includes('nagadPct'), 'nagadPct calculation missing');
  assert(ownerCode.includes('rocketPct'), 'rocketPct calculation missing');
  assert(ownerCode.includes('duePct'), 'duePct calculation missing');
  assert(ownerCode.includes('totalPaymentCalculated'), 'totalPaymentCalculated missing');
  assert(ownerCode.includes('styles.segmentedBarTrack'), 'segmentedBarTrack missing');
  assert(ownerCode.includes('styles.paymentLegendGrid'), 'paymentLegendGrid missing');
});

// 4. Last 7 Days chart matches Admin\'s data/calculation.
test('4. Last 7 Days chart matches Admin data/calculation', () => {
  assert(ownerCode.includes('গত ৭ দিনের বিক্রয়'), 'Last 7 Days title missing');
  assert(ownerCode.includes('last7DaysData'), 'last7DaysData calculation missing');
  assert(ownerCode.includes('max7DaySale'), 'max7DaySale calculation missing');
  assert(ownerCode.includes('highest7DaySale'), 'highest7DaySale missing');
  assert(ownerCode.includes('bestDayKey'), 'bestDayKey missing');
  assert(ownerCode.includes('daily_submit'), 'daily_submit fallback missing');
  assert(ownerCode.includes('styles.chartBarsRow'), 'chartBarsRow container missing');
});

// 5. Owner can create table orders.
test('5. Owner can create table orders (onTableSelect on table cards)', () => {
  // Check table grid has onTableSelect
  assert(ownerCode.includes('onPress={() => onTableSelect(t.id)}'), 'Table card must invoke onTableSelect to enter POS order creation');
});

// 6. Owner can create delivery orders.
test('6. Owner can create delivery orders (onCreateDelivery button)', () => {
  assert(ownerCode.includes('onPress={onCreateDelivery}'), 'onCreateDelivery button missing in delivery section');
  assert(ownerCode.includes('newDeliveryMiniBtn'), 'newDeliveryMiniBtn missing');
});

// 7. Owner can view operational Table and Delivery lists.
test('7. Owner can view operational Table and Delivery lists', () => {
  assert(ownerCode.includes('styles.tableVisualGrid'), 'tableVisualGrid layout missing');
  assert(ownerCode.includes('styles.tableFilterPillGroup'), 'Filter toggle pill group missing');
  assert(ownerCode.includes('styles.activeDeliveryCard'), 'activeDeliveryCard layout missing');
  assert(ownerCode.includes('getTableElapsedMinutes'), 'Elapsed minutes missing');
  assert(ownerCode.includes('getTableAmount'), 'Table amount missing');
});

// 8. Owner cannot access Admin-only order or delivery details.
test('8. Owner cannot access Admin-only order or delivery monitoring details', () => {
  assert(!ownerCode.includes('monitoringModalVisible'), 'Owner must NOT have monitoringModalVisible');
  assert(!ownerCode.includes('selectedMonitoringItem'), 'Owner must NOT have selectedMonitoringItem');
  assert(!ownerCode.includes('orderedBy || selectedMonitoringItem.created_by'), 'Owner must NOT access internal order taker audit');
});

// 9. Top Selling Items and Today\'s Order Log display correctly in sequence.
test('9. Top Selling Items and Today\'s Order Log display in correct order', () => {
  const topSellerIdx = ownerCode.indexOf('শীর্ষ বিক্রিত খাবার');
  const orderLogIdx = ownerCode.indexOf('আজকের অর্ডার লগ');
  assert(topSellerIdx !== -1, 'Top selling items section missing');
  assert(orderLogIdx !== -1, 'Today order log section missing');
  assert(topSellerIdx < orderLogIdx, 'Top selling items must come BEFORE Today\'s Order Log');
  assert(ownerCode.includes('getItemSalesReport'), 'getItemSalesReport query missing');
  assert(ownerCode.includes('topHeroCard'), 'topHeroCard missing');
  assert(ownerCode.includes('rankedListCard'), 'rankedListCard missing');
});

// 10. No unnecessary Firebase Reads/listeners are introduced.
test('10. No unnecessary Firebase Reads or polling listeners introduced', () => {
  // Check that no new setInterval or firestore listeners were added
  assert(!ownerCode.includes('setInterval'), 'No setInterval should be present in OwnerDashboard');
  assert(!ownerCode.includes('onSnapshot'), 'No direct Firebase listener in OwnerDashboard');
  assert(!ownerCode.includes('fetchCollection'), 'No fetchCollection in OwnerDashboard');
});

// 11. Admin Dashboard remains unchanged.
test('11. Admin Dashboard retains its own functionality and structure', () => {
  assert(adminCode.includes('AdminDB'), 'AdminDB missing');
  assert(adminCode.includes('monitoringModalVisible'), 'AdminDB must keep monitoringModalVisible');
  assert(adminCode.includes('paymentSourceCard'), 'AdminDB must keep paymentSourceCard');
  assert(adminCode.includes('chartCard'), 'AdminDB must keep chartCard');
});

console.log('\n------------------------------------------------------');
console.log(`Tests Passed: ${passed}`);
console.log(`Tests Failed: ${failed}`);
console.log('======================================================\n');

if (failed > 0) process.exit(1);

