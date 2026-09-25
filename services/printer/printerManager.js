/**
 * services/printer/printerManager.js
 *
 * Orchestrates the native thermal printer: connection status, connect/scan,
 * the (deduped) print pipeline, and Bangla error reporting.
 *
 * Design rules honoured here:
 *  - Never scan automatically. Scanning only happens on an explicit user gesture.
 *  - "Compatible / Verified" is NEVER inferred from pairing or a successful connect;
 *    it requires a user-confirmed physical test print (test_confirmed_at).
 *  - A write failure/timeout is reported as UNCERTAIN and is never auto-retried,
 *    so a receipt is never duplicated.
 */

import {
  isAvailable,
  scan as transportScan,
  connect as transportConnect,
  disconnect as transportDisconnect,
  printImage as transportPrintImage,
  onConnectionChanged as transportOnConnectionChanged,
  requestPermissions as transportRequestPermissions,
  isAudioDevice,
  DEFAULT_CONNECT_TIMEOUT_MS
} from './printerTransport.js';

import {
  loadSettings,
  savePrinterSelection,
  markTestTransmitted,
  markTestConfirmed,
  markBannerDismissed,
  forgetPrinter as clearPrinterSettings
} from './printerSettings.js';

import { logDiagnosticEvent } from './printerDiagnostic.js';

/** 58mm paper = 384 printable dots. The receipt raster is captured at this width. */
export const RECEIPT_RASTER_WIDTH = 384;

export const STATUS = {
  CONNECTED_READY: 'CONNECTED_READY',
  PREVIOUSLY_SELECTED_DISCONNECTED: 'PREVIOUSLY_SELECTED_DISCONNECTED',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  PLATFORM_UNSUPPORTED: 'PLATFORM_UNSUPPORTED',
  FOUND_UNVERIFIED: 'FOUND_UNVERIFIED'
};

export const MESSAGES = {
  NOT_CONNECTED: 'প্রিন্টার কানেক্ট করুন',
  PLATFORM_UNSUPPORTED: 'এই বিল্ডে প্রিন্টার সাপোর্ট নেই — ইনস্টল করা অ্যাপ (APK) দিয়ে চেষ্টা করুন',
  BLUETOOTH_DISABLED: 'ব্লুটুথ চালু করুন',
  BLUETOOTH_NOT_SUPPORTED: 'এই ডিভাইসে ব্লুটুথ নেই',
  BLUETOOTH_PERMISSION_DENIED: 'ব্লুটুথ পারমিশন দরকার — "Allow" চাপুন',
  PERMISSION_BLOCKED: 'পারমিশন স্থায়ীভাবে বন্ধ আছে — সেটিংস থেকে Bluetooth চালু করুন',
  DEVICE_NOT_FOUND: 'প্রিন্টার পাওয়া যায়নি',
  SCAN_FAILED: 'প্রিন্টার খোঁজা ব্যর্থ হয়েছে — ফোনের লোকেশন (GPS) চালু আছে কিনা দেখুন',
  SCAN_TIMEOUT: 'প্রিন্টার খোঁজার সময় শেষ হয়েছে',
  CONNECTION_FAILED: 'প্রিন্টারের সাথে কানেক্ট করা যায়নি',
  CONNECTION_LOST: 'প্রিন্টার সংযোগ বিচ্ছিন্ন হয়েছে',
  CONNECTION_TIMEOUT: 'কানেকশন সময় শেষ হয়েছে',
  WRITE_FAILED: 'প্রিন্ট পাঠানো যায়নি',
  PRINT_TIMEOUT: 'প্রিন্টের সময় শেষ হয়েছে',
  INVALID_ADDRESS: 'প্রিন্টারের অ্যাড্রেস সঠিক নয়',
  UNSUPPORTED_TRANSPORT: 'এই ধরনের প্রিন্টার সাপোর্টেড নয়',
  IMAGE_LOAD_FAILED: 'রসিদ তৈরি করা যায়নি',
  IMAGE_DECODE_FAILED: 'রসিদ তৈরি করা যায়নি',
  INVALID_DATA: 'রসিদের তথ্য সঠিক নয়',
  CAPTURE_FAILED: 'রসিদ তৈরি করা যায়নি',
  BUSY: 'একটি প্রিন্ট আগেই চলছে',
  AUDIO_DEVICE_NOT_PRINTER: 'এটি অডিও ডিভাইস (AirPods/হেডসেট) — প্রিন্টার নয়। প্রিন্ট বা কানেক্ট করা যাবে না।',
  UNCERTAIN: 'প্রিন্ট সফল হয়েছে কিনা নিশ্চিত নয় — কাগজ দেখে আবার চেষ্টা করুন'
};

