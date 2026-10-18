/**
 * tests/printerManager.test.js
 *
 * Headless verification of the native thermal-printer layer.
 *
 * No printer and no Android device are required: the native transport is
 * replaced by an injected mock, and settings are backed by an in-memory store.
 * This proves the LOGIC only — a real physical print still has to be confirmed
 * on the actual printer (see the Printer Settings screen → "Print Test Receipt").
 */

const assert = require('assert');

const transport = require('../services/printer/printerTransport.js');
const settings = require('../services/printer/printerSettings.js');
const manager = require('../services/printer/printerManager.js');
const { formatReceiptText, normalizeOrderForReceipt } = require('../services/printer/receiptData.js');

const { STATUS } = manager;

let passed = 0;
let failed = 0;
const queue = [];

function test(name, fn) {
  queue.push({ name, fn });
}

// ---------- helpers ----------

function makeStorage() {
  const map = new Map();
  return {
    get: (k) => (map.has(k) ? map.get(k) : null),
    set: (k, v) => { map.set(k, String(v)); },
    remove: (k) => { map.delete(k); },
    _map: map
  };
}

function makeTransport(overrides = {}) {
  const calls = { scan: 0, stopScan: 0, connect: 0, disconnect: 0, isConnected: 0, printImage: 0, printRaw: 0 };
  const base = {
    scan: async () => {
      calls.scan += 1;
      return { paired: [{ name: 'MPT-II', address: 'bt:AA:BB:CC:DD:EE:FF', deviceType: 'bt' }], found: [] };
    },
    stopScan: async () => { calls.stopScan += 1; },
    connect: async () => { calls.connect += 1; },
    disconnect: async () => { calls.disconnect += 1; },
    isConnected: async () => { calls.isConnected += 1; return true; },
    testConnection: async () => ({ success: true }),
    printImage: async () => { calls.printImage += 1; return { success: true }; },
    printRaw: async () => { calls.printRaw += 1; },
    onConnectionChanged: () => ({ remove() {} })
  };
  const t = Object.assign({}, base, overrides);
  t.__calls = calls;
  return t;
}

function setup(t, storage) {
  manager.__reset();
  settings.__setStorage(storage || makeStorage());
  transport.__setTransport(t);
  transport.__setPermissionProbe(null);
}

const getBase64 = async () => 'iVBORw0KGgoAAAANSUhEUg==';

const ORDER = {
  id: 'ORD-1001',
  tableId: 'T-01',
  fullDate: '2026-09-22',
  time: '08:30 PM',
  items: [{ name: 'চিকেন বার্গার', qty: 2, price: 150, total: 300 }],
  totalAmount: 300,
  paidAmount: 300,
  paymentMethod: 'নগদ'
};

// ---------- tests ----------

test('computeStatus derives the 5 required states', () => {
  assert.strictEqual(manager.computeStatus({ available: false, address: null, connected: false, confirmed: false }), STATUS.PLATFORM_UNSUPPORTED);
  assert.strictEqual(manager.computeStatus({ available: true, address: null, connected: false, confirmed: false }), STATUS.NOT_CONFIGURED);
  assert.strictEqual(manager.computeStatus({ available: true, address: 'bt:x', connected: false, confirmed: false }), STATUS.PREVIOUSLY_SELECTED_DISCONNECTED);
  assert.strictEqual(manager.computeStatus({ available: true, address: 'bt:x', connected: true, confirmed: false }), STATUS.FOUND_UNVERIFIED);
  assert.strictEqual(manager.computeStatus({ available: true, address: 'bt:x', connected: true, confirmed: true }), STATUS.CONNECTED_READY);
});

