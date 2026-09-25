/**
 * services/printer/printerTransport.js
 *
 * The ONLY module that touches the native thermal-printer library.
 * Everything else in the app talks to this adapter, so swapping libraries
 * (e.g. to `@finan-me/react-native-thermal-printer`) is a single-file change.
 *
 * Native library: `react-native-thermal-printer-driver`
 *   - Bluetooth Classic (bt:) + BLE (ble:) + TCP (tcp:) on Android
 *   - printImage(address, base64, { width }) with Floyd–Steinberg dithering
 *   - printRaw(address, bytes) for raw ESC/POS
 *
 * The module is loaded lazily inside try/catch so the JS layer stays loadable
 * under plain Node (headless tests) and on platforms without the native module.
 */

let injectedTransport = null;
let nativeModule;
let nativeNamespace = null;
let nativeResolved = false;

/**
 * Resolve the native module defensively.
 *
 * On the New Architecture the library calls
 * `TurboModuleRegistry.getEnforcing('ThermalPrinterDriver')`, which THROWS when
 * the native binary does not contain the module (e.g. running in Expo Go, or a
 * build made before the dependency was added). That throw can happen at require
 * time OR lazily on first property access, so we materialize the module AND touch
 * the methods we depend on here — all inside try/catch — so it can never escape
 * and red-box the app.
 */
/**
 * Return the raw native TurboModule (or null) WITHOUT loading the library.
 *
 * We must probe first: the library's entry module executes
 * `TurboModuleRegistry.getEnforcing('ThermalPrinterDriver')` at top level, so
 * merely requiring it throws when the native binary lacks the module
 * (Expo Go, or an APK built before this dependency existed).
 * `TurboModuleRegistry.get()` is the non-throwing variant → returns null.
 *
 * We keep the raw module because the library's JS `print()` wrapper DISCARDS the
 * result of image printing (see printImage below), so we call the TurboModule
 * directly for accurate success/failure reporting.
 */
function getNativeTurboModule() {
  try {
    // eslint-disable-next-line global-require
    const RN = require('react-native');
    if (!RN) return null;

    const registry = RN.TurboModuleRegistry;
    if (registry && typeof registry.get === 'function') {
      const found = registry.get('ThermalPrinterDriver');
      if (found) return found;
    }

    const legacy = RN.NativeModules;
    if (legacy && legacy.ThermalPrinterDriver) return legacy.ThermalPrinterDriver;

    return null;
  } catch (e) {
    return null;
  }
}

function nativeTurboModulePresent() {
  return Boolean(getNativeTurboModule());
}

function resolveNative() {
  if (nativeResolved) return nativeModule;
  nativeResolved = true;
  try {
    // Never evaluate the library when the native module is absent.
    if (!nativeTurboModulePresent()) {
      nativeModule = null;
      return nativeModule;
    }

    // eslint-disable-next-line global-require
    const mod = require('react-native-thermal-printer-driver');
    nativeNamespace = mod || null;
    const candidate = (mod && (mod.default || mod)) || null;
    // Touch the API surface so any lazy lookup happens inside this try too.
    nativeModule = candidate && typeof candidate.scan === 'function' ? candidate : null;
  } catch (e) {
    nativeModule = null;
  }
  return nativeModule;
}

function active() {
  try {
    if (injectedTransport) return injectedTransport;
    return resolveNative();
  } catch (e) {
    return null;
  }
}

/**
 * Test seam — inject a mock transport implementing the same surface.
 * Pass null to fall back to the real native module.
 */
export function __setTransport(transport) {
  injectedTransport = transport;
}

let injectedPermissionProbe = null;

/** Test seam — override the runtime permission probe. */
export function __setPermissionProbe(probe) {
  injectedPermissionProbe = probe;
}

/**
 * True when a transport implementation is present AND the platform exposes it.
 * The native module exposes `scan`; absence means the native module is unavailable
 * (Expo Go, unsupported platform, or a build without the dependency).
 */
export function isAvailable() {
  try {
    const t = active();
    return Boolean(t && typeof t.scan === 'function');
  } catch (e) {
    return false;
  }
}

export function isAudioDevice(device) {
  if (!device || typeof device !== 'object') return false;
  if (device.isAudio === true) return true;
  if (device.majorClass === 'audio') return true;
  const name = String(device.name || '').toLowerCase();
  return /airpod|buds|headphone|earphone|earbud|hoco|audio|speaker|headset|sound|wh-|wf-|beats|jbl|boat/i.test(name);
}

function normalizeDevice(device) {
  if (!device || typeof device !== 'object') return null;
  const address = device.address || device.id || null;
  if (!address) return null;
  const name = device.name || 'Unknown device';
  const isAudio = isAudioDevice({ ...device, name });
  const majorClass = device.majorClass || (isAudio ? 'audio' : 'unknown');

  return {
    name,
    address: String(address),
    deviceType: device.deviceType || device.type || 'unknown',
    rssi: typeof device.rssi === 'number' ? device.rssi : undefined,
    majorClass,
    isAudio,
    isConnected: Boolean(device.isConnected)
  };
}

