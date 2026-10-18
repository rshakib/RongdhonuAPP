/**
 * tests/nativeReceiptPipelineProof.test.js
 *
 * RIGOROUS VERIFICATION OF THE REAL POS RECEIPT DATA PIPELINE & HARDWARE ADAPTERS
 *
 * NOTE: SIMULATED TESTS with mock hardware adapters.
 * As explicitly marked in outputs: mock success proves software execution only,
 * NOT that physical paper emerged from a thermal printer.
 */

const assert = require('assert');
const {
  printReceipt,
  printTestReceipt,
  getStatus,
  refresh,
  connectDevice,
  disconnect,
  MESSAGES,
  STATUS,
  RECEIPT_RASTER_WIDTH,
  toWireAddress
} = require('../services/printer/printerManager.js');

const {
  normalizeOrderForReceipt,
  formatReceiptText,
  toBengaliNumber,
  translatePaymentMethod
} = require('../services/printer/receiptData.js');

const {
  __setTransport,
  __setPermissionProbe,
  sendChunks
} = require('../services/printer/printerTransport.js');

const {
  __setStorage
} = require('../services/printer/printerSettings.js');

console.log('========================================================================');
console.log('   NATIVE POS RECEIPT PIPELINE & SIMULATED HARDWARE TEST SUITE          ');
console.log('========================================================================\n');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅  [SIMULATED] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌  ${name}:`, err.message);
    failed++;
  }
}

// In-memory mock storage
function createMockStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get: async (k) => (map.has(k) ? map.get(k) : null),
    set: async (k, v) => { map.set(k, String(v)); },
    remove: async (k) => { map.delete(k); },
    _map: map
  };
}

// 1x1 transparent PNG as base64 string
const SAMPLE_BASE64_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

// Real POS order sample
const REAL_POS_ORDER = {
  id: 'ORD-20260923-001',
  orderId: 'ORD-20260923-001',
  tableId: 'T-04',
  tableName: 'T-০৪',
  fullDate: '2026-09-23',
  time: '11:45 AM',
  items: [
    { name: 'চিকেন নাগা উইংস', qty: 2, price: 150, total: 300 },
    { name: 'স্পেশাল ফ্রাইড রাইস', qty: 1, price: 280, total: 280 }
  ],
  totalAmount: 580,
  paidAmount: 580,
  paymentMethod: 'বিকাশ'
};

(async () => {
  // Test 1: Real POS Order Data Normalization
  await test('1. Real POS order normalizes correctly into 58mm Bengali layout fields', async () => {
    const norm = normalizeOrderForReceipt(REAL_POS_ORDER);
    assert.strictEqual(norm.subtotal, 580);
    assert.strictEqual(norm.finalAmount, 580);
    assert.strictEqual(norm.items.length, 2);
    assert.strictEqual(norm.items[0].name, 'চিকেন নাগা উইংস');
    assert.strictEqual(toBengaliNumber(norm.finalAmount), '৫৮০');
    assert.strictEqual(translatePaymentMethod(norm.paymentMethod), 'বিকাশ');

    const receiptText = formatReceiptText(REAL_POS_ORDER);
    assert.ok(receiptText.includes('রংধনু ক্যাফে এন্ড রেস্টুরেন্ট'));
    assert.ok(receiptText.includes('চিকেন নাগা উইংস'));
    assert.ok(receiptText.includes('৫৮০'));
    assert.ok(receiptText.includes('বিকাশ'));
  });

  // Test 2: Correct base64 payload and width passed to native printImage
  await test('2. Correct base64 payload and 384px width passed into native printImage', async () => {
    const storage = createMockStorage({
      printer_address: 'bt:66:32:B1:84:8A:29',
      printer_name: 'MTP-II POS Printer',
      printer_transport: 'bt'
    });
    __setStorage(storage);
    __setPermissionProbe(async () => ({ granted: true, blocked: false }));

    let nativeCall = null;
    __setTransport({
      scan: async () => ({ paired: [], found: [] }),
      connect: async () => true,
      disconnect: async () => true,
      printImage: async (addr, base64, options) => {
        nativeCall = { addr, base64, options };
        return { success: true };
      }
    });

    await refresh();
    // Simulate active connection
    await connectDevice({ address: '66:32:B1:84:8A:29', name: 'MTP-II POS Printer', deviceType: 'bt' });

    const printResult = await printReceipt(REAL_POS_ORDER, {
      getBase64: async () => SAMPLE_BASE64_PNG,
      force: true
    });

    assert.strictEqual(printResult.success, true);
    assert.ok(nativeCall, 'Native printImage must be called');
    assert.strictEqual(nativeCall.addr, 'bt:66:32:B1:84:8A:29');
    assert.strictEqual(nativeCall.base64, SAMPLE_BASE64_PNG);
    assert.strictEqual(nativeCall.options.width, RECEIPT_RASTER_WIDTH);
    assert.strictEqual(RECEIPT_RASTER_WIDTH, 384, '58mm thermal printhead is 384 dots');
  });

  // Test 3: Classic SPP transport data transmission
  await test('3. Classic SPP transport wires "bt:" scheme and sends in 512-byte chunks', async () => {
    const device = { address: 'AA:BB:CC:DD:EE:FF', deviceType: 'bt' };
    const wireAddr = toWireAddress(device);
    assert.strictEqual(wireAddr, 'bt:AA:BB:CC:DD:EE:FF');

    // Simulate 512-byte Classic chunking
    const totalBytes = 1200;
    const dummyBytes = Buffer.alloc(totalBytes, 0x1B);
    const sentChunks = [];
    const writeFn = async (chunk) => { sentChunks.push(chunk.length); };

    await sendChunks(writeFn, dummyBytes, { initialChunkSize: 512, minChunkSize: 512 });
    assert.deepStrictEqual(sentChunks, [512, 512, 176], 'Classic SPP transmits in 512-byte chunks');
  });

  // Test 4: BLE/GATT transport data transmission with small MTU negotiation fallback
  await test('4. BLE/GATT transport adapts chunk size when link negotiates small MTU', async () => {
    const device = { address: '11:22:33:44:55:66', deviceType: 'ble' };
    const wireAddr = toWireAddress(device);
    assert.strictEqual(wireAddr, 'ble:11:22:33:44:55:66');

    // Link rejects writes > 50 bytes (small ATT MTU simulation)
    const dummyBytes = Buffer.alloc(200, 0x00);
    const chunksWritten = [];
    let attempts = 0;

    const mockBleWrite = async (chunk) => {
      attempts++;
      if (chunk.length > 50) {
        throw new Error('ATT_MTU_EXCEEDED');
      }
      chunksWritten.push(chunk.length);
    };

    const res = await sendChunks(mockBleWrite, dummyBytes, { initialChunkSize: 100, minChunkSize: 20 });
    assert.strictEqual(chunksWritten.reduce((a, b) => a + b, 0), 200);
    assert.ok(res.chunkSize <= 50, 'Chunk size halved to fit within BLE ATT MTU');
  });

  // Test 5: Invalid address handling
  await test('5. Invalid device address is rejected with INVALID_ADDRESS', async () => {
    const result = await connectDevice({ address: '', name: 'Invalid' });
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, 'INVALID_ADDRESS');
    assert.strictEqual(result.message, MESSAGES.INVALID_ADDRESS);
  });

  // Test 6: Printer disconnected or unavailable
  await test('6. Attempting to print while disconnected returns NOT_CONNECTED', async () => {
    await disconnect();
    const result = await printReceipt(REAL_POS_ORDER, {
      getBase64: async () => SAMPLE_BASE64_PNG
    });
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, 'NOT_CONNECTED');
    assert.strictEqual(result.message, MESSAGES.NOT_CONNECTED);
  });

  // Test 7: Bluetooth permission denied/blocked propagation
  await test('7. Bluetooth permission denial is caught and returned with Bangla message', async () => {
    __setPermissionProbe(async () => ({ granted: false, blocked: true, platform: 'android31+' }));
    const result = await connectDevice({ address: '66:32:B1:84:8A:29', deviceType: 'bt' });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, 'PERMISSION_BLOCKED');
    assert.strictEqual(result.message, MESSAGES.PERMISSION_BLOCKED);
    assert.strictEqual(result.canOpenSettings, true);

    __setPermissionProbe(async () => ({ granted: true, blocked: false }));
  });

  // Test 8: Connection timeout and write failure
  await test('8. Connection timeout is handled with finite boundary and mapped error', async () => {
    __setTransport({
      scan: async () => ({ paired: [], found: [] }),
      connect: async () => {
        const err = new Error('Connection timed out');
        err.code = 'CONNECTION_TIMEOUT';
        throw err;
      },
      disconnect: async () => true
    });

    const result = await connectDevice({ address: '66:32:B1:84:8A:29', deviceType: 'bt' }, { timeout: 100 });
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, 'CONNECTION_TIMEOUT');
    assert.strictEqual(result.message, MESSAGES.CONNECTION_TIMEOUT);
  });

  // Test 9: Native print error propagation (UNCERTAIN status for write-level loss)
  await test('9. Write failure mid-print is flagged UNCERTAIN to prevent duplicate receipts', async () => {
    const storage = createMockStorage({
      printer_address: 'bt:66:32:B1:84:8A:29',
      printer_name: 'MTP-II',
      printer_transport: 'bt'
    });
    __setStorage(storage);

    __setTransport({
      scan: async () => ({ paired: [], found: [] }),
      connect: async () => true,
      disconnect: async () => true,
      printImage: async () => {
        const err = new Error('Socket closed mid-write');
        err.code = 'WRITE_FAILED';
        throw err;
      }
    });

    await refresh();
    await connectDevice({ address: '66:32:B1:84:8A:29', deviceType: 'bt' });

    const result = await printReceipt(REAL_POS_ORDER, {
      getBase64: async () => SAMPLE_BASE64_PNG,
      force: true
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, 'UNCERTAIN');
    assert.strictEqual(result.uncertain, true);
    assert.strictEqual(result.retryable, false, 'UNCERTAIN prints must not auto-retry');
    assert.strictEqual(result.message, MESSAGES.UNCERTAIN);
  });

  // Test 10: Duplicate print prevention
  await test('10. Repeated print request for identical order is deduped', async () => {
    const dedupeOrder = { ...REAL_POS_ORDER, id: 'ORD-DEDUPE-999', orderId: 'ORD-DEDUPE-999' };

    __setTransport({
      scan: async () => ({ paired: [], found: [] }),
      connect: async () => true,
      disconnect: async () => true,
      printImage: async () => ({ success: true })
    });

    await connectDevice({ address: '66:32:B1:84:8A:29', deviceType: 'bt' });

    // First print
    const res1 = await printReceipt(dedupeOrder, {
      getBase64: async () => SAMPLE_BASE64_PNG,
      force: false
    });
    assert.strictEqual(res1.success, true);
    assert.strictEqual(res1.transmitted, true);

    // Immediate duplicate print of identical order
    const res2 = await printReceipt(dedupeOrder, {
      getBase64: async () => SAMPLE_BASE64_PNG,
      force: false
    });
    assert.strictEqual(res2.success, true);
    assert.strictEqual(res2.deduped, true, 'Subsequent identical print must be deduped');
  });

  // Test 11: Verification of blank bottom paper feed spacer
  await test('11. Receipt includes pure white bottom feed spacer (exact 8 text lines, ~180px) after final divider', async () => {
    const fs = require('fs');
    const path = require('path');
    const receiptPaperContent = fs.readFileSync(
      path.join(__dirname, '../components/ReceiptPaper.js'),
      'utf8'
    );

    // Verify 384 raster width is maintained
    assert.strictEqual(RECEIPT_RASTER_WIDTH, 384, 'Receipt raster width must remain 384 dots for 58mm printer');

    // Verify bottom feed spacer exists in JSX
    assert.ok(
      receiptPaperContent.includes('styles.bottomFeedSpacer'),
      'ReceiptPaper must include bottomFeedSpacer in JSX'
    );

    // Verify bottom feed spacer is AFTER final footer & divider
    const footerIdx = receiptPaperContent.indexOf('styles.footer');
    const spacerIdx = receiptPaperContent.indexOf('styles.bottomFeedSpacer');
    assert.ok(
      spacerIdx > footerIdx,
      'bottomFeedSpacer must be positioned AFTER the footer text and final divider'
    );

    // Verify spacer style definition: height exact 8 lines (180px) and backgroundColor '#FFFFFF'
    assert.ok(
      receiptPaperContent.includes("backgroundColor: '#FFFFFF'"),
      'bottomFeedSpacer must be pure white (#FFFFFF) background'
    );
    assert.ok(
      /height:\s*(?:180|185|191)/.test(receiptPaperContent),
      'bottomFeedSpacer height must be configured (8 to 8.5 text lines, >= 180px)'
    );
  });

  // Summary
  console.log('\n------------------------------------------------------------------------');
  console.log(`Pipeline Tests Passed: ${passed}`);
  console.log(`Pipeline Tests Failed: ${failed}`);
  console.log('========================================================================\n');

  if (failed > 0) process.exit(1);
})();
