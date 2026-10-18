/**
 * tests/printerService.test.js
 * 
 * Verification suite for 58mm ESC/POS Thermal Receipt Printing Service (Web Bluetooth API)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  formatReceiptText,
  normalizeOrderForReceipt,
  parseOrderItems,
  isPrinterConnected,
  autoPrintReceiptIfConnected,
  printReceipt,
  PRINTER_SERVICES
} = require('../services/printerService');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌  ${name}: ${err.message}`);
    failed++;
  }
}

console.log('======================================================');
console.log('   58MM ESC/POS RECEIPT PRINTER — VERIFICATION SUITE  ');
console.log('======================================================\n');

test('parseOrderItems: correctly parses array of items', () => {
  const order = {
    items: [
      { name: 'চিকেন বার্গার', qty: 2, price: 150 },
      { name: 'কোল্ড কফি', qty: 1, price: 100 }
    ]
  };
  const parsed = parseOrderItems(order);
  assert.strictEqual(parsed.length, 2);
  assert.strictEqual(parsed[0].name, 'চিকেন বার্গার');
  assert.strictEqual(parsed[0].qty, 2);
  assert.strictEqual(parsed[0].price, 150);
  assert.strictEqual(parsed[0].total, 300);
});

test('parseOrderItems: correctly parses comma-separated string format', () => {
  const order = {
    items: 'Burger x2 @120, Pizza x1 @350, Coke x3 @40'
  };
  const parsed = parseOrderItems(order);
  assert.strictEqual(parsed.length, 3);
  assert.strictEqual(parsed[0].name, 'Burger');
  assert.strictEqual(parsed[0].qty, 2);
  assert.strictEqual(parsed[0].price, 120);
  assert.strictEqual(parsed[0].total, 240);
  assert.strictEqual(parsed[1].name, 'Pizza');
  assert.strictEqual(parsed[1].total, 350);
});

test('normalizeOrderForReceipt: formats standard order correctly', () => {
  const order = {
    tableId: 'T-01',
    fullDate: '2026-09-22',
    time: '08:30 PM',
    items: 'Burger x2 @150',
    totalAmount: 300,
    paidAmount: 300,
    method: 'bKash'
  };
  const norm = normalizeOrderForReceipt(order);
  assert.strictEqual(norm.tableName, 'T-01');
  assert.strictEqual(norm.date, '2026-09-22');
  assert.strictEqual(norm.time, '08:30 PM');
  assert.strictEqual(norm.subtotal, 300);
  assert.strictEqual(norm.finalAmount, 300);
  assert.strictEqual(norm.paymentMethod, 'bKash');
  assert.strictEqual(norm.discount, 0);
});

test('normalizeOrderForReceipt: computes discount and delivery charge correctly', () => {
  const order = {
    tableId: 'D-05',
    fullDate: '2026-09-15', // Past date works anytime!
    time: '02:15 PM',
    items: 'Pizza x1 @500',
    totalAmount: 500,
    deliveryCharge: 60,
    paidAmount: 500, // 560 - 500 = 60 discount
    method: 'Cash'
  };
  const norm = normalizeOrderForReceipt(order);
  assert.strictEqual(norm.subtotal, 500);
  assert.strictEqual(norm.deliveryCharge, 60);
  assert.strictEqual(norm.discount, 60);
  assert.strictEqual(norm.finalAmount, 500);
});

test('formatReceiptText: generates exact required 58mm layout', () => {
  const order = {
    tableId: 'টেবিল-১',
    fullDate: '2026-09-22',
    time: '09:00 PM',
    items: 'চিকেন ফ্রাই x2 @120',
    totalAmount: 240,
    paidAmount: 240,
    method: 'নগদ'
  };
  const receipt = formatReceiptText(order);
  
  assert.ok(receipt.includes('--------------------------------'));
  assert.ok(receipt.includes('রংধনু ক্যাফে এন্ড রেস্টুরেন্ট'));
  assert.ok(receipt.includes('পুলিশ মোড়, দুর্গাপুর, নেত্রকোনা'));
  assert.ok(receipt.includes('মোবাইল: 01953838244'));
  assert.ok(receipt.includes('টেবিল: টেবিল-১'));
  assert.ok(receipt.includes('তারিখ: ২০২৬-০৯-২২  সময়: ০৯:০০ PM'));
  assert.ok(receipt.includes('চিকেন ফ্রাই'));
  assert.ok(receipt.includes('২ × ১২০'));
  assert.ok(receipt.includes('৳২৪০'));
  assert.ok(receipt.includes('সর্বমোট:'));
  assert.ok(receipt.includes('পরিশোধ:'));
  assert.ok(receipt.includes('পেমেন্ট:'));
  assert.ok(receipt.includes('ধন্যবাদ, আবার আসবেন!'));
  assert.strictEqual(receipt.includes('🙏'), false);
});

test('Zero window.print() and zero expo-print in printerService.js', () => {
  const code = fs.readFileSync(path.join(__dirname, '../services/printerService.js'), 'utf8');
  assert.strictEqual(code.includes('window.print'), false, 'window.print() must NOT exist in printerService.js');
  assert.strictEqual(code.includes('expo-print'), false, 'expo-print must NOT be imported or used in printerService.js');
  assert.ok(code.includes('navigator.bluetooth'), 'Must use Web Bluetooth API');
  assert.ok(code.includes('PRINTER_SERVICES'), 'Must define PRINTER_SERVICES');
});

test('Toast message says "প্রিন্টার কানেক্ট করুন"', () => {
  const code = fs.readFileSync(path.join(__dirname, '../services/printerService.js'), 'utf8');
  assert.ok(code.includes('প্রিন্টার কানেক্ট করুন'), 'Must show toast: "প্রিন্টার কানেক্ট করুন"');
});

test('autoPrintReceiptIfConnected: passes gracefully when not connected without throwing dialog', async () => {
  assert.strictEqual(isPrinterConnected(), false);
  const result = await autoPrintReceiptIfConnected({ tableId: 'T-1', totalAmount: 100 });
  assert.strictEqual(result.success, false);
});

test('Works anytime, any date: historical orders from 3 days or 1 month ago format smoothly', () => {
  const oldOrder = {
    id: 'old_order_123',
    tableId: 'VIP-1',
    created_at: '2026-08-01T12:00:00Z',
    fullDate: '2026-08-01',
    time: '01:30 PM',
    items: 'Fried Rice x3 @220',
    totalAmount: 660,
    paidAmount: 660,
    paymentMethod: 'bKash'
  };
  const text = formatReceiptText(oldOrder);
  assert.ok(text.includes('VIP-১'));
  assert.ok(text.includes('২০২৬-০৮-০১'));
  assert.ok(text.includes('৳৬৬০'));
});

test('Split payment breakdown: formats breakdown details for multi-method payments', () => {
  const splitOrder = {
    tableId: 'T-05',
    fullDate: '2026-09-23',
    time: '12:30 AM',
    items: 'চিকেন বার্গার x2 @150, কোল্ড কফি x1 @100',
    totalAmount: 400,
    paidAmount: 400,
    method: 'Split',
    cashAmount: 250,
    bkashAmount: 150
  };
  const norm = normalizeOrderForReceipt(splitOrder);
  assert.strictEqual(norm.isSplit, true);
  assert.strictEqual(norm.paymentMethod, 'স্প্লিট');
  assert.strictEqual(norm.splitBreakdown.length, 2);
  assert.strictEqual(norm.splitBreakdown[0].label, 'ক্যাশ:');
  assert.strictEqual(norm.splitBreakdown[0].amount, 250);
  assert.strictEqual(norm.splitBreakdown[1].label, 'বিকাশ:');
  assert.strictEqual(norm.splitBreakdown[1].amount, 150);

  const text = formatReceiptText(splitOrder);
  assert.ok(text.includes('পেমেন্ট:'));
  assert.ok(text.includes('স্প্লিট'));
  assert.ok(text.includes('ক্যাশ:'));
  assert.ok(text.includes('৳২৫০'));
  assert.ok(text.includes('বিকাশ:'));
  assert.ok(text.includes('৳১৫০'));
});

test('parseOrderItems & receipt: "পানি" (Water) is always placed at the very end of items', () => {
  const orderWithWaterFirst = {
    tableId: 'T-02',
    fullDate: '2026-09-23',
    time: '01:00 AM',
    items: [
      { name: 'পানি', qty: 2, price: 20 },
      { name: 'চিকেন বার্গার', qty: 1, price: 180 },
      { name: 'কোল্ড কফি', qty: 1, price: 100 }
    ],
    totalAmount: 320,
    paidAmount: 320,
    method: 'Cash'
  };
  const parsed = parseOrderItems(orderWithWaterFirst);
  assert.strictEqual(parsed.length, 3);
  assert.strictEqual(parsed[0].name, 'চিকেন বার্গার');
  assert.strictEqual(parsed[1].name, 'কোল্ড কফি');
  assert.strictEqual(parsed[2].name, 'পানি');

  const text = formatReceiptText(orderWithWaterFirst);
  const burgerIdx = text.indexOf('চিকেন বার্গার');
  const coffeeIdx = text.indexOf('কোল্ড কফি');
  const waterIdx = text.indexOf('পানি');
  assert.ok(burgerIdx !== -1 && coffeeIdx !== -1 && waterIdx !== -1);
  assert.ok(waterIdx > burgerIdx, '"পানি" must come after other items');
  assert.ok(waterIdx > coffeeIdx, '"পানি" must come after other items');
});

// ── Thermal boldness (print clarity) ────────────────────────────────────────
test('web ESC/POS raster: every glyph is filled AND stroked (bold), not just filled', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'printerService.js'), 'utf8');
  assert.ok(src.includes('const drawText = (text, x, posY) =>'), 'drawText helper exists');
  assert.ok(src.includes('ctx.strokeText(text, x, posY)'), 'glyphs are stroked for thickness');
  // Assert the intent (stroke scales with font size), not a frozen literal, so
  // future boldness tuning does not break the suite.
  assert.ok(/ctx\.lineWidth = Math\.max\([\d.]+, size \* [\d.]+\)/.test(src), 'stroke width scales with font size');
  assert.ok(!src.includes('ctx.fillText(\'রংধনু'), 'title goes through drawText (bold)');
  assert.ok(src.includes('INK_THRESHOLD = 200'), 'permissive ink threshold keeps glyph edges');
});

test('native receipt paper: every text style carries the thermal-bold outline', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'components', 'ReceiptPaper.js'), 'utf8');
  assert.ok(src.includes('const THERMAL_BOLD = {'), 'THERMAL_BOLD defined');
  assert.ok(/textShadowRadius: [\d.]+/.test(src), 'hairline same-colour outline used to thicken glyphs');
  assert.ok(src.includes('const T = (style) => ({ ...style, ...THERMAL_BOLD })'), 'all text styles go through T()');

  // No text style may be left un-boldened.
  const textStyles = ['title', 'center', 'centerBold', 'row', 'bold', 'metaText', 'itemName',
    'itemQtyPrice', 'itemPrice', 'summaryLabel', 'summaryPrice', 'totalLabel', 'totalPrice',
    'paymentLabel', 'paymentValue', 'footer', 'splitSubLabel', 'splitSubAmount'];
  for (const name of textStyles) {
    assert.ok(new RegExp(`\\b${name}: T\\(\\{`).test(src), `${name} uses T() — i.e. is boldened`);
  }
});

// ── Reprinting (manual press must always print) ──────────────────────────────
test('manual print always reprints: PrintReceiptModal forces and never auto-closes', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'components', 'PrintReceiptModal.js'), 'utf8');
  assert.ok(src.includes('printReceipt(orderToPrint, { getBase64, force: true })'), 'manual press bypasses the duplicate guard');
  assert.ok(!src.includes('setTimeout(() => { if (onClose) onClose(); }'), 'modal must stay open so another copy can be printed');
  assert.ok(src.includes('আরেক কপি প্রিন্ট করুন'), 'button offers another copy after a successful print');
  assert.ok(src.includes('setCopies((c) => c + 1)'), 'copies are counted');
});

test('auto print stays deduped so one order never prints twice by itself', () => {
  const auto = fs.readFileSync(path.join(__dirname, '..', 'components', 'AutoReceiptPrinter.js'), 'utf8');
  assert.ok(auto.includes('printReceipt(order, { getBase64: async () => base64 })'), 'auto path does not force');
  assert.ok(!/force:\s*true/.test(auto), 'auto path must keep the duplicate guard');
});

(async () => {
  console.log('\n------------------------------------------------------');
  console.log(`Tests Passed: ${passed}`);
  console.log(`Tests Failed: ${failed}`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
})();
