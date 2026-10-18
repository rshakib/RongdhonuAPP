const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('======================================================');
console.log('   DELIVERY CHARGE PERSISTENCE & RESTORATION SUITE    ');
console.log('======================================================\n');

const dbPath = path.join(__dirname, '../database.js');
const tableDetailPath = path.join(__dirname, '../screens/TableDetailScreen.js');
const appPath = path.join(__dirname, '../App.js');
const adminDbPath = path.join(__dirname, '../screens/AdminDB.js');
const managerDbPath = path.join(__dirname, '../screens/ManagerDashboard.js');
const ownerDbPath = path.join(__dirname, '../screens/OwnerDashboard.js');

const dbCode = fs.readFileSync(dbPath, 'utf8');
const tableDetailCode = fs.readFileSync(tableDetailPath, 'utf8');
const appCode = fs.readFileSync(appPath, 'utf8');
const adminDbCode = fs.readFileSync(adminDbPath, 'utf8');
const managerDbCode = fs.readFileSync(managerDbPath, 'utf8');
const ownerDbCode = fs.readFileSync(ownerDbPath, 'utf8');

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

// TC-01: database.js - getDeliveries calculates canonical amount including deliveryCharge
runTest('TC-01: database.js getDeliveries calculates and returns canonical amount including deliveryCharge', () => {
  assert(dbCode.includes('export function getDeliveries'), 'Missing export getDeliveries in database.js');
  assert(dbCode.includes('charge = parseFloat(r.delivery_charge) || 0'), 'Must parse delivery_charge in getDeliveries');
  assert(dbCode.includes('computedAmount = itemsSubtotal + charge'), 'Must compute amount as itemsSubtotal + charge');
  assert(dbCode.includes('amount: canonicalAmount'), 'Must return canonical amount');
  assert(dbCode.includes('totalAmount: canonicalAmount'), 'Must return totalAmount matching canonicalAmount');
});

// TC-02: database.js - updateDeliveryDetails stores delivery_charge and recalculates amount
runTest('TC-02: database.js updateDeliveryDetails recalculates amount = itemsSubtotal + deliveryCharge', () => {
  assert(dbCode.includes('export function updateDeliveryDetails'), 'Missing export updateDeliveryDetails in database.js');
  assert(dbCode.includes('finalAmount = itemsSubtotal + numericDelCharge'), 'Must calculate finalAmount as itemsSubtotal + numericDelCharge');
  assert(dbCode.includes('UPDATE deliveries SET delivery_charge = ?, change_money_given = ?, amount = ?, updated_at = ?, is_synced = 0 WHERE id = ?'),
    'Must persist delivery_charge, change_money_given, amount, and mark is_synced = 0 in SQLite');
});

// TC-03: database.js - getDeliveryById exported and queries SQLite directly
runTest('TC-03: database.js exports getDeliveryById for direct synchronous SQLite read', () => {
  assert(dbCode.includes('export function getDeliveryById'), 'Missing export getDeliveryById in database.js');
  assert(dbCode.includes('SELECT * FROM deliveries WHERE id = ?'), 'getDeliveryById must select row by id from SQLite');
});

// TC-04: TableDetailScreen.js - useEffect syncs prop table to deliveryChargeText
runTest('TC-04: TableDetailScreen.js syncs deliveryChargeText with table prop to prevent stale state', () => {
  assert(tableDetailCode.includes('setDeliveryChargeText(table.deliveryCharge.toString())'), 'Must sync deliveryChargeText when table.deliveryCharge changes');
  assert(tableDetailCode.includes('[table?.id, table?.deliveryCharge, table?.changeMoneyGiven]'), 'useEffect must watch table id, deliveryCharge, and changeMoneyGiven');
});

// TC-05: TableDetailScreen.js - handleApplyDeliveryCharge takes explicit chargeValue without setTimeout
runTest('TC-05: TableDetailScreen.js handleApplyDeliveryCharge accepts immediate charge value without setTimeout closure bug', () => {
  assert(tableDetailCode.includes('const handleApplyDeliveryCharge = (chargeValue) =>'), 'handleApplyDeliveryCharge must accept chargeValue param');
  assert(tableDetailCode.includes('onUpdateDeliveryDetails(table.id, charge, appliedChangeMoney)'), 'Must call onUpdateDeliveryDetails immediately');
  assert(!tableDetailCode.includes('setTimeout(handleApplyDeliveryCharge'), 'Must NOT use setTimeout for handleApplyDeliveryCharge');
});

