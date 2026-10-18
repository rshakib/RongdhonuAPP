/**
 * tests/printerAcceptanceDiagnostics.test.js
 *
 * Automated verification of the Live Hardware Diagnostic Logging system:
 * 1. Masking Bluetooth addresses for privacy (raw & schemed).
 * 2. Event emission for Discovery (started & completed).
 * 3. Event emission for Connection (attempt, success, failure).
 * 4. Event emission for Print submission (Test receipt & POS order) with 384-dot raster.
 * 5. Event emission for Disconnect.
 * 6. Rolling buffer boundary and clearing.
 */

import assert from 'node:assert/strict';
import {
  __setTransport,
  __setPermissionProbe
} from '../services/printer/printerTransport.js';

import {
  scanForDevices,
  connectDevice,
  disconnect,
  printTestReceipt,
  printReceipt,
  getDiagnosticLogs,
  clearDiagnosticLogs,
  maskAddress,
  getDiagnosticCheckpoints
} from '../services/printer/index.js';

function makeMockTransport(overrides = {}) {
  return {
    scan: async () => ({ paired: [{ name: 'POS-58', address: '00:11:22:33:44:55', deviceType: 'bt' }], found: [] }),
    connect: async () => true,
    disconnect: async () => true,
    printImage: async () => ({ success: true }),
    ...overrides
  };
}

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌  ${name}`);
    console.error(err);
    failed++;
  }
}

async function runSuite() {
  console.log('======================================================');
  console.log('   PRINTER ACCEPTANCE & DIAGNOSTIC LOGGING SUITE     ');
  console.log('======================================================\n');

  // Test 1: Address masking helper
  await test('1. maskAddress protects privacy while keeping prefix and suffix', () => {
    assert.equal(maskAddress('00:11:22:33:44:55'), '00:11:••:••:••:55');
    assert.equal(maskAddress('bt:AA:BB:CC:DD:EE:FF'), 'bt:AA:BB:••:••:••:FF');
    assert.equal(maskAddress('ble:12:34:56:78:9A:BC'), 'ble:12:34:••:••:••:BC');
    assert.equal(maskAddress(''), '');
  });

  // Test 2: Discovery diagnostic events
  await test('2. scanForDevices records DISCOVERY_STARTED and DISCOVERY_COMPLETED', async () => {
    clearDiagnosticLogs();
    __setPermissionProbe(async () => ({ granted: true, blocked: false }));
    __setTransport(makeMockTransport());

    const result = await scanForDevices();
    assert.equal(result.success, true);

    const logs = getDiagnosticLogs();
    const completedEvent = logs.find((l) => l.type === 'DISCOVERY_COMPLETED');
    const startedEvent = logs.find((l) => l.type === 'DISCOVERY_STARTED');

    assert.ok(startedEvent, 'DISCOVERY_STARTED event must exist');
    assert.ok(completedEvent, 'DISCOVERY_COMPLETED event must exist');
    assert.equal(completedEvent.pairedCount, 1);
    assert.equal(completedEvent.foundCount, 0);
    assert.ok(completedEvent.durationMs >= 0);
  });

  // Test 3: Connect diagnostic events
  await test('3. connectDevice records CONNECT_ATTEMPT and CONNECT_SUCCESS with masked wire address', async () => {
    clearDiagnosticLogs();
    __setPermissionProbe(async () => ({ granted: true, blocked: false }));
    __setTransport(makeMockTransport());

    const printer = { name: 'MTP-II', address: '00:11:22:33:44:55', deviceType: 'bt' };
    const res = await connectDevice(printer);
    assert.equal(res.success, true);

    const logs = getDiagnosticLogs();
    const attemptEvent = logs.find((l) => l.type === 'CONNECT_ATTEMPT');
    const successEvent = logs.find((l) => l.type === 'CONNECT_SUCCESS');

    assert.ok(attemptEvent, 'CONNECT_ATTEMPT event must exist');
    assert.ok(successEvent, 'CONNECT_SUCCESS event must exist');
    assert.equal(attemptEvent.name, 'MTP-II');
    assert.equal(attemptEvent.wireAddress, 'bt:00:11:••:••:••:55');
    assert.equal(attemptEvent.transport, 'bt');
    assert.ok(successEvent.durationMs >= 0);
  });

  // Test 4: Print submission and success events (Test receipt)
  await test('4. printTestReceipt records PRINT_SUBMITTED and PRINT_SUCCESS with 384 dots width', async () => {
    clearDiagnosticLogs();
    __setPermissionProbe(async () => ({ granted: true, blocked: false }));
    __setTransport(makeMockTransport());

    // Connect first so printer is marked ready
    await connectDevice({ name: 'POS-58', address: '00:11:22:33:44:55', deviceType: 'bt' });

    const dummyBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAYAAAABkCAYAAACm/Gz6';
    const printRes = await printTestReceipt({ getBase64: async () => dummyBase64 });
    assert.equal(printRes.success, true);

    const logs = getDiagnosticLogs();
    const submitEvent = logs.find((l) => l.type === 'PRINT_SUBMITTED');
    const successEvent = logs.find((l) => l.type === 'PRINT_SUCCESS');

    assert.ok(submitEvent, 'PRINT_SUBMITTED event must exist');
    assert.ok(successEvent, 'PRINT_SUCCESS event must exist');
    assert.equal(submitEvent.printType, 'TEST_RECEIPT');
    assert.equal(submitEvent.width, 384);
    assert.equal(submitEvent.dots, 384);
    assert.equal(submitEvent.payloadChars, dummyBase64.length);
    assert.ok(successEvent.durationMs >= 0);
  });

  // Test 5: POS Customer Receipt print event
  await test('5. printReceipt records PRINT_SUBMITTED for real POS bill order', async () => {
    clearDiagnosticLogs();
    __setPermissionProbe(async () => ({ granted: true, blocked: false }));
    __setTransport(makeMockTransport());

    await connectDevice({ name: 'POS-58', address: '00:11:22:33:44:55', deviceType: 'bt' });

    const posOrder = {
      id: 'BILL-10042',
      tableId: 'T3',
      items: [{ name: 'Chicken Biryani', qty: 2, price: 250, total: 500 }],
      totalAmount: 500
    };
    const dummyBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAYAAAABkCAYAAACm/Gz6';
    const res = await printReceipt(posOrder, { getBase64: async () => dummyBase64, force: true });
    assert.equal(res.success, true);

    const logs = getDiagnosticLogs();
    const submitEvent = logs.find((l) => l.type === 'PRINT_SUBMITTED');
    assert.ok(submitEvent);
    assert.equal(submitEvent.printType, 'POS_ORDER');
    assert.equal(submitEvent.orderId, 'BILL-10042');
  });

  // Test 6: Disconnect event
  await test('6. disconnect records DISCONNECT event with masked address', async () => {
    clearDiagnosticLogs();
    __setPermissionProbe(async () => ({ granted: true, blocked: false }));
    __setTransport(makeMockTransport());

    await connectDevice({ name: 'POS-58', address: '00:11:22:33:44:55', deviceType: 'bt' });
    await disconnect();

    const logs = getDiagnosticLogs();
    const disconnectEvent = logs.find((l) => l.type === 'DISCONNECT');
    assert.ok(disconnectEvent, 'DISCONNECT event must exist');
    assert.equal(disconnectEvent.wireAddress, 'bt:00:11:••:••:••:55');
  });

  // Test 7: 10 Diagnostic Checkpoints lifecycle
  await test('7. getDiagnosticCheckpoints tracks all 10 hardware checkpoints through lifecycle', async () => {
    clearDiagnosticLogs();
    __setPermissionProbe(async () => ({ granted: true, blocked: false }));
    __setTransport(makeMockTransport());

    const initialCps = getDiagnosticCheckpoints();
    assert.equal(initialCps.length, 10);
    assert.equal(initialCps[0].status, 'PENDING');

    // Run discovery
    await scanForDevices();
    let cps = getDiagnosticCheckpoints();
    assert.equal(cps.find((c) => c.key === 'permission').status, 'PASS');
    assert.equal(cps.find((c) => c.key === 'adapter').status, 'PASS');
    assert.equal(cps.find((c) => c.key === 'discovery').status, 'PASS');

    // Run connect
    await connectDevice({ name: 'POS-58', address: '00:11:22:33:44:55', deviceType: 'bt' });
    cps = getDiagnosticCheckpoints();
    assert.equal(cps.find((c) => c.key === 'selectedPrinter').status, 'PASS');
    assert.equal(cps.find((c) => c.key === 'transport').status, 'PASS');
    assert.equal(cps.find((c) => c.key === 'connectAttempt').status, 'PASS');
    assert.equal(cps.find((c) => c.key === 'connectResult').status, 'PASS');

    // Run print
    const dummyBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAYAAAABkCAYAAACm/Gz6';
    await printTestReceipt({ getBase64: async () => dummyBase64, force: true });
    cps = getDiagnosticCheckpoints();
    assert.equal(cps.find((c) => c.key === 'imageSubmission').status, 'PASS');
    assert.equal(cps.find((c) => c.key === 'printResult').status, 'PASS');

    // Disconnect
    await disconnect();
    cps = getDiagnosticCheckpoints();
    assert.equal(cps.find((c) => c.key === 'teardownReconnect').status, 'PASS');
  });

  // Cleanup mocks
  __setTransport(null);
  __setPermissionProbe(null);

  console.log('\n------------------------------------------------------');
  console.log(`Tests Passed: ${passed}`);
  console.log(`Tests Failed: ${failed}`);
  console.log('======================================================\n');

  if (failed > 0) process.exit(1);
}

runSuite();
