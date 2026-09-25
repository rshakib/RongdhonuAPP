#!/usr/bin/env node
/**
 * printer-test.js — standalone thermal printer diagnostic
 *
 * Run:   node printer-test.js
 *
 * ---------------------------------------------------------------------------
 * READ THIS FIRST (why this file cannot physically print from your laptop)
 * ---------------------------------------------------------------------------
 * Printing goes through `react-native-thermal-printer-driver`, a NATIVE Android
 * TurboModule. Bluetooth scanning/connecting/writing only exists inside the
 * running Android app — it is backed by Android's BluetoothAdapter /
 * BluetoothGatt. Desktop Node has no React Native bridge and no Android
 * Bluetooth stack, so `require('react-native')` fails and the native module is
 * absent (isPrinterPlatformAvailable() === false).
 *
 * Therefore this script CANNOT do steps 1–4 (scan → find → connect → print)
 * on your computer. Any script claiming otherwise would be printing fake output.
 *
 * What this script DOES do, honestly:
 *   • loads the REAL production printer pipeline (services/printer/*)
 *   • builds the exact test receipt you specified
 *   • runs the REAL printReceipt() against an injected recording transport
 *   • reports whether the pipeline reached the transport, and with what payload
 *   • prints the EXACT receipt text that the raster is generated from
 *   • reports CRISP pass/fail with the real error message on failure
 *
 * To PHYSICALLY print, run the app on the Android phone and tap:
 *   Printer Settings (প্রিন্টার সেটিংস) → "🧾 টেস্ট রসিদ প্রিন্ট করুন"
 * that path calls scanAndConnect() + printTestReceipt() on real hardware.
 * ---------------------------------------------------------------------------
 */

const printer = require('./services/printer/printerManager.js');
const transport = require('./services/printer/printerTransport.js');
const settings = require('./services/printer/printerSettings.js');
const { formatReceiptText } = require('./services/printer/receiptData.js');

// ---------------------------------------------------------------------------
// 1. The exact test receipt requested
// ---------------------------------------------------------------------------
const now = new Date();
const TODAY = now.toISOString().substring(0, 10);
const NOW = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const BAR = '--------------------------------';

const TEST_RECEIPT = [
  BAR,
  '   রংধনু ক্যাফে এন্ড রেস্টুরেন্ট',
  BAR,
  '   ** PRINTER TEST **',
  BAR,
  `Date: ${TODAY}`,
  `Time: ${NOW}`,
  BAR,
  'Item 1 x 2 = 160',
  'Item 2 x 1 = 90',
  BAR,
  'মোট: 250',
  'ছাড়: 0',
  'পরিশোধ: 250',
  BAR,
  'Payment: Cash',
  BAR,
  '  ধন্যবাদ আবার আসবেন! 🙏',
  BAR
].join('\n');

// Same data expressed as an order object, so it flows through the REAL pipeline.
const TEST_ORDER = {
  id: `PRINTER-TEST-${Date.now()}`,
  tableId: 'TEST',
  fullDate: TODAY,
  time: NOW,
  items: [
    { name: 'Item 1', qty: 2, price: 80, total: 160 },
    { name: 'Item 2', qty: 1, price: 90, total: 90 }
  ],
  totalAmount: 250,
  paidAmount: 250,
  paymentMethod: 'Cash'
};

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function line(char = '─') { console.log(char.repeat(64)); }
function step(n, text) { console.log(`\n[${n}] ${text}`); }

function makeStorage(address) {
  const map = new Map(Object.entries({
    printer_address: address,
    printer_name: 'TEST-PRINTER',
    printer_transport: address.split(':')[0],
    printer_last_connected_at: new Date().toISOString()
  }));
  return {
    get: (k) => (map.has(k) ? map.get(k) : null),
    set: (k, v) => { map.set(k, String(v)); },
    remove: (k) => { map.delete(k); }
  };
}

// Records everything the pipeline hands to the native layer.
const transportLog = [];
function makeRecordingTransport() {
  return {
    scan: async () => ({ paired: [{ name: 'TEST-PRINTER', address: 'AA:BB:CC:DD:EE:FF', deviceType: 'bt' }], found: [] }),
    stopScan: async () => {},
    connect: async (address) => { transportLog.push({ call: 'connect', address }); },
    disconnect: async (address) => { transportLog.push({ call: 'disconnect', address }); },
    isConnected: async (address) => { transportLog.push({ call: 'isConnected', address }); return true; },
    testConnection: async () => ({ success: true }),
    printRaw: async (address, bytes) => { transportLog.push({ call: 'printRaw', address, bytes: bytes && bytes.length }); return { success: true }; },
    printImage: async (address, base64, opts) => {
      transportLog.push({ call: 'printImage', address, base64Bytes: base64 ? base64.length : 0, width: opts && opts.width });
      return { success: true, bytesWritten: base64 ? base64.length : 0 };
    },
    onConnectionChanged: () => ({ remove() {} })
  };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  line('═');
  console.log('  RONGDHONU — THERMAL PRINTER TEST');
  line('═');

  step(1, 'Platform / native module check');
  const available = typeof printer.isPrinterPlatformAvailable === 'function'
    ? printer.isPrinterPlatformAvailable()
    : false;
  console.log(`   native printer module available : ${available}`);
  console.log(`   runtime                        : Node ${process.version} (desktop)`);
  if (!available) {
    console.log('   → Expected on desktop. The Android TurboModule is NOT present here,');
    console.log('     so steps 2–4 (scan/find/connect/print) cannot talk to hardware.');
  }

  step(2, 'The exact test receipt');
  line();
  console.log(TEST_RECEIPT);
  line();

  step(3, 'Driving the REAL production pipeline (printReceipt) with a recording transport');
  // Wire the real pipeline to the recorder + a fake stored printer address.
  printer.__reset();
  settings.__setStorage(makeStorage('bt:AA:BB:CC:DD:EE:FF'));
  transport.__setTransport(makeRecordingTransport());
  transport.__setPermissionProbe(async () => ({ granted: true, blocked: false, platform: 'test' }));

  // The receipt is printed as a 384-dot raster (Bengali needs an image, not text).
  const FAKE_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  let result;
  try {
    result = await printer.printReceipt(TEST_ORDER, { getBase64: async () => FAKE_PNG_BASE64, force: true });
  } catch (err) {
    result = { success: false, code: 'THREW', message: err && err.message };
  }

  console.log('   transport calls made:');
  transportLog.forEach((c) => console.log('     •', JSON.stringify(c)));
  console.log('   pipeline result:', JSON.stringify(result));

  step(4, 'Also showing the production receipt text for this same order');
  line();
  console.log(formatReceiptText(TEST_ORDER));
  line();

  step(5, 'RESULT');
  if (result && result.success) {
    console.log('   ✅ PRINT SUCCESS (software path)');
    console.log('      The pipeline reached the native transport with a base64 raster payload.');
    console.log('      ⚠️  NO PRINTER WAS CONTACTED — this proves the code path, NOT paper output.');
    console.log('      ⚠️  A real print verdict requires the app running on Android with the printer.');
  } else {
    console.log('   ❌ PRINT FAILED');
    console.log('      code   :', (result && result.code) || '(none)');
    console.log('      message:', (result && result.message) || '(no message)');
  }
  line('═');
  console.log('To print for real: open the app on the Android device →');
  console.log('  প্রিন্টার সেটিংস → "🧾 টেস্ট রসিদ প্রিন্ট করুন"');
  line('═');

  return result && result.success ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('\n❌ PRINT FAILED — unexpected error');
    console.error('   message:', err && err.message);
    console.error(err && err.stack);
    process.exit(1);
  });