// A write-level failure here means the receipt MAY have been (partly) printed.
const UNCERTAIN_CODES = ['WRITE_FAILED', 'PRINT_TIMEOUT', 'CONNECTION_LOST'];

/**
 * The native scanner rejects with its own string codes (see DeviceScanner.kt),
 * which are NOT the library's ErrorCode enum values. Map them to ours.
 */
const NATIVE_CODE_ALIASES = {
  BT_DISABLED: 'BLUETOOTH_DISABLED',
  BT_NOT_SUPPORTED: 'BLUETOOTH_NOT_SUPPORTED',
  BT_PERMISSION: 'BLUETOOTH_PERMISSION_DENIED',
  SCAN_ERROR: 'SCAN_FAILED',
  STOP_SCAN_ERROR: 'SCAN_FAILED'
};

export function getErrorMessage(code) {
  return MESSAGES[code] || 'প্রিন্ট করা যায়নি';
}

/**
 * Map a thrown transport/library error to { code, message, retryable, uncertain }.
 */
export function resolveError(err) {
  const rawCode = err && err.code ? String(err.code) : '';
  const code = NATIVE_CODE_ALIASES[rawCode] || rawCode;
  const message = err && err.message ? String(err.message) : '';

  if (UNCERTAIN_CODES.includes(code)) {
    return { code: 'UNCERTAIN', cause: code, message: MESSAGES.UNCERTAIN, retryable: false, uncertain: true };
  }
  if (code && MESSAGES[code]) {
    return { code, message: MESSAGES[code], retryable: true, uncertain: false };
  }
  if (/permission/i.test(message)) {
    return { code: 'BLUETOOTH_PERMISSION_DENIED', message: MESSAGES.BLUETOOTH_PERMISSION_DENIED, retryable: true, uncertain: false };
  }
  if (/not (found|available)|no device/i.test(message)) {
    return { code: 'DEVICE_NOT_FOUND', message: MESSAGES.DEVICE_NOT_FOUND, retryable: true, uncertain: false };
  }
  if (/timeout|timed out/i.test(message)) {
    return { code: 'CONNECTION_TIMEOUT', message: MESSAGES.CONNECTION_TIMEOUT, retryable: true, uncertain: false };
  }
  return { code: 'CONNECTION_FAILED', message: MESSAGES.CONNECTION_FAILED, retryable: true, uncertain: false };
}

/**
 * Pure status derivation — exported so it can be unit-tested directly.
 */
export function computeStatus({ available, address, connected, confirmed }) {
  if (!available) return STATUS.PLATFORM_UNSUPPORTED;
  if (!address) return STATUS.NOT_CONFIGURED;
  if (!connected) return STATUS.PREVIOUSLY_SELECTED_DISCONNECTED;
  if (!confirmed) return STATUS.FOUND_UNVERIFIED;
  return STATUS.CONNECTED_READY;
}

/**
 * Compose the address string the native TransportFactory expects.
 *
 * Verified against the library source:
 *  - DeviceScanner.kt returns a RAW MAC ("AA:BB:CC:DD:EE:FF") with no scheme.
 *  - TransportFactory.kt requires "bt:" (Classic/SPP), "ble:" (GATT) or
 *    "lan:" (TCP) and throws "Unknown transport scheme '<x>'" otherwise.
 * So connecting with the scanned address directly (as the README example does)
 * always fails; the scheme must be added here.
 */
export function toWireAddress(device) {
  const raw = String((device && device.address) || '').trim();
  if (!raw) return '';
  if (/^(bt|ble|lan):/i.test(raw)) return raw;

  const type = String((device && (device.transport || device.deviceType)) || '').toLowerCase();
  if (type === 'ble') return `ble:${raw}`;
  // 'bt', 'dual' and 'unknown' → Bluetooth Classic: 58mm ESC/POS printers are
  // overwhelmingly Classic/SPP, so it is the safer default.
  return `bt:${raw}`;
}

// ---- in-memory state ----
let state = {
  status: STATUS.NOT_CONFIGURED,
  available: false,
  address: null,
  name: null,
  transport: null,
  connected: false,
  connecting: false,
  testTransmittedAt: null,
  testConfirmedAt: null,
  bannerDismissedAt: null
};