test('toWireAddress adds the scheme the native TransportFactory requires', () => {
  // DeviceScanner returns a RAW MAC with no scheme — passing it straight to
  // connect() makes TransportFactory throw "Unknown transport scheme 'AA'".
  assert.strictEqual(manager.toWireAddress({ address: 'AA:BB:CC:DD:EE:FF', deviceType: 'bt' }), 'bt:AA:BB:CC:DD:EE:FF');
  assert.strictEqual(manager.toWireAddress({ address: 'AA:BB:CC:DD:EE:FF', deviceType: 'ble' }), 'ble:AA:BB:CC:DD:EE:FF');
  // dual/unknown default to Classic (58mm ESC/POS printers are overwhelmingly SPP)
  assert.strictEqual(manager.toWireAddress({ address: 'AA:BB:CC:DD:EE:FF', deviceType: 'dual' }), 'bt:AA:BB:CC:DD:EE:FF');
  assert.strictEqual(manager.toWireAddress({ address: 'AA:BB:CC:DD:EE:FF', deviceType: 'unknown' }), 'bt:AA:BB:CC:DD:EE:FF');
  // already-prefixed addresses pass through unchanged
  assert.strictEqual(manager.toWireAddress({ address: 'ble:AA:BB' }), 'ble:AA:BB');
  assert.strictEqual(manager.toWireAddress({ address: 'lan:192.168.1.5:9100', deviceType: 'ble' }), 'lan:192.168.1.5:9100');
  assert.strictEqual(manager.toWireAddress({ address: '' }), '');
  assert.strictEqual(manager.toWireAddress(null), '');
});

test('scanAndConnect sends a SCHEMED address to the transport (not the raw MAC)', async () => {
  let receivedAddress = null;
  const t = makeTransport({
    scan: async () => ({ paired: [{ name: 'MPT-II', address: '11:22:33:44:55:66', deviceType: 'ble' }], found: [] }),
    connect: async (address) => { receivedAddress = address; }
  });
  setup(t);

  const res = await manager.scanAndConnect();
  assert.strictEqual(res.success, true);
  assert.strictEqual(receivedAddress, 'ble:11:22:33:44:55:66', 'must pass a scheme-prefixed address');
});

test('native scanner error codes are mapped to Bangla messages', () => {
  // DeviceScanner.kt rejects with BT_DISABLED / BT_PERMISSION / SCAN_FAILED, etc.
  const disabled = manager.resolveError({ code: 'BT_DISABLED', message: 'Bluetooth is disabled' });
  assert.strictEqual(disabled.code, 'BLUETOOTH_DISABLED');
  assert.ok(disabled.message.includes('ব্লুটুথ'));

  const perm = manager.resolveError({ code: 'BT_PERMISSION', message: 'Missing BLUETOOTH_SCAN permission' });
  assert.strictEqual(perm.code, 'BLUETOOTH_PERMISSION_DENIED');

  const scanFail = manager.resolveError({ code: 'SCAN_ERROR', message: 'boom' });
  assert.strictEqual(scanFail.code, 'SCAN_FAILED');

  // library ErrorCode values pass through unchanged
  assert.strictEqual(manager.resolveError({ code: 'CONNECTION_TIMEOUT' }).code, 'CONNECTION_TIMEOUT');
});

test('app startup with no printer: NOT_CONFIGURED, and never scans on its own', async () => {
  const t = makeTransport();
  setup(t);
  const s = await manager.refresh();
  assert.strictEqual(s.status, STATUS.NOT_CONFIGURED);
  assert.strictEqual(t.__calls.scan, 0, 'must not scan without an explicit user gesture');
});

test('app startup with a previously selected but disconnected printer', async () => {
  const storage = makeStorage();
  storage.set('printer_address', 'bt:11:22:33:44:55:66');
  storage.set('printer_name', 'OldPrinter');

  const t = makeTransport({ isConnected: async () => false });
  setup(t, storage);

  const s = await manager.refresh();
  assert.strictEqual(s.status, STATUS.PREVIOUSLY_SELECTED_DISCONNECTED);
  assert.strictEqual(s.name, 'OldPrinter');
  assert.strictEqual(t.__calls.scan, 0, 'reconnect probing must not scan');
});