/** Scan returns { paired, found } with normalized devices. */
export async function scan() {
  const t = active();
  if (!t || typeof t.scan !== 'function') {
    throw Object.assign(new Error('Transport unavailable'), { code: 'BLUETOOTH_NOT_SUPPORTED' });
  }
  const result = (await t.scan()) || {};
  const paired = (result.paired || []).map(normalizeDevice).filter(Boolean);
  const found = (result.found || []).map(normalizeDevice).filter(Boolean);
  return { paired, found };
}

export async function stopScan() {
  const t = active();
  if (t && typeof t.stopScan === 'function') {
    try { await t.stopScan(); } catch (e) {}
  }
}

export const DEFAULT_CONNECT_TIMEOUT_MS = 12000;

/**
 * Connect with a HARD finite timeout.
 *
 * Neither native transport bounds its own connect:
 *   - BleTransport.connect()  → awaits a GATT callback with NO withTimeout()
 *   - BluetoothClassicTransport.connect() → blocks on BluetoothSocket.connect()
 * so a printer that is off / out of range can hang the UI indefinitely.
 *
 * We race the connect against a timer and, on timeout OR failure, close whatever
 * the native layer may have left half-open — so the UI can never get stuck on
 * "Connecting…" and no stale connection is left in the ConnectionPool.
 */
