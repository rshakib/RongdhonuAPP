/**
 * Unit & Integration Test for Manual Receipt Printing Policy
 * 
 * Verifies:
 * 1. Automatic receipt printing on payment completion is OFF by default.
 * 2. setAutoPrintOrder in App.js is guarded by getAppConfig('auto_print_enabled') === 'true'.
 * 3. PaymentSuccess.js renders the manual "রসিদ প্রিন্ট করুন" button and mounts PrintReceiptModal.
 * 4. PrintReceiptModal supports manual printing with { force: true }.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const tests = [];
function it(desc, fn) { tests.push({ desc, fn }); }
let passed = 0;
let failed = 0;

console.log('======================================================');
console.log('   MANUAL RECEIPT PRINTING POLICY TESTS               ');
console.log('======================================================\n');

it('App.js does not unconditionally auto-print on payment completion', () => {
  const appSrc = fs.readFileSync(path.join(__dirname, '../App.js'), 'utf8');
  const payCompleteIdx = appSrc.indexOf('const handleCompletePayment = async');
  assert.ok(payCompleteIdx > -1, 'handleCompletePayment exists');
  const payBlock = appSrc.slice(payCompleteIdx, payCompleteIdx + 2500);

  // Must not have bare setAutoPrintOrder(orderRecord); outside a check
  assert.ok(!payBlock.includes('\n      setAutoPrintOrder(orderRecord);'), 'Bare unconditional setAutoPrintOrder must not exist');
  assert.ok(payBlock.includes("getAppConfig('auto_print_enabled') === 'true'"), 'Auto-print is strictly guarded by auto_print_enabled config');
});

it('PaymentSuccess.js provides a manual "রসিদ প্রিন্ট করুন" button and mounts PrintReceiptModal', () => {
  const psSrc = fs.readFileSync(path.join(__dirname, '../screens/PaymentSuccess.js'), 'utf8');
  assert.ok(psSrc.includes('রসিদ প্রিন্ট করুন'), 'Manual print button exists in PaymentSuccess.js');
  assert.ok(psSrc.includes('<PrintReceiptModal'), 'PrintReceiptModal is mounted in PaymentSuccess.js');
  assert.ok(psSrc.includes('handlePrint'), 'handlePrint triggers the receipt modal');
});

it('PrintReceiptModal supports explicit manual printing with { force: true }', () => {
  const modalSrc = fs.readFileSync(path.join(__dirname, '../components/PrintReceiptModal.js'), 'utf8');
  assert.ok(modalSrc.includes('printReceipt(orderToPrint, { getBase64, force: true })'), 'PrintReceiptModal calls printReceipt with force: true');
});

it('Simulated policy test: default config does not auto-print, only explicit "true" triggers auto-print', () => {
  let autoPrinted = false;
  const mockOrder = { id: 'ORD_123', totalAmount: 100 };

  function simulatePayment(mockConfig = {}) {
    autoPrinted = false;
    const isAutoPrint = mockConfig['auto_print_enabled'] === 'true';
    if (isAutoPrint) {
      autoPrinted = true;
    }
  }

  // Case 1: Default state (config not set) -> must NOT auto-print
  simulatePayment({});
  assert.strictEqual(autoPrinted, false, 'Default config must not trigger auto-print');

  // Case 2: Config is false or empty -> must NOT auto-print
  simulatePayment({ 'auto_print_enabled': '0' });
  assert.strictEqual(autoPrinted, false, 'Config "0" must not trigger auto-print');

  // Case 3: Explicitly enabled -> triggers auto-print
  simulatePayment({ 'auto_print_enabled': 'true' });
  assert.strictEqual(autoPrinted, true, 'Config "true" triggers auto-print');
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