test('connect + print succeed across bt / ble / dual / tcp transports', async () => {
  for (const deviceType of ['bt', 'ble', 'dual', 'tcp']) {
    const t = makeTransport({
      scan: async () => ({ paired: [{ name: `P-${deviceType}`, address: `${deviceType}:AA:BB`, deviceType }], found: [] })
    });
    setup(t);

    const connected = await manager.scanAndConnect();
    assert.strictEqual(connected.success, true, `${deviceType}: connect should succeed`);

    const printed = await manager.printReceipt(ORDER, { getBase64 });
    assert.strictEqual(printed.success, true, `${deviceType}: print should succeed`);
    assert.strictEqual(t.__calls.printImage, 1, `${deviceType}: one image write`);
  }
});

test('unsupported transport is rejected with a Bangla message and never marked verified', async () => {
  const t = makeTransport({
    connect: async () => { throw Object.assign(new Error('unsupported'), { code: 'UNSUPPORTED_TRANSPORT' }); }
  });
  setup(t);

  const res = await manager.scanAndConnect();
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.code, 'UNSUPPORTED_TRANSPORT');
  assert.ok(res.message.includes('সাপোর্টেড'), 'Bangla message expected');
  assert.strictEqual(manager.getStatus().verified, false);
});

test('missing writable characteristic (connect failure) is handled', async () => {
  const t = makeTransport({
    connect: async () => { throw Object.assign(new Error('no writable characteristic'), { code: 'CONNECTION_FAILED' }); }
  });
  setup(t);

  const res = await manager.scanAndConnect();
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.code, 'CONNECTION_FAILED');
  assert.ok(res.message.includes('কানেক্ট করা যায়নি'));
});

test('Bluetooth platform unavailable', async () => {
  manager.__reset();
  settings.__setStorage(makeStorage());
  transport.__setTransport({}); // no scan() → unavailable

  const s = await manager.refresh();
  assert.strictEqual(s.status, STATUS.PLATFORM_UNSUPPORTED);

  const res = await manager.scanAndConnect();
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.code, 'PLATFORM_UNSUPPORTED');
});

test('Bluetooth permission denied maps to a Bangla message', async () => {
  const t = makeTransport({
    connect: async () => { throw Object.assign(new Error('permission'), { code: 'BLUETOOTH_PERMISSION_DENIED' }); }
  });
  setup(t);

  const res = await manager.scanAndConnect();
  assert.strictEqual(res.code, 'BLUETOOTH_PERMISSION_DENIED');
  assert.ok(res.message.includes('পারমিশন'));
});

test('runtime permission is requested, and a denial blocks the scan', async () => {
  const t = makeTransport();
  setup(t);
  transport.__setPermissionProbe(async () => ({ granted: false, blocked: false, platform: 'android31+' }));

  const res = await manager.scanAndConnect();
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.code, 'BLUETOOTH_PERMISSION_DENIED');
  assert.strictEqual(t.__calls.scan, 0, 'must NOT scan without permission');
  assert.strictEqual(res.canOpenSettings, false, 'a normal denial can be re-asked');
});

test('permanently blocked permission offers the Settings action', async () => {
  const t = makeTransport();
  setup(t);
  transport.__setPermissionProbe(async () => ({ granted: false, blocked: true, platform: 'android31+' }));

  const res = await manager.scanAndConnect();
  assert.strictEqual(res.code, 'PERMISSION_BLOCKED');
  assert.strictEqual(res.canOpenSettings, true, 'user must be sent to system settings');
  assert.ok(res.message.includes('সেটিংস'));
  assert.strictEqual(t.__calls.scan, 0);
});

test('granted permission proceeds to scan', async () => {
  const t = makeTransport();
  setup(t);
  transport.__setPermissionProbe(async () => ({ granted: true, blocked: false, platform: 'android31+' }));

  const res = await manager.scanAndConnect();
  assert.strictEqual(res.success, true);
  assert.strictEqual(t.__calls.scan, 1);
});

test('disconnection during printing is reported UNCERTAIN and is not auto-retried', async () => {
  let printCalls = 0;
  const t = makeTransport({
    printImage: async () => {
      printCalls += 1;
      throw Object.assign(new Error('link lost'), { code: 'CONNECTION_LOST' });
    }
  });
  setup(t);
  await manager.scanAndConnect();

  const res = await manager.printReceipt(ORDER, { getBase64 });
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.code, 'UNCERTAIN');
  assert.ok(res.message.includes('নিশ্চিত নয়'), 'Bangla uncertainty message expected');
  assert.strictEqual(printCalls, 1, 'must NOT automatically retry (avoids duplicate receipts)');
});

