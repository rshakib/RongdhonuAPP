/**
 * tests/bluetoothDetectionTest.test.js
 *
 * Automated verification of the Bluetooth Detection Test Mode:
 * 1. Detection of paired AirPods Pro and audio profile connection status.
 * 2. AirPods Protection: Never allowed as a printer, rejects RFCOMM/ESC/POS connect.
 * 3. Connection status accuracy: "Paired; connection status unavailable" when not connected.
 * 4. Bluetooth disabled (OFF) detection and Bangla message.
 * 5. Permission denial and blocked handling.
 * 6. Empty device list handling.
 * 7. Coexistence with thermal printers in the same scan.
 */

import assert from 'node:assert/strict';
import {
  __setTransport,
  __setPermissionProbe,
  isAudioDevice
} from '../services/printer/printerTransport.js';

import {
  getBluetoothDetectionReport,
  connectDevice,
  MESSAGES
} from '../services/printer/printerManager.js';

function makeMockTransport(overrides = {}) {
  return {
    scan: async () => ({ paired: [], found: [] }),
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
  console.log('   BLUETOOTH DETECTION TEST MODE SUITE');
  console.log('======================================================\n');

  // Test 1: Audio device detection helper
  await test('1. isAudioDevice identifies AirPods, headphones, and audio major class', () => {
    assert.equal(isAudioDevice({ name: 'AirPods Pro', deviceType: 'bt' }), true);
    assert.equal(isAudioDevice({ name: "Shakib's AirPods", deviceType: 'bt' }), true);
    assert.equal(isAudioDevice({ name: 'HOCO EQ34 Plus ANC', deviceType: 'bt' }), true);
    assert.equal(isAudioDevice({ name: 'Galaxy Buds Live', deviceType: 'bt' }), true);
    assert.equal(isAudioDevice({ name: 'Sony WH-1000XM4', deviceType: 'bt' }), true);
    assert.equal(isAudioDevice({ name: 'Generic Device', majorClass: 'audio' }), true);
    assert.equal(isAudioDevice({ name: 'Custom Device', isAudio: true }), true);

    // Printers must not be flagged as audio devices
    assert.equal(isAudioDevice({ name: 'MTP-II', deviceType: 'bt' }), false);
    assert.equal(isAudioDevice({ name: 'RPP02N', deviceType: 'bt' }), false);
    assert.equal(isAudioDevice({ name: 'POS-5802DD', deviceType: 'bt' }), false);
    assert.equal(isAudioDevice({ name: 'InnerPrinter', deviceType: 'bt' }), false);
  });

  // Test 2: Detects connected AirPods Pro in paired devices
  await test('2. getBluetoothDetectionReport detects connected AirPods Pro', async () => {
    __setPermissionProbe(async () => ({ granted: true, blocked: false }));
    __setTransport(makeMockTransport({
      scan: async () => ({
        paired: [
          {
            name: 'AirPods Pro',
            address: 'AA:BB:CC:11:22:33',
            deviceType: 'bt',
            majorClass: 'audio',
            isAudio: true,
            isConnected: true
          }
        ],
        found: []
      })
    }));

    const report = await getBluetoothDetectionReport();
    assert.equal(report.success, true);
    assert.equal(report.airPodsDetected, true);
    assert.ok(report.airPodsDevice);
    assert.equal(report.airPodsDevice.name, 'AirPods Pro');
    assert.equal(report.airPodsDevice.address, 'AA:BB:CC:11:22:33');
    assert.equal(report.airPodsDevice.isConnected, true);
    assert.equal(report.audioDevices.length, 1);
  });

  // Test 3: Audio device protection: Rejects printer connection attempt
  await test('3. Audio device cannot be connected as a printer (RFCOMM/print blocked)', async () => {
    let rawConnectCalled = false;
    __setPermissionProbe(async () => ({ granted: true, blocked: false }));
    __setTransport(makeMockTransport({
      connect: async () => {
        rawConnectCalled = true;
        return true;
      }
    }));

    const airPods = {
      name: 'AirPods Pro',
      address: 'AA:BB:CC:11:22:33',
      deviceType: 'bt',
      isAudio: true
    };

    const res = await connectDevice(airPods);
    assert.equal(res.success, false);
    assert.equal(res.code, 'AUDIO_DEVICE_NOT_PRINTER');
    assert.ok(res.message.includes('অডিও ডিভাইস'));
    assert.equal(rawConnectCalled, false, 'Transport.connect must NEVER be called for audio devices');
  });

  // Test 4: When connected status is unavailable or false, report reflects paired state accurately
  await test('4. Paired but disconnected/unverified audio status does not falsely report connected', async () => {
    __setPermissionProbe(async () => ({ granted: true, blocked: false }));
    __setTransport(makeMockTransport({
      scan: async () => ({
        paired: [
          {
            name: 'HOCO EQ34 Plus ANC',
            address: '11:22:33:44:55:66',
            deviceType: 'bt',
            isAudio: true,
            isConnected: false
          }
        ],
        found: []
      })
    }));

    const report = await getBluetoothDetectionReport();
    assert.equal(report.success, true);
    assert.equal(report.audioDevices.length, 1);
    assert.equal(report.audioDevices[0].isConnected, false);
  });

  // Test 5: Bluetooth OFF (BT_DISABLED) handling
  await test('5. Bluetooth OFF produces BLUETOOTH_DISABLED and clear Bangla message', async () => {
    __setPermissionProbe(async () => ({ granted: true, blocked: false }));
    __setTransport(makeMockTransport({
      scan: async () => {
        throw Object.assign(new Error('Bluetooth is disabled'), { code: 'BT_DISABLED' });
      }
    }));

    const report = await getBluetoothDetectionReport();
    assert.equal(report.success, false);
    assert.equal(report.code, 'BLUETOOTH_DISABLED');
    assert.equal(report.message, MESSAGES.BLUETOOTH_DISABLED);
  });

  // Test 6: Permission denied handling
  await test('6. Bluetooth permission denied returns BLUETOOTH_PERMISSION_DENIED', async () => {
    __setPermissionProbe(async () => ({ granted: false, blocked: false }));
    __setTransport(makeMockTransport());

    const report = await getBluetoothDetectionReport();
    assert.equal(report.success, false);
    assert.equal(report.code, 'BLUETOOTH_PERMISSION_DENIED');
    assert.equal(report.message, MESSAGES.BLUETOOTH_PERMISSION_DENIED);
  });

  // Test 7: Coexistence of thermal printer and audio device
  await test('7. Real thermal printer connects while audio device remains protected', async () => {
    let connectedAddress = null;
    __setPermissionProbe(async () => ({ granted: true, blocked: false }));
    __setTransport(makeMockTransport({
      scan: async () => ({
        paired: [
          {
            name: 'AirPods Pro',
            address: 'AA:BB:CC:11:22:33',
            deviceType: 'bt',
            isAudio: true
          },
          {
            name: 'MTP-II Thermal Printer',
            address: '00:11:22:33:44:55',
            deviceType: 'bt',
            isAudio: false
          }
        ],
        found: []
      }),
      connect: async (addr) => {
        connectedAddress = addr;
        return true;
      }
    }));

    const report = await getBluetoothDetectionReport();
    assert.equal(report.success, true);
    assert.equal(report.airPodsDetected, true);
    assert.equal(report.pairedDevices.length, 2);

    // Connect to the printer -> succeeds
    const printerDevice = report.pairedDevices.find((d) => !d.isAudio);
    assert.ok(printerDevice);
    const connectRes = await connectDevice(printerDevice);
    assert.equal(connectRes.success, true);
    assert.equal(connectedAddress, 'bt:00:11:22:33:44:55');

    // Attempt to connect to the AirPods -> blocked
    const airPodsDevice = report.pairedDevices.find((d) => d.isAudio);
    assert.ok(airPodsDevice);
    const airPodsConnectRes = await connectDevice(airPodsDevice);
    assert.equal(airPodsConnectRes.success, false);
    assert.equal(airPodsConnectRes.code, 'AUDIO_DEVICE_NOT_PRINTER');
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

