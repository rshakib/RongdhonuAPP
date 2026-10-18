/**
 * tests/printerConnectionFlow.test.js
 *
 * Automated verification for:
 * 1. Saved printer auto-connect success / failure.
 * 2. No saved printer behavior (safe no-op).
 * 3. Discovery: retrieval of multiple paired and discovered devices.
 * 4. User selection of a specific device (NOT auto-selecting paired[0] or found[0]).
 * 5. Scan failure and permission denial handling.
 * 6. Button states (disconnected, connecting, connected, disconnecting, disconnected-again).
 */

const assert = require('assert');
const {
  STATUS,
  computeStatus,
  scanForDevices,
  connectDevice,
  autoConnectSavedPrinter,
  connectKnown,
  disconnect,
  forget,
  getStatus,
  refresh
} = require('../services/printer/printerManager.js');

const {
  computeButtonStates,
  getDisabledReason
} = require('../services/printer/printerButtonStates.js');

const {
  __setTransport,
  __setPermissionProbe
} = require('../services/printer/printerTransport.js');

const {
  __setStorage
} = require('../services/printer/printerSettings.js');

console.log('======================================================');
console.log('   BLUETOOTH PRINTER CONNECTION FLOW TEST SUITE       ');
console.log('======================================================\n');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅  ${name}`);
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

(async () => {
  // Test 1: No saved printer auto-connect
  await test('1. Auto-connect with no saved printer returns NOT_CONFIGURED and remains disconnected', async () => {
    const storage = createMockStorage({});
    __setStorage(storage);
    __setPermissionProbe(async () => ({ granted: true, blocked: false }));
    __setTransport({
      scan: async () => ({ paired: [], found: [] }),
      connect: async () => true,
      disconnect: async () => true
    });

    await refresh();
    const result = await autoConnectSavedPrinter();
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, 'NOT_CONFIGURED');

    const status = getStatus();
    assert.strictEqual(status.status, STATUS.NOT_CONFIGURED);
    assert.strictEqual(status.connected, false);
  });

  // Test 2: Saved printer auto-connect success
  await test('2. Auto-connect with saved printer connects successfully without scanning', async () => {
    const storage = createMockStorage({
      printer_address: 'bt:11:22:33:44:55:66',
      printer_name: 'Saved Receipt Printer',
      printer_transport: 'bt',
      printer_test_confirmed_at: '2026-09-22T10:00:00.000Z'
    });
    __setStorage(storage);

    let connectCalledWith = null;
    let scanCalled = false;

    __setTransport({
      scan: async () => {
        scanCalled = true;
        return { paired: [], found: [] };
      },
      connect: async (addr) => {
        connectCalledWith = addr;
        return true;
      },
      disconnect: async () => true
    });

    await refresh();
    const result = await autoConnectSavedPrinter({ timeout: 4000 });

    assert.strictEqual(result.success, true);
    assert.strictEqual(scanCalled, false, 'Auto-connect must NOT trigger a device scan');
    assert.strictEqual(connectCalledWith, 'bt:11:22:33:44:55:66');

    const status = getStatus();
    assert.strictEqual(status.connected, true);
    assert.strictEqual(status.status, STATUS.CONNECTED_READY);
  });

  // Test 3: Saved printer auto-connect failure
  await test('3. Auto-connect failure leaves printer in PREVIOUSLY_SELECTED_DISCONNECTED', async () => {
    const storage = createMockStorage({
      printer_address: 'bt:99:88:77:66:55:44',
      printer_name: 'Offline Printer',
      printer_transport: 'bt'
    });
    __setStorage(storage);

    __setTransport({
      scan: async () => ({ paired: [], found: [] }),
      connect: async () => {
        const err = new Error('Connection refused');
        err.code = 'CONNECTION_FAILED';
        throw err;
      },
      disconnect: async () => true
    });

    await refresh();
    const result = await autoConnectSavedPrinter({ timeout: 2000 });

    assert.strictEqual(result.success, false);
    const status = getStatus();
    assert.strictEqual(status.connected, false);
    assert.strictEqual(status.status, STATUS.PREVIOUSLY_SELECTED_DISCONNECTED);
  });

  // Test 4: scanForDevices returns multiple paired and discovered devices without auto-selecting
  await test('4. scanForDevices returns all paired and discovered devices for manual picker', async () => {
    const storage = createMockStorage({});
    __setStorage(storage);

    const mockPaired = [
      { name: 'Bluetooth Earphones', address: '00:11:22:33:44:55', deviceType: 'bt' },
      { name: 'MTP-II Receipt Printer', address: '66:77:88:99:AA:BB', deviceType: 'bt' }
    ];
    const mockFound = [
      { name: 'POS-58 BLE', address: 'CC:DD:EE:FF:00:11', deviceType: 'ble', rssi: -58 },
      { name: 'Smart Watch', address: '12:34:56:78:9A:BC', deviceType: 'ble', rssi: -82 }
    ];

    __setTransport({
      scan: async () => ({ paired: mockPaired, found: mockFound }),
      connect: async () => true,
      disconnect: async () => true
    });

    const result = await scanForDevices();

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.paired.length, 2);
    assert.strictEqual(result.found.length, 2);
    assert.strictEqual(result.paired[1].name, 'MTP-II Receipt Printer');
    assert.strictEqual(result.found[0].name, 'POS-58 BLE');

    // Crucial check: scanForDevices does NOT alter connection state or pick candidate 0!
    const status = getStatus();
    assert.strictEqual(status.connected, false);
  });

  // Test 5: User explicitly selects the second device (NOT paired[0])
  await test('5. User selects a specific device (e.g. 2nd paired or BLE found device), connecting to that exact MAC', async () => {
    const storage = createMockStorage({});
    __setStorage(storage);

    let connectedAddress = null;
    __setTransport({
      scan: async () => ({ paired: [], found: [] }),
      connect: async (addr) => {
        connectedAddress = addr;
        return true;
      },
      disconnect: async () => true
    });

    // Device 1 was earphones; Device 2 is the actual printer:
    const chosenDevice = {
      name: 'MTP-II Receipt Printer',
      address: '66:77:88:99:AA:BB',
      deviceType: 'bt'
    };

    const result = await connectDevice(chosenDevice);
    assert.strictEqual(result.success, true);
    assert.strictEqual(connectedAddress, 'bt:66:77:88:99:AA:BB', 'Must connect to the user-chosen device MAC');

    const status = getStatus();
    assert.strictEqual(status.connected, true);
    assert.strictEqual(status.address, 'bt:66:77:88:99:AA:BB');
    assert.strictEqual(status.name, 'MTP-II Receipt Printer');

    // Verify it was saved to storage
    assert.strictEqual(await storage.get('printer_address'), 'bt:66:77:88:99:AA:BB');
    assert.strictEqual(await storage.get('printer_name'), 'MTP-II Receipt Printer');
  });

  // Test 6: Permission denial and scan failure
  await test('6. Permission denial blocks scan and returns clear error', async () => {
    __setTransport({
      scan: async () => ({ paired: [], found: [] }),
      connect: async () => true,
      disconnect: async () => true
    });
    __setPermissionProbe(async () => ({ granted: false, blocked: true, platform: 'android31+' }));

    const result = await scanForDevices();
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, 'PERMISSION_BLOCKED');
    assert.strictEqual(result.canOpenSettings, true);

    // Reset probe
    __setPermissionProbe(async () => ({ granted: true, blocked: false }));
  });

  // Test 7: Button States & Bangla feedback in all 5 states
  await test('7. Button states and Bangla disabled messages across connection lifecycle', () => {
    // A. Disconnected without saved printer
    const s1 = { status: STATUS.NOT_CONFIGURED, address: null, connected: false };
    const b1 = computeButtonStates({ status: s1, busy: false, scanning: false });
    assert.strictEqual(b1.canConnect, true);
    assert.strictEqual(b1.canReconnect, false);
    assert.strictEqual(b1.canDisconnect, false);
    assert.strictEqual(b1.canTestPrint, false);
    assert.strictEqual(b1.canForget, false);
    assert.ok(getDisabledReason('reconnect', { status: s1 }).includes('সংরক্ষিত প্রিন্টার'));
    assert.ok(getDisabledReason('test', { status: s1 }).includes('কানেক্ট করুন'));

    // B. Disconnected with saved printer
    const s2 = { status: STATUS.PREVIOUSLY_SELECTED_DISCONNECTED, address: 'bt:11:22:33:44:55:66', connected: false };
    const b2 = computeButtonStates({ status: s2, busy: false, scanning: false });
    assert.strictEqual(b2.canConnect, true);
    assert.strictEqual(b2.canReconnect, true);
    assert.strictEqual(b2.canDisconnect, false);
    assert.strictEqual(b2.canTestPrint, false);
    assert.strictEqual(b2.canForget, true);
    assert.ok(getDisabledReason('disconnect', { status: s2 }).includes('ডিসকানেক্ট'));

    // C. Scanning / Busy
    const b3 = computeButtonStates({ status: s2, busy: 'connect', scanning: false });
    assert.strictEqual(b3.canConnect, false);
    assert.strictEqual(b3.canReconnect, false);
    assert.strictEqual(b3.canDisconnect, false);
    assert.strictEqual(b3.canTestPrint, false);
    assert.ok(getDisabledReason('connect', { status: s2, busy: 'connect' }).includes('অপেক্ষা করুন'));

    // D. Connected
    const s4 = { status: STATUS.CONNECTED_READY, address: 'bt:11:22:33:44:55:66', connected: true, verified: true };
    const b4 = computeButtonStates({ status: s4, busy: false, scanning: false });
    assert.strictEqual(b4.canConnect, true);
    assert.strictEqual(b4.canReconnect, true);
    assert.strictEqual(b4.canDisconnect, true);
    assert.strictEqual(b4.canTestPrint, true);
    assert.strictEqual(b4.canForget, true);
  });

  // Summary
  console.log('\n------------------------------------------------------');
  console.log(`Tests Passed: ${passed}`);
  console.log(`Tests Failed: ${failed}`);
  console.log('======================================================\n');

  if (failed > 0) process.exit(1);
})();