test('small-MTU BLE fallback halves the chunk size instead of failing', async () => {
  const bytes = new Uint8Array(500);
  let received = 0;
  let maxChunk = 0;

  const write = async (chunk) => {
    if (chunk.length > 20) throw new Error('GATT write too long');
    received += chunk.length;
    maxChunk = Math.max(maxChunk, chunk.length);
  };

  const res = await transport.sendChunks(write, bytes, { initialChunkSize: 100 });
  assert.strictEqual(received, 500, 'all bytes must be delivered');
  assert.ok(maxChunk <= 20, 'chunks must fit a 20-byte payload');
  assert.strictEqual(res.maxChunk, 20);
});

test('Bengali receipt layout is preserved and the raster stays 384 dots', () => {
  const text = formatReceiptText(ORDER);
  assert.ok(text.includes('রংধনু ক্যাফে এন্ড রেস্টুরেন্ট'));
  assert.ok(text.includes('চিকেন বার্গার'));
  assert.ok(text.includes('ধন্যবাদ, আবার আসবেন!'));
  assert.ok(text.includes('পরিশোধ:'));

  const norm = normalizeOrderForReceipt(ORDER);
  assert.strictEqual(norm.tableName, 'T-01');
  assert.strictEqual(manager.RECEIPT_RASTER_WIDTH, 384, '58mm receipt must be 384 dots wide');
});

test('test-print flow separates software transmission from physical verification', async () => {
  const t = makeTransport();
  setup(t);
  await manager.scanAndConnect();
  assert.strictEqual(manager.getStatus().status, STATUS.FOUND_UNVERIFIED);

  const res = await manager.printTestReceipt({ getBase64 });
  assert.strictEqual(res.success, true);

  let s = manager.getStatus();
  assert.ok(s.testTransmittedAt, 'transmission timestamp recorded');
  assert.strictEqual(s.verified, false, 'must NOT be verified before the user confirms');
  assert.strictEqual(s.status, STATUS.FOUND_UNVERIFIED);

  s = await manager.confirmPhysicalTest(true);
  assert.strictEqual(s.verified, true, 'only a user confirmation verifies the printer');
  assert.strictEqual(s.status, STATUS.CONNECTED_READY);
});

test('no duplicate receipt for a repeated successful print', async () => {
  const t = makeTransport();
  setup(t);
  await manager.scanAndConnect();

  const first = await manager.printReceipt(ORDER, { getBase64 });
  assert.strictEqual(first.success, true);

  const second = await manager.printReceipt(ORDER, { getBase64 });
  assert.strictEqual(second.deduped, true, 'repeat print must be deduped');
  assert.strictEqual(t.__calls.printImage, 1, 'second call must not reach the printer');
});

test('a concurrent print of the same order is rejected as BUSY', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let printCalls = 0;

  const t = makeTransport({
    printImage: async () => {
      printCalls += 1;
      await gate;
      return { success: true };
    }
  });
  setup(t);
  await manager.scanAndConnect();

  const first = manager.printReceipt(ORDER, { getBase64 });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const second = await manager.printReceipt(ORDER, { getBase64 });
  assert.strictEqual(second.success, false);
  assert.strictEqual(second.code, 'BUSY');

  release();
  const firstResult = await first;
  assert.strictEqual(firstResult.success, true);
  assert.strictEqual(printCalls, 1, 'only one job may be in flight');
});

test('forget clears the stored printer and returns to NOT_CONFIGURED', async () => {
  const t = makeTransport();
  setup(t);
  await manager.scanAndConnect();
  assert.ok(manager.getStatus().address);

  const s = await manager.forget();
  assert.strictEqual(s.address, null);
  assert.strictEqual(s.status, STATUS.NOT_CONFIGURED);
});

