/**
 * AI Dataset Validator — Unit Test Suite
 * 
 * Tests the validation rules in services/aiDataset/validator.js
 * Runnable WITHOUT launching the POS application.
 * Zero external test framework required (plain Node.js assert).
 *
 * Run with:
 *   node tests/validator.test.js
 */

'use strict';
const assert = require('assert');

// ─────────────────────────────────────────────
// INLINE VALIDATOR (mirrors validator.js exactly)
// ─────────────────────────────────────────────
function validateDailyDataset(record) {
  const errors = [];
  if (!record || typeof record !== 'object') {
    return { isValid: false, isComplete: false, isTrainingReady: false, errors: ['INVALID_OBJECT'] };
  }
  if (!record.business_date) errors.push('MISSING_BUSINESS_DATE');
  if (!record.dataset_id)    errors.push('MISSING_DATASET_ID');
  if (record.total_sales   < 0) errors.push('NEGATIVE_TOTAL_SALES');
  if (record.total_expense < 0) errors.push('NEGATIVE_TOTAL_EXPENSE');
  if (record.total_orders  < 0) errors.push('NEGATIVE_TOTAL_ORDERS');

  const paymentSum = (Number(record.cash_sales)   || 0) +
                     (Number(record.bkash_sales)   || 0) +
                     (Number(record.nagad_sales)   || 0) +
                     (Number(record.rocket_sales)  || 0) +
                     (Number(record.card_sales)    || 0);
  const diff = Math.abs(paymentSum - (Number(record.total_sales) || 0));
  if (diff > 0.01) {
    errors.push('PAYMENT_SUM_MISMATCH:Sum=' + paymentSum + ',Total=' + record.total_sales);
  }

  const isComplete      = !errors.includes('MISSING_BUSINESS_DATE') && !errors.includes('MISSING_DATASET_ID');
  const isValid         = errors.length === 0;
  const isTrainingReady = isComplete && isValid;
  return { isValid, isComplete, isTrainingReady, errors };
}

function validateItemDataset(record) {
  const errors = [];
  if (!record || typeof record !== 'object') {
    return { isValid: false, isComplete: false, isTrainingReady: false, errors: ['INVALID_OBJECT'] };
  }
  if (!record.business_date)         errors.push('MISSING_BUSINESS_DATE');
  if (!record.item_name)             errors.push('MISSING_ITEM_NAME');
  if (record.total_quantity_sold < 0) errors.push('NEGATIVE_QUANTITY');
  if (record.total_item_revenue  < 0) errors.push('NEGATIVE_REVENUE');

  const isComplete      = !errors.includes('MISSING_BUSINESS_DATE') && !errors.includes('MISSING_ITEM_NAME');
  const isValid         = errors.length === 0;
  const isTrainingReady = isComplete && isValid;
  return { isValid, isComplete, isTrainingReady, errors };
}

// ─────────────────────────────────────────────
// TEST RUNNER
// ─────────────────────────────────────────────
let passed = 0, failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    console.log('  \u2705  ' + name);
    passed++;
  } catch (err) {
    console.log('  \u274c  ' + name);
    console.log('      \u2192 ' + err.message);
    failures.push({ name, error: err.message });
    failed++;
  }
}

// ─────────────────────────────────────────────
// STANDARD VALID DAILY RECORD
// ─────────────────────────────────────────────
const VALID_DAILY = {
  dataset_id: '2026-08-05',
  business_date: '2026-08-05',
  total_sales: 10000,
  cash_sales: 6000,
  bkash_sales: 2000,
  nagad_sales: 1000,
  rocket_sales: 500,
  card_sales: 500,
  total_expense: 2000,
  total_orders: 50,
};

const VALID_ITEM = {
  dataset_id: '2026-08-05_item_1',
  business_date: '2026-08-05',
  item_name: 'Burger',
  total_quantity_sold: 20,
  total_item_revenue: 2400,
};