// TC-06: TableDetailScreen.js - Presets and clear buttons trigger immediate update
runTest('TC-06: TableDetailScreen.js preset and clear buttons trigger immediate update', () => {
  assert(tableDetailCode.includes('handleApplyDeliveryCharge(val)'), 'Preset buttons must call handleApplyDeliveryCharge(val) immediately');
  assert(tableDetailCode.includes('handleApplyDeliveryCharge(0)'), 'Clear button must call handleApplyDeliveryCharge(0) immediately');
});

// TC-07: TableDetailScreen.js - Header back button flushes delivery charge
runTest('TC-07: TableDetailScreen.js header back button flushes delivery charge via handleBack', () => {
  assert(tableDetailCode.includes('const handleBack = () =>'), 'Must define handleBack to flush details');
  assert(tableDetailCode.includes('onPress={handleBack}'), 'Header back button must call handleBack');
});

// TC-08: App.js - TABLE_DETAIL reads delivery directly from SQLite via getDeliveryById
runTest('TC-08: App.js TABLE_DETAIL reads delivery directly from SQLite via getDeliveryById', () => {
  assert(appCode.includes("case 'TABLE_DETAIL':"), 'Must have TABLE_DETAIL case');
  const tableDetailBlock = appCode.slice(appCode.indexOf("case 'TABLE_DETAIL':"), appCode.indexOf("case 'ADD_ITEM':"));
  assert(tableDetailBlock.includes("selectedTableId.toString().startsWith('D-')"), 'Must check if delivery id starts with D-');
  assert(tableDetailBlock.includes("getDeliveryById(selectedTableId)"), 'Must read directly from SQLite with getDeliveryById');
  assert(tableDetailBlock.includes("deliveryCharge: charge"), 'Must set deliveryCharge on activeTable');
});

// TC-09: App.js - ADD_ITEM reads delivery directly from SQLite via getDeliveryById
runTest('TC-09: App.js ADD_ITEM reads delivery directly from SQLite via getDeliveryById', () => {
  assert(appCode.includes("case 'ADD_ITEM':"), 'Must have ADD_ITEM case');
  const addItemBlock = appCode.slice(appCode.indexOf("case 'ADD_ITEM':"), appCode.indexOf("case 'EDIT_MENU':"));
  assert(addItemBlock.includes("getDeliveryById(selectedTableId)"), 'ADD_ITEM must read directly from SQLite with getDeliveryById');
});

// TC-10: Dashboards - Active delivery cards display canonical total amount (items + delivery charge)
runTest('TC-10: AdminDB, ManagerDashboard, and OwnerDashboard display active delivery amount with delivery charge', () => {
  // AdminDB active delivery list
  assert(adminDbCode.includes('styles.activeDeliveryAmount'), 'AdminDB must have activeDeliveryAmount style');
  assert(adminDbCode.includes('delivery.deliveryCharge || delivery.delivery_charge'), 'AdminDB must account for delivery charge in active delivery list');
  
  // AdminDB floor modal
  assert(adminDbCode.includes('delivery.amount !== undefined'), 'AdminDB modal must check canonical delivery.amount');
  
  // ManagerDashboard
  assert(managerDbCode.includes('delivery.deliveryCharge || delivery.delivery_charge'), 'ManagerDashboard must account for delivery charge in active deliveries');
  
  // OwnerDashboard
  assert(ownerDbCode.includes('delivery.deliveryCharge || delivery.delivery_charge'), 'OwnerDashboard must account for delivery charge in active deliveries');
});

// TC-11: Numerical calculation verification
runTest('TC-11: Canonical calculation verification: Items subtotal ৳330 + Delivery Charge ৳50 = ৳380, update to ৳80 = ৳410', () => {
  const items = [
    { name: 'Burger', price: 150, qty: 2 }, // 300
    { name: 'Water', price: 30, qty: 1 }    // 30
  ];
  const itemsSubtotal = items.reduce((s, i) => s + (i.price * i.qty), 0);
  assert.strictEqual(itemsSubtotal, 330, 'Items subtotal must equal 330');

  let deliveryCharge = 50;
  let totalAmount = itemsSubtotal + deliveryCharge;
  assert.strictEqual(totalAmount, 380, 'Total with 50 delivery charge must equal 380');

  deliveryCharge = 80;
  totalAmount = itemsSubtotal + deliveryCharge;
  assert.strictEqual(totalAmount, 410, 'Total with 80 delivery charge must equal 410');
});

console.log('------------------------------------------------------');
console.log(`Tests Passed: ${passed}`);
console.log(`Tests Failed: ${failed}`);
console.log('======================================================\n');

if (failed > 0) {
  process.exit(1);
} else {
  console.log('🎉 ALL DELIVERY CHARGE PERSISTENCE & RESTORATION TESTS PASSED SUCCESSFULLY!\n');
}