test('app startup with a saved printer performs NO connection attempt', async () => {
  const storage = makeStorage();
  storage.set('printer_address', 'bt:11:22:33:44:55:66');
  storage.set('printer_name', 'SavedPrinter');

  const t = makeTransport({
    connect: async () => { throw new Error('startup must NOT connect'); },
    isConnected: async () => { throw new Error('startup must NOT probe the radio'); }
  });
  setup(t, storage);

  const s = await manager.refresh();
  assert.strictEqual(t.__calls.scan, 0, 'startup must not scan');
  assert.strictEqual(t.__calls.connect, 0, 'startup must not open a connection');
  assert.strictEqual(t.__calls.isConnected, 0, 'startup must not probe the radio');
  assert.strictEqual(s.connected, false);
  assert.strictEqual(s.status, STATUS.PREVIOUSLY_SELECTED_DISCONNECTED);
  assert.strictEqual(s.name, 'SavedPrinter');
});

test('BLE connect times out, closes the half-open link, and never gets stuck connecting', async () => {
  let disconnectCalls = 0;
  const t = makeTransport({
    scan: async () => ({ paired: [{ name: 'BLE-P', address: '11:22:33:44:55:66', deviceType: 'ble' }], found: [] }),
    connect: () => new Promise(() => {}), // hangs, like the native GATT wait with no timeout
    disconnect: async () => { disconnectCalls += 1; }
  });
  setup(t);

  const res = await manager.scanAndConnect({ timeout: 60 });
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.code, 'CONNECTION_TIMEOUT');
  assert.ok(res.message.includes('সময়'), 'Bangla timeout message expected');
  assert.strictEqual(disconnectCalls, 1, 'half-open connection must be closed');

  const s = manager.getStatus();
  assert.strictEqual(s.connected, false);
  assert.strictEqual(s.connecting, false, 'UI must not be left stuck on Connecting');
});

test('Bluetooth Classic connect also times out and cleans up', async () => {
  let disconnectCalls = 0;
  const t = makeTransport({
    scan: async () => ({ paired: [{ name: 'SPP-P', address: 'AA:BB:CC:DD:EE:FF', deviceType: 'bt' }], found: [] }),
    connect: () => new Promise(() => {}),
    disconnect: async () => { disconnectCalls += 1; }
  });
  setup(t);

  const res = await manager.scanAndConnect({ timeout: 60 });
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.code, 'CONNECTION_TIMEOUT');
  assert.strictEqual(disconnectCalls, 1);
  assert.strictEqual(manager.getStatus().connecting, false);
});

test('recovers cleanly after a timed-out connection', async () => {
  let attempt = 0;
  const t = makeTransport({
    connect: async () => {
      attempt += 1;
      if (attempt === 1) return new Promise(() => {}); // first attempt hangs
      return undefined;                                 // second succeeds
    }
  });
  setup(t);

  const first = await manager.scanAndConnect({ timeout: 60 });
  assert.strictEqual(first.success, false);
  assert.strictEqual(manager.getStatus().connected, false);

  const second = await manager.scanAndConnect({ timeout: 300 });
  assert.strictEqual(second.success, true, 'a retry after a timeout must work');
  assert.strictEqual(manager.getStatus().connected, true);
});

test('a second Connect tap while one is in flight is rejected as BUSY', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let connectCalls = 0;

  const t = makeTransport({
    connect: async () => { connectCalls += 1; await gate; }
  });
  setup(t);

  const first = manager.scanAndConnect();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const second = await manager.scanAndConnect();
  assert.strictEqual(second.success, false);
  assert.strictEqual(second.code, 'BUSY');

  release();
  const firstResult = await first;
  assert.strictEqual(firstResult.success, true);
  assert.strictEqual(connectCalls, 1, 'only one connection attempt may run');
});

// ── Regression: AirPods-first ordering (printerManager.js fix) ───────────────