export async function connect(address, options = {}) {
  const t = active();
  if (!t || typeof t.connect !== 'function') {
    throw Object.assign(new Error('Transport unavailable'), { code: 'BLUETOOTH_NOT_SUPPORTED' });
  }

  const timeoutMs = options.timeout || DEFAULT_CONNECT_TIMEOUT_MS;
  let timer = null;

  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(Object.assign(
        new Error(`Connection timed out after ${timeoutMs}ms`),
        { code: 'CONNECTION_TIMEOUT' }
      ));
    }, timeoutMs);
  });

  try {
    await Promise.race([t.connect(address, { timeout: timeoutMs }), timeout]);
    return true;
  } catch (err) {
    // Cancel / close any half-open native connection.
    try {
      if (typeof t.disconnect === 'function') await t.disconnect(address);
    } catch (e) {}
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function disconnect(address) {
  const t = active();
  if (t && typeof t.disconnect === 'function') {
    try { return await t.disconnect(address); } catch (e) { return null; }
  }
  return null;
}

export async function isConnected(address) {
  const t = active();
  if (!t || typeof t.isConnected !== 'function') return false;
  try { return Boolean(await t.isConnected(address)); } catch (e) { return false; }
}

export async function testConnection(address) {
  const t = active();
  if (!t || typeof t.testConnection !== 'function') {
    throw Object.assign(new Error('Transport unavailable'), { code: 'BLUETOOTH_NOT_SUPPORTED' });
  }
  return t.testConnection(address);
}

/**
 * Print a base64 PNG as a 1-bit raster.
 *
 * NOTE: the library's default export has NO `printImage` method. The documented
 * way is `print(address, [image({ base64, width })])` — but that wrapper IGNORES
 * the result of image printing and always resolves `{ success: true }`, so a
 * failed print would be reported as success. We therefore call the TurboModule's
 * `printImage(address, source, sourceType, widthPx, align, keepAlive, timeout)`
 * directly and honour its result, falling back to the wrapper if unavailable.
 */
export async function printImage(address, base64, options = {}) {
  const width = options.width || 384;
  const timeout = options.timeout || 15000;

  // Injected (tests / custom transport) — plain contract.
  if (injectedTransport) {
    if (typeof injectedTransport.printImage !== 'function') {
      throw Object.assign(new Error('Transport unavailable'), { code: 'BLUETOOTH_NOT_SUPPORTED' });
    }
    return injectedTransport.printImage(address, base64, { width, timeout });
  }

  const native = getNativeTurboModule();
  if (native && typeof native.printImage === 'function') {
    const result = await native.printImage(address, base64, 'base64', width, 0, false, timeout);
    assertPrintSucceeded(result);
    return result;
  }

  const t = resolveNative();
  if (!t || typeof t.print !== 'function') {
    throw Object.assign(new Error('Transport unavailable'), { code: 'BLUETOOTH_NOT_SUPPORTED' });
  }

  const imageNode = nativeNamespace && nativeNamespace.image;
  if (typeof imageNode !== 'function') {
    throw Object.assign(new Error('Transport unavailable'), { code: 'BLUETOOTH_NOT_SUPPORTED' });
  }

  const result = await t.print(address, [imageNode({ base64, width })], { timeout, keepAlive: false });
  assertPrintSucceeded(result);
  return result;
}

export async function printRaw(address, bytes, options = {}) {
  const t = active();
  if (!t || typeof t.printRaw !== 'function') {
    throw Object.assign(new Error('Transport unavailable'), { code: 'BLUETOOTH_NOT_SUPPORTED' });
  }
  const result = await t.printRaw(address, bytes, { timeout: options.timeout || 15000, keepAlive: false });
  assertPrintSucceeded(result);
  return result;
}

/**
 * The native side RESOLVES with `{ success: false, error }` instead of throwing,
 * and `error` is a plain string (not an ErrorInfo object). Normalise that into a
 * throwable error carrying a `code` our resolver understands.
 */
function assertPrintSucceeded(result) {
  if (result && result.success === false) {
    const raw = result.error;
    const message = typeof raw === 'string'
      ? raw
      : (raw && raw.message) || 'Print failed';
    const code = (raw && raw.code) || 'WRITE_FAILED';
    throw Object.assign(new Error(message), { code });
  }
}

export function onConnectionChanged(callback) {
  const t = active();
  if (!t || typeof t.onConnectionChanged !== 'function') {
    return { remove() {} };
  }
  try {
    return t.onConnectionChanged(callback) || { remove() {} };
  } catch (e) {
    return { remove() {} };
  }
}

/**
 * Send raw bytes in chunks, halving the chunk size when the link rejects an
 * oversized write. BLE stacks that negotiate a small ATT MTU (23 -> 20 byte
 * payload) reject large writes; this keeps the receipt flowing instead of failing.
 *
 * Exported so the fallback can be unit-tested without a printer.
 */
export async function sendChunks(writeFn, bytes, options = {}) {
  const minChunk = options.minChunkSize || 20;
  let chunkSize = options.initialChunkSize || 100;
  let offset = 0;
  let packets = 0;
  let maxChunk = 0;

  if (!bytes || bytes.length === 0) return { packets, maxChunk, chunkSize };

  while (offset < bytes.length) {
    const chunk = bytes.slice(offset, offset + chunkSize);
    try {
      await writeFn(chunk);
      offset += chunk.length;
      packets += 1;
      maxChunk = Math.max(maxChunk, chunk.length);
    } catch (err) {
      if (chunkSize > minChunk) {
        chunkSize = Math.max(minChunk, Math.floor(chunkSize / 2));
        continue;
      }
      throw err;
    }
  }

  return { packets, maxChunk, chunkSize };
}

/**
 * Android runtime permissions.
 *
 * Declaring permissions in AndroidManifest is NOT enough: BLUETOOTH_SCAN /
 * BLUETOOTH_CONNECT (Android 12+) and ACCESS_FINE_LOCATION (Android 6-11) are
 * RUNTIME permissions and must be requested from a user action. Without this the
 * scan silently fails and the user sees only "permission required" with no dialog.
 *
 * Returns { granted, blocked, platform }.
 * `blocked` means Android will no longer show the dialog (user chose
 * "don't ask again") — the UI must then send them to system Settings.
 * On non-Android (or when unavailable, e.g. headless tests) this is a no-op.
 */
export async function requestPermissions() {
  if (injectedPermissionProbe) {
    try {
      return await injectedPermissionProbe();
    } catch (e) {
      return { granted: true, blocked: false, platform: 'probe-error' };
    }
  }

  try {
    // eslint-disable-next-line global-require
    const RN = require('react-native');
    const { PermissionsAndroid, Platform } = RN || {};

    if (!Platform || Platform.OS !== 'android' || !PermissionsAndroid) {
      return { granted: true, blocked: false, platform: (Platform && Platform.OS) || 'unknown' };
    }

    const apiLevel = typeof Platform.Version === 'number'
      ? Platform.Version
      : parseInt(Platform.Version, 10) || 0;

    const RESULTS = PermissionsAndroid.RESULTS || {};
    const isBlocked = (status) => status === 'never_ask_again';
    const isGranted = (status) => status === RESULTS.GRANTED || status === 'granted';

    if (apiLevel >= 31) {
      const statuses = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
      ]);
      const scan = statuses['android.permission.BLUETOOTH_SCAN'];
      const connect = statuses['android.permission.BLUETOOTH_CONNECT'];

      return {
        granted: isGranted(scan) && isGranted(connect),
        blocked: isBlocked(scan) || isBlocked(connect),
        platform: 'android31+'
      };
    }

    const status = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
    );
    return {
      granted: isGranted(status),
      blocked: isBlocked(status),
      platform: 'android<31'
    };
  } catch (e) {
    // Never let a permission probe crash the app; treat as "not applicable".
    return { granted: true, blocked: false, platform: 'unknown', error: e && e.message };
  }
}

/**
 * Open the app's system settings page (used when permissions are permanently denied).
 */
export async function openAppSettings() {
  try {
    // eslint-disable-next-line global-require
    const RN = require('react-native');
    const Linking = RN && RN.Linking;
    if (Linking && typeof Linking.openSettings === 'function') {
      await Linking.openSettings();
      return true;
    }
  } catch (e) {}
  return false;
}