const listeners = new Set();

let inFlightKey = null;
let lastSuccessKey = null;
let connectInFlight = false;

function emit() {
  const snapshot = getStatus();
  listeners.forEach((fn) => {
    try { fn(snapshot); } catch (e) {}
  });
}

export function getStatus() {
  return Object.assign({}, state, { verified: Boolean(state.testConfirmedAt) });
}

export function subscribe(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function applySettings(settings, connected) {
  state = Object.assign({}, state, {
    address: settings.address,
    name: settings.name,
    transport: settings.transport,
    testTransmittedAt: settings.testTransmittedAt,
    testConfirmedAt: settings.testConfirmedAt,
    bannerDismissedAt: settings.bannerDismissedAt,
    connected: Boolean(connected)
  });
  state.available = isAvailable();
  state.status = computeStatus({
    available: state.available,
    address: state.address,
    connected: state.connected,
    confirmed: Boolean(state.testConfirmedAt)
  });
  return state;
}

/**
 * Re-read persisted settings and report the LAST KNOWN state.
 *
 * IMPORTANT: this deliberately does NOT touch the radio.
 * The native `isConnected()`/`testConnection()` path performs a REAL connection
 * attempt (ConnectionPool.getOrCreate() → transport.connect()), so calling it on
 * startup would auto-connect to a saved printer and could block the UI for the
 * full connection timeout. Connection state is therefore tracked in memory and
 * only ever changes when the user explicitly taps Connect / Disconnect.
 */
export async function refresh() {
  const settings = await loadSettings();

  // If the saved printer changed (or was forgotten), we cannot still be connected.
  const samePrinter = Boolean(settings.address) && settings.address === state.address;
  const connected = samePrinter ? state.connected : false;

  applySettings(settings, connected);
  emit();
  return getStatus();
}

/**
 * Scan nearby and paired Bluetooth devices without automatically selecting any device.
 * Returns { success: true, paired: [], found: [] } or error object.
 */
export async function scanForDevices() {
  if (!isAvailable()) {
    const result = { success: false, code: 'PLATFORM_UNSUPPORTED', message: MESSAGES.PLATFORM_UNSUPPORTED };
    state.status = STATUS.PLATFORM_UNSUPPORTED;
    emit();
    return result;
  }

  const permissionDenied = await ensurePermissions();
  if (permissionDenied) {
    logDiagnosticEvent('DISCOVERY_FAILED', { code: permissionDenied.code, error: permissionDenied.message });
    return permissionDenied;
  }

  logDiagnosticEvent('DISCOVERY_STARTED');
  const scanStart = Date.now();
  try {
    const devices = await transportScan();
    const paired = (devices && devices.paired) || [];
    const found = (devices && devices.found) || [];
    logDiagnosticEvent('DISCOVERY_COMPLETED', {
      pairedCount: paired.length,
      foundCount: found.length,
      durationMs: Date.now() - scanStart
    });
    return {
      success: true,
      paired,
      found
    };
  } catch (err) {
    const mapped = resolveError(err);
    logDiagnosticEvent('DISCOVERY_FAILED', {
      code: mapped.code,
      error: mapped.message,
      durationMs: Date.now() - scanStart
    });
    return Object.assign({ success: false }, mapped);
  }
}

/**
 * Temporary Bluetooth Detection Test helper.
 * Inspects bonded and scanned devices to identify whether Bluetooth audio
 * devices (like AirPods Pro or Hoco earphones) are detected and connected,
 * WITHOUT attempting any printer socket connection.
 */
export async function getBluetoothDetectionReport() {
  if (!isAvailable()) {
    return {
      success: false,
      code: 'PLATFORM_UNSUPPORTED',
      message: MESSAGES.PLATFORM_UNSUPPORTED,
      airPodsDetected: false,
      audioDevices: [],
      pairedDevices: [],
      foundDevices: []
    };
  }

  const permissionDenied = await ensurePermissions();
  if (permissionDenied) {
    return Object.assign({
      airPodsDetected: false,
      audioDevices: [],
      pairedDevices: [],
      foundDevices: []
    }, permissionDenied);
  }

  try {
    const devices = await transportScan();
    const paired = (devices && devices.paired) || [];
    const found = (devices && devices.found) || [];
    const allDevices = [...paired, ...found];

    const audioDevices = allDevices.filter(isAudioDevice);
    const airPods = audioDevices.find((d) => /airpod/i.test(d.name)) || null;

    return {
      success: true,
      airPodsDetected: Boolean(airPods),
      airPodsDevice: airPods,
      audioDevices,
      pairedDevices: paired,
      foundDevices: found
    };
  } catch (err) {
    const mapped = resolveError(err);
    return Object.assign({
      success: false,
      airPodsDetected: false,
      audioDevices: [],
      pairedDevices: [],
      foundDevices: []
    }, mapped);
  }
}

/**
 * Connect to a specific user-selected device.
 */
export async function connectDevice(device, options = {}) {
  return connectTo(device, options);
}

/**
 * Non-blocking auto-connect to the saved printer.
 * Returns immediately if no printer is saved or if already connected.
 */
export async function autoConnectSavedPrinter(options = {}) {
  if (!isAvailable()) {
    return { success: false, code: 'PLATFORM_UNSUPPORTED', message: MESSAGES.PLATFORM_UNSUPPORTED };
  }

  const settings = await loadSettings();
  if (!settings || !settings.address) {
    return { success: false, code: 'NOT_CONFIGURED', message: 'কোনো প্রিন্টার কনফিগার করা নেই' };
  }

  if (state.connected && state.address === settings.address) {
    return { success: true, alreadyConnected: true, status: state.status, name: state.name, address: state.address };
  }

  if (connectInFlight) {
    return { success: false, code: 'BUSY', message: MESSAGES.BUSY };
  }

  const timeoutMs = options.timeout || 6000;
  return connectKnown({ timeout: timeoutMs });
}

/**
 * Explicit user-initiated scan + connect. Prefers an already-paired device.
 */
export async function scanAndConnect(options = {}) {
  if (!isAvailable()) {
    const result = { success: false, code: 'PLATFORM_UNSUPPORTED', message: MESSAGES.PLATFORM_UNSUPPORTED };
    state.status = STATUS.PLATFORM_UNSUPPORTED;
    emit();
    return result;
  }

  const permissionDenied = await ensurePermissions();
  if (permissionDenied) return permissionDenied;

  let devices;
  try {
    devices = await transportScan();
  } catch (err) {
    const mapped = resolveError(err);
    return Object.assign({ success: false }, mapped);
  }

  // Merge paired + found, then pick the first device that is NOT an audio device
  // (e.g. AirPods). paired[0] alone is wrong when headphones are bonded before
  // the thermal printer. The audio guard inside connectTo() stays as a safety net.
  const allDevices = [...(devices.paired || []), ...(devices.found || [])];
  const candidate = allDevices.find(d => !isAudioDevice(d)) || null;
  if (!candidate) {
    return { success: false, code: 'DEVICE_NOT_FOUND', message: MESSAGES.DEVICE_NOT_FOUND };
  }

  return connectTo(candidate, options);
}

/**
 * Connect using the previously selected printer address.
 */
export async function connectKnown(options = {}) {
  const settings = await loadSettings();
  if (!settings.address) {
    return { success: false, code: 'DEVICE_NOT_FOUND', message: MESSAGES.DEVICE_NOT_FOUND };
  }
  return connectTo({ address: settings.address, name: settings.name, deviceType: settings.transport }, options);
}

/**
 * Ask Android for the Bluetooth runtime permissions.
 * Declaring them in the manifest is not enough — without this the scan fails
 * silently and the user only ever sees "permission required".
 */
async function ensurePermissions() {
  let result;
  try {
    result = await transportRequestPermissions();
  } catch (e) {
    return null; // probe failure must not block a non-Android platform
  }

  // null === allowed to proceed
  if (!result || result.granted) return null;

  return {
    success: false,
    code: result.blocked ? 'PERMISSION_BLOCKED' : 'BLUETOOTH_PERMISSION_DENIED',
    message: result.blocked ? MESSAGES.PERMISSION_BLOCKED : MESSAGES.BLUETOOTH_PERMISSION_DENIED,
    canOpenSettings: Boolean(result.blocked)
  };
}

/** Recompute the status from current in-memory state and notify listeners. */
function recomputeStatus() {
  state.available = isAvailable();
  state.status = computeStatus({
    available: state.available,
    address: state.address,
    connected: state.connected,
    confirmed: Boolean(state.testConfirmedAt)
  });
  emit();
}

async function connectTo(device, options = {}) {
  if (!isAvailable()) {
    return { success: false, code: 'PLATFORM_UNSUPPORTED', message: MESSAGES.PLATFORM_UNSUPPORTED };
  }

  // Guard: AirPods or audio devices must never be connected as printers
  if (isAudioDevice(device)) {
    return {
      success: false,
      code: 'AUDIO_DEVICE_NOT_PRINTER',
      message: MESSAGES.AUDIO_DEVICE_NOT_PRINTER
    };
  }

  // Prevent duplicate/parallel connection attempts (double-tap on Connect).
  if (connectInFlight) {
    return { success: false, code: 'BUSY', message: MESSAGES.BUSY };
  }

  const permissionDenied = await ensurePermissions();
  if (permissionDenied) return permissionDenied;

  // Scanned addresses are raw MACs; the native layer needs a "bt:"/"ble:" scheme.
  const wireAddress = toWireAddress(device);
  if (!wireAddress) {
    return { success: false, code: 'INVALID_ADDRESS', message: MESSAGES.INVALID_ADDRESS };
  }

  connectInFlight = true;
  state.connecting = true;
  emit();

  const startTime = Date.now();
  logDiagnosticEvent('CONNECT_ATTEMPT', {
    name: device.name || 'Bluetooth Printer',
    wireAddress,
    transport: wireAddress.split(':')[0],
    timeoutMs: options.timeout || DEFAULT_CONNECT_TIMEOUT_MS
  });

  try {
    // transportConnect() applies a hard finite timeout and closes any half-open
    // connection, so this can never hang the UI indefinitely.
    await transportConnect(wireAddress, { timeout: options.timeout || DEFAULT_CONNECT_TIMEOUT_MS });
    logDiagnosticEvent('CONNECT_SUCCESS', {
      name: device.name || 'Bluetooth Printer',
      wireAddress,
      transport: wireAddress.split(':')[0],
      durationMs: Date.now() - startTime
    });
  } catch (err) {
    const mapped = resolveError(err);
    logDiagnosticEvent('CONNECT_FAILED', {
      name: device.name,
      wireAddress,
      code: mapped.code,
      error: mapped.message,
      durationMs: Date.now() - startTime
    });
    state.connected = false;
    recomputeStatus();
    return Object.assign({ success: false }, mapped);
  } finally {
    connectInFlight = false;
    state.connecting = false;
  }

  await savePrinterSelection({
    address: wireAddress,
    name: device.name || 'Bluetooth Printer',
    transport: wireAddress.split(':')[0]
  });

  // Adopt the new printer as the active connection (in-memory only — we never
  // probe the radio, so app startup cannot trigger a connection).
  state = Object.assign({}, state, {
    address: wireAddress,
    name: device.name || 'Bluetooth Printer',
    transport: wireAddress.split(':')[0],
    connected: true
  });
  recomputeStatus();

  return { success: true, status: state.status, name: state.name, address: state.address };
}

export async function disconnect() {
  const target = state.address;
  if (state.address) await transportDisconnect(state.address);
  state.connected = false;
  state.connecting = false;
  recomputeStatus();
  logDiagnosticEvent('DISCONNECT', { wireAddress: target });
  return getStatus();
}

export async function forget() {
  await transportDisconnect();
  await clearPrinterSettings();
  inFlightKey = null;
  lastSuccessKey = null;
  await refresh();
  emit();
  return getStatus();
}

export async function dismissBanner() {
  await markBannerDismissed();
  await refresh();
  return getStatus();
}

/**
 * Subscribe to native connection changes so the banner stays accurate.
 */
export function watchConnection() {
  const sub = transportOnConnectionChanged(() => { refresh(); });
  return () => {
    if (sub && typeof sub.remove === 'function') sub.remove();
  };
}

function buildKey(order) {
  if (!order) return 'unknown';
  return `${order.id || order.orderId || ''}|${order.paidAmount ?? order.amount ?? ''}|${order.tableId || order.table || ''}`;
}

/**
 * Core print pipeline.
 *
 * @param {object} order      receipt data
 * @param {object} options    { getBase64: async () => string, dedupeKey, force }
 */
async function runPrint(order, options = {}) {
  if (!isAvailable()) {
    return { success: false, code: 'PLATFORM_UNSUPPORTED', message: MESSAGES.PLATFORM_UNSUPPORTED };
  }
  if (!order) {
    return { success: false, code: 'INVALID_DATA', message: MESSAGES.INVALID_DATA };
  }

  const settings = await loadSettings();
  if (!settings.address) {
    return { success: false, code: 'NOT_CONNECTED', message: MESSAGES.NOT_CONNECTED };
  }

  // Use the in-memory state — do NOT probe the radio here.
  // (native isConnected() would itself open a connection via ConnectionPool.)
  if (!state.connected) {
    return { success: false, code: 'NOT_CONNECTED', message: MESSAGES.NOT_CONNECTED };
  }

  const key = options.dedupeKey || buildKey(order);

  // Duplicate guard — a receipt already transmitted for this key is not sent again.
  if (!options.force && lastSuccessKey && lastSuccessKey === key) {
    return { success: true, deduped: true };
  }
  if (inFlightKey === key) {
    return { success: false, code: 'BUSY', message: MESSAGES.BUSY };
  }

  let base64;
  try {
    base64 = await options.getBase64();
  } catch (err) {
    return Object.assign({ success: false }, resolveError(err), { code: 'CAPTURE_FAILED', message: MESSAGES.CAPTURE_FAILED });
  }
  if (!base64) {
    return { success: false, code: 'CAPTURE_FAILED', message: MESSAGES.CAPTURE_FAILED };
  }

  const printStart = Date.now();
  logDiagnosticEvent('PRINT_SUBMITTED', {
    printType: order && String(order.id).startsWith('TEST') ? 'TEST_RECEIPT' : 'POS_ORDER',
    orderId: order && order.id,
    width: RECEIPT_RASTER_WIDTH,
    dots: RECEIPT_RASTER_WIDTH,
    payloadChars: base64.length,
    wireAddress: settings.address
  });

  inFlightKey = key;
  try {
    await transportPrintImage(settings.address, base64, { width: RECEIPT_RASTER_WIDTH });

    // Software transmission succeeded.
    lastSuccessKey = key;
    await markTestTransmitted();
    state.testTransmittedAt = new Date().toISOString();
    if (options.markTest) state.status = STATUS.FOUND_UNVERIFIED;

    logDiagnosticEvent('PRINT_SUCCESS', {
      orderId: order && order.id,
      wireAddress: settings.address,
      durationMs: Date.now() - printStart
    });

    return { success: true, transmitted: true };
  } catch (err) {
    const mapped = resolveError(err);
    logDiagnosticEvent('PRINT_FAILED', {
      orderId: order && order.id,
      wireAddress: settings.address,
      code: mapped.code,
      error: mapped.message,
      durationMs: Date.now() - printStart
    });
    // Deliberately NO automatic retry — the paper may hold a partial receipt.
    return Object.assign({ success: false }, mapped);
  } finally {
    inFlightKey = null;
  }
}

/**
 * Print a customer receipt.
 *
 * @param {object} order   receipt data
 * @param {object} options { getBase64, force }
 */
export async function printReceipt(order, options = {}) {
  return runPrint(order, options);
}

/**
 * Print a small test receipt through the exact same pipeline.
 */
export async function printTestReceipt(options = {}) {
  const testOrder = {
    id: `TEST-${Date.now()}`,
    tableId: 'TEST',
    fullDate: new Date().toISOString().substring(0, 10),
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    items: [{ name: 'প্রিন্টার টেস্ট রসিদ', qty: 1, price: 0, total: 0 }],
    totalAmount: 0,
    paidAmount: 0,
    paymentMethod: 'TEST PRINT'
  };

  const result = await runPrint(testOrder, {
    getBase64: options.getBase64,
    dedupeKey: testOrder.id,
    markTest: true,
    force: true
  });

  if (result.success) await refresh();
  return result;
}

/**
 * Record the user's confirmation that paper actually came out.
 * Only this flips the status to "Verified on this device".
 */
export async function confirmPhysicalTest(confirmed) {
  await markTestConfirmed(Boolean(confirmed));
  await refresh();
  return getStatus();
}

/** Test seam — reset module state. */
export function __reset() {
  inFlightKey = null;
  lastSuccessKey = null;
  connectInFlight = false;
  listeners.clear();
  state = {
    status: STATUS.NOT_CONFIGURED,
    available: false,
    address: null,
    name: null,
    transport: null,
    connected: false,
    connecting: false,
    testTransmittedAt: null,
    testConfirmedAt: null,
    bannerDismissedAt: null
  };
}