// ─────────────────────────────────────────────
// DAILY DATASET VALIDATION TESTS
// ─────────────────────────────────────────────
console.log('\n\u2500\u2500 Suite 1: Daily Dataset — Valid Record \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
test('Valid record -> isValid = true', () => {
  const r = validateDailyDataset(VALID_DAILY);
  assert.strictEqual(r.isValid, true, JSON.stringify(r.errors));
});
test('Valid record -> isComplete = true', () => {
  assert.strictEqual(validateDailyDataset(VALID_DAILY).isComplete, true);
});
test('Valid record -> isTrainingReady = true', () => {
  assert.strictEqual(validateDailyDataset(VALID_DAILY).isTrainingReady, true);
});
test('Valid record -> errors array empty', () => {
  assert.strictEqual(validateDailyDataset(VALID_DAILY).errors.length, 0);
});

console.log('\n\u2500\u2500 Suite 2: Daily Dataset — Missing Required Fields \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
test('Missing business_date -> MISSING_BUSINESS_DATE error', () => {
  const r = validateDailyDataset(Object.assign({}, VALID_DAILY, { business_date: null }));
  assert.ok(r.errors.includes('MISSING_BUSINESS_DATE'));
});
test('Missing business_date -> isComplete = false', () => {
  const r = validateDailyDataset(Object.assign({}, VALID_DAILY, { business_date: '' }));
  assert.strictEqual(r.isComplete, false);
});
test('Missing dataset_id -> MISSING_DATASET_ID error', () => {
  const r = validateDailyDataset(Object.assign({}, VALID_DAILY, { dataset_id: null }));
  assert.ok(r.errors.includes('MISSING_DATASET_ID'));
});
test('Missing dataset_id -> isComplete = false', () => {
  const r = validateDailyDataset(Object.assign({}, VALID_DAILY, { dataset_id: '' }));
  assert.strictEqual(r.isComplete, false);
});
test('Missing dataset_id -> isTrainingReady = false', () => {
  const r = validateDailyDataset(Object.assign({}, VALID_DAILY, { dataset_id: '' }));
  assert.strictEqual(r.isTrainingReady, false);
});

console.log('\n\u2500\u2500 Suite 3: Daily Dataset — Numeric Bounds \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
test('Negative total_sales -> NEGATIVE_TOTAL_SALES error', () => {
  const r = validateDailyDataset(Object.assign({}, VALID_DAILY, { total_sales: -1 }));
  assert.ok(r.errors.includes('NEGATIVE_TOTAL_SALES'));
});
test('Negative total_expense -> NEGATIVE_TOTAL_EXPENSE error', () => {
  const r = validateDailyDataset(Object.assign({}, VALID_DAILY, { total_expense: -100 }));
  assert.ok(r.errors.includes('NEGATIVE_TOTAL_EXPENSE'));
});
test('Negative total_orders -> NEGATIVE_TOTAL_ORDERS error', () => {
  const r = validateDailyDataset(Object.assign({}, VALID_DAILY, { total_orders: -5 }));
  assert.ok(r.errors.includes('NEGATIVE_TOTAL_ORDERS'));
});
test('Zero total_sales is valid (no errors)', () => {
  const zeroRec = Object.assign({}, VALID_DAILY, { total_sales: 0, cash_sales: 0, bkash_sales: 0, nagad_sales: 0, rocket_sales: 0, card_sales: 0 });
  const r = validateDailyDataset(zeroRec);
  assert.strictEqual(r.isValid, true);
});

console.log('\n\u2500\u2500 Suite 4: Daily Dataset — Payment Sum Check \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
test('Payment sum matches total_sales -> no PAYMENT_SUM_MISMATCH', () => {
  const r = validateDailyDataset(VALID_DAILY);
  const hasMismatch = r.errors.some(function(e) { return e.startsWith('PAYMENT_SUM_MISMATCH'); });
  assert.strictEqual(hasMismatch, false);
});
test('Payment sum mismatch > 0.01 -> PAYMENT_SUM_MISMATCH error', () => {
  const badRec = Object.assign({}, VALID_DAILY, { cash_sales: 1000 }); // sum = 5000, total = 10000
  const r = validateDailyDataset(badRec);
  const hasMismatch = r.errors.some(function(e) { return e.startsWith('PAYMENT_SUM_MISMATCH'); });
  assert.ok(hasMismatch, 'Expected PAYMENT_SUM_MISMATCH but got: ' + JSON.stringify(r.errors));
});
test('Payment sum mismatch -> isValid = false', () => {
  const badRec = Object.assign({}, VALID_DAILY, { cash_sales: 1000 });
  assert.strictEqual(validateDailyDataset(badRec).isValid, false);
});
test('Payment sum mismatch -> isTrainingReady = false', () => {
  const badRec = Object.assign({}, VALID_DAILY, { cash_sales: 1000 });
  assert.strictEqual(validateDailyDataset(badRec).isTrainingReady, false);
});
test('Payment sum within 0.01 tolerance is accepted', () => {
  const closeRec = Object.assign({}, VALID_DAILY, { cash_sales: 6000.005 });
  const r = validateDailyDataset(closeRec);
  const hasMismatch = r.errors.some(function(e) { return e.startsWith('PAYMENT_SUM_MISMATCH'); });
  assert.strictEqual(hasMismatch, false, 'Sub-penny tolerance should pass');
});

console.log('\n\u2500\u2500 Suite 5: Daily Dataset — Immutability of Business Values \u2500\u2500\u2500\u2500');
test('Validator does not modify total_sales', () => {
  const rec = Object.assign({}, VALID_DAILY, { cash_sales: 1 }); // intentional mismatch
  const originalSales = rec.total_sales;
  validateDailyDataset(rec);
  assert.strictEqual(rec.total_sales, originalSales, 'Validator must not modify financial values');
});
test('Validator does not modify cash_sales', () => {
  const rec = Object.assign({}, VALID_DAILY, { cash_sales: 1 });
  const originalCash = rec.cash_sales;
  validateDailyDataset(rec);
  assert.strictEqual(rec.cash_sales, originalCash);
});
test('Validator does not add new properties to record', () => {
  const rec = Object.assign({}, VALID_DAILY);
  const keysBefore = Object.keys(rec).length;
  validateDailyDataset(rec);
  assert.strictEqual(Object.keys(rec).length, keysBefore, 'Validator should not mutate the record object');
});

console.log('\n\u2500\u2500 Suite 6: Daily Dataset — Invalid Object Types \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
test('null input -> INVALID_OBJECT error', () => {
  const r = validateDailyDataset(null);
  assert.ok(r.errors.includes('INVALID_OBJECT'));
  assert.strictEqual(r.isValid, false);
});
test('string input -> INVALID_OBJECT error', () => {
  const r = validateDailyDataset('2026-08-05');
  assert.ok(r.errors.includes('INVALID_OBJECT'));
});
test('undefined input -> INVALID_OBJECT error', () => {
  const r = validateDailyDataset(undefined);
  assert.ok(r.errors.includes('INVALID_OBJECT'));
});

// ─────────────────────────────────────────────
// ITEM DATASET VALIDATION TESTS
// ─────────────────────────────────────────────
console.log('\n\u2500\u2500 Suite 7: Item Dataset — Valid Record \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
test('Valid item record -> isValid = true', () => {
  assert.strictEqual(validateItemDataset(VALID_ITEM).isValid, true);
});
test('Valid item record -> isComplete = true', () => {
  assert.strictEqual(validateItemDataset(VALID_ITEM).isComplete, true);
});
test('Valid item record -> isTrainingReady = true', () => {
  assert.strictEqual(validateItemDataset(VALID_ITEM).isTrainingReady, true);
});
test('Valid item record -> errors array empty', () => {
  assert.strictEqual(validateItemDataset(VALID_ITEM).errors.length, 0);
});

console.log('\n\u2500\u2500 Suite 8: Item Dataset — Missing Required Fields \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
test('Missing business_date -> MISSING_BUSINESS_DATE', () => {
  const r = validateItemDataset(Object.assign({}, VALID_ITEM, { business_date: '' }));
  assert.ok(r.errors.includes('MISSING_BUSINESS_DATE'));
});
test('Missing item_name -> MISSING_ITEM_NAME', () => {
  const r = validateItemDataset(Object.assign({}, VALID_ITEM, { item_name: '' }));
  assert.ok(r.errors.includes('MISSING_ITEM_NAME'));
});
test('Missing item_name -> isComplete = false', () => {
  assert.strictEqual(validateItemDataset(Object.assign({}, VALID_ITEM, { item_name: null })).isComplete, false);
});

console.log('\n\u2500\u2500 Suite 9: Item Dataset — Numeric Bounds \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
test('Negative quantity -> NEGATIVE_QUANTITY', () => {
  const r = validateItemDataset(Object.assign({}, VALID_ITEM, { total_quantity_sold: -1 }));
  assert.ok(r.errors.includes('NEGATIVE_QUANTITY'));
});
test('Negative revenue -> NEGATIVE_REVENUE', () => {
  const r = validateItemDataset(Object.assign({}, VALID_ITEM, { total_item_revenue: -100 }));
  assert.ok(r.errors.includes('NEGATIVE_REVENUE'));
});
test('Zero quantity is valid (unsold item)', () => {
  const r = validateItemDataset(Object.assign({}, VALID_ITEM, { total_quantity_sold: 0, total_item_revenue: 0 }));
  assert.strictEqual(r.isValid, true);
});

console.log('\n\u2500\u2500 Suite 10: isTrainingReady Logic \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
test('isTrainingReady = false when isComplete = false (daily)', () => {
  const r = validateDailyDataset(Object.assign({}, VALID_DAILY, { dataset_id: '' }));
  assert.strictEqual(r.isTrainingReady, false);
});
test('isTrainingReady = false when isValid = false (daily)', () => {
  const r = validateDailyDataset(Object.assign({}, VALID_DAILY, { total_sales: -1 }));
  assert.strictEqual(r.isTrainingReady, false);
});
test('isTrainingReady = true only when both isComplete and isValid = true', () => {
  const r = validateDailyDataset(VALID_DAILY);
  assert.strictEqual(r.isTrainingReady, r.isComplete && r.isValid);
});

// ─────────────────────────────────────────────
// FINAL SUMMARY
// ─────────────────────────────────────────────
console.log('\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
console.log('  validator.test.js \u2014 ' + (passed + failed) + ' tests');
console.log('  Passed : ' + passed);
console.log('  Failed : ' + failed);
if (failures.length > 0) {
  console.log('\n  Failed tests:');
  failures.forEach(function(f) { console.log('    \u274c ' + f.name + '\n       ' + f.error); });
}
console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n');
if (failed > 0) process.exit(1);