test('scanAndConnect skips AirPods and selects the thermal printer (AirPods first, printer second)', async () => {
  // Production regression: phone has AirPods paired before the 58mm printer.
  // Android bonded-device list returns them in that order.
  // Old code: paired[0] → AirPods → audio guard blocks → connect fails.
  // New code: find(d => !isAudioDevice(d)) → skips AirPods → picks printer.
  let selectedAddress = null;
  const t = makeTransport({
    scan: async () => ({
      paired: [
        { name: 'AirPods Pro', address: 'AA:BB:CC:11:22:33', deviceType: 'bt', majorClass: 'audio' },
        { name: 'RPP02N',      address: 'AA:BB:CC:44:55:66', deviceType: 'bt' }
      ],
      found: []
    }),
    connect: async (address) => { selectedAddress = address; }
  });
  setup(t);
  const res = await manager.scanAndConnect();
  assert.strictEqual(res.success, true, 'must succeed, not be blocked by AirPods audio guard');
  assert.ok(
    selectedAddress && selectedAddress.includes('44:55:66'),
    `must connect to the printer (44:55:66), got: ${selectedAddress}`
  );
  assert.ok(!selectedAddress.includes('11:22:33'), 'must NOT connect to the AirPods address');
});

test('scanAndConnect works normally when only the thermal printer is paired (no audio device)', async () => {
  let selectedAddress = null;
  const t = makeTransport({
    scan: async () => ({
      paired: [{ name: 'RPP02N', address: 'DD:EE:FF:00:11:22', deviceType: 'bt' }],
      found: []
    }),
    connect: async (address) => { selectedAddress = address; }
  });
  setup(t);
  const res = await manager.scanAndConnect();
  assert.strictEqual(res.success, true);
  assert.ok(
    selectedAddress && selectedAddress.includes('DD:EE:FF:00:11:22'),
    `printer-only list must connect to the printer, got: ${selectedAddress}`
  );
});

test('scanAndConnect returns DEVICE_NOT_FOUND when all paired devices are audio (no printer available)', async () => {
  const t = makeTransport({
    scan: async () => ({
      paired: [
        { name: 'AirPods Pro',     address: 'AA:11:22:33:44:55', deviceType: 'bt', majorClass: 'audio' },
        { name: 'Sony WH-1000XM5', address: 'BB:11:22:33:44:55', deviceType: 'bt', majorClass: 'audio' }
      ],
      found: []
    })
  });
  setup(t);
  const res = await manager.scanAndConnect();
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.code, 'DEVICE_NOT_FOUND',
    'audio-only bonded list must not produce a printer candidate');
});

test('scanAndConnect picks printer from found[] when paired[] contains only audio devices', async () => {
  // AirPods in paired[]; printer discovered via active scan → appears in found[]
  let selectedAddress = null;
  const t = makeTransport({
    scan: async () => ({
      paired: [{ name: 'AirPods Pro', address: 'CC:11:22:33:44:55', deviceType: 'bt', majorClass: 'audio' }],
      found:  [{ name: 'Xprinter',    address: 'DD:AA:BB:CC:DD:EE', deviceType: 'bt' }]
    }),
    connect: async (address) => { selectedAddress = address; }
  });
  setup(t);
  const res = await manager.scanAndConnect();
  assert.strictEqual(res.success, true, 'should connect to printer found via discovery scan');
  assert.ok(
    selectedAddress && selectedAddress.includes('DD:AA:BB:CC:DD:EE'),
    `should use the discovered printer, got: ${selectedAddress}`
  );
});

// ---------- runner ----------

(async () => {
  console.log('======================================================');
  console.log('   NATIVE THERMAL PRINTER — HEADLESS VERIFICATION      ');
  console.log('======================================================\n');

  for (const t of queue) {
    try {
      await t.fn();
      console.log(`  ✅  ${t.name}`);
      passed += 1;
    } catch (err) {
      console.error(`  ❌  ${t.name}: ${err.message}`);
      failed += 1;
    }
  }

  console.log('\n------------------------------------------------------');
  console.log(`Tests Passed: ${passed}`);
  console.log(`Tests Failed: ${failed}`);
  console.log('======================================================\n');
  console.log('NOTE: these are LOGIC tests with a mocked transport.');
  console.log('A real printer verdict still requires a physical test print.');

  if (failed > 0) process.exit(1);
})();
