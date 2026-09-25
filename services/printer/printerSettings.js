/**
 * services/printer/printerSettings.js
 *
 * Device-local persistence for the selected thermal printer.
 *
 * Uses the app's existing `app_config` key/value store (database.js — getAppConfig/setAppConfig).
 * That helper is intentionally local-only (it does not enqueue a cloud sync), which is exactly
 * what we want for a per-device printer choice.
 *
 * `database.js` pulls in expo-sqlite, so it cannot load under plain Node. We therefore load it
 * lazily and fall back to an in-memory map when it is unavailable (headless tests).
 */

export const PRINTER_KEYS = {
  address: 'printer_address',
  name: 'printer_name',
  transport: 'printer_transport',
  lastConnectedAt: 'printer_last_connected_at',
  testTransmittedAt: 'printer_test_transmitted_at',
  testConfirmedAt: 'printer_test_confirmed_at',
  bannerDismissedAt: 'printer_banner_dismissed_at'
};

const ALL_KEYS = Object.values(PRINTER_KEYS);

// ---- storage adapter (injectable for tests) ----
let injectedStorage = null;
let databaseModule;
let databaseResolved = false;
const memoryStore = new Map();

function resolveDatabase() {
  if (databaseResolved) return databaseModule;
  databaseResolved = true;
  try {
    // eslint-disable-next-line global-require
    const db = require('../../database');
    if (db && typeof db.getAppConfig === 'function' && typeof db.setAppConfig === 'function') {
      databaseModule = db;
    }
  } catch (e) {
    databaseModule = null;
  }
  return databaseModule;
}

function getStorage() {
  if (injectedStorage) return injectedStorage;

  const db = resolveDatabase();
  if (db) {
    return {
      get: (key) => db.getAppConfig(key),
      set: (key, value) => db.setAppConfig(key, value),
      remove: (key) => db.setAppConfig(key, '')
    };
  }

  return {
    get: (key) => (memoryStore.has(key) ? memoryStore.get(key) : null),
    set: (key, value) => { memoryStore.set(key, value); },
    remove: (key) => { memoryStore.delete(key); }
  };
}

export function __setStorage(storage) {
  injectedStorage = storage;
}

async function readKey(key) {
  try {
    const raw = await getStorage().get(key);
    if (raw === undefined || raw === null || raw === '') return null;
    return String(raw);
  } catch (e) {
    return null;
  }
}

async function writeKey(key, value) {
  try {
    if (value === undefined || value === null || value === '') await getStorage().remove(key);
    else await getStorage().set(key, String(value));
  } catch (e) {}
}

/**
 * Load the persisted printer settings.
 * Returns { address, name, transport, lastConnectedAt, testTransmittedAt, testConfirmedAt, bannerDismissedAt }
 */
export async function loadSettings() {
  const [address, name, transport, lastConnectedAt, testTransmittedAt, testConfirmedAt, bannerDismissedAt] =
    await Promise.all([
      readKey(PRINTER_KEYS.address),
      readKey(PRINTER_KEYS.name),
      readKey(PRINTER_KEYS.transport),
      readKey(PRINTER_KEYS.lastConnectedAt),
      readKey(PRINTER_KEYS.testTransmittedAt),
      readKey(PRINTER_KEYS.testConfirmedAt),
      readKey(PRINTER_KEYS.bannerDismissedAt)
    ]);

  return { address, name, transport, lastConnectedAt, testTransmittedAt, testConfirmedAt, bannerDismissedAt };
}

export async function savePrinterSelection({ address, name, transport }) {
  await writeKey(PRINTER_KEYS.address, address);
  await writeKey(PRINTER_KEYS.name, name);
  await writeKey(PRINTER_KEYS.transport, transport);
  await writeKey(PRINTER_KEYS.lastConnectedAt, new Date().toISOString());
}

export async function markTestTransmitted() {
  await writeKey(PRINTER_KEYS.testTransmittedAt, new Date().toISOString());
}

export async function markTestConfirmed(confirmed) {
  if (confirmed) await writeKey(PRINTER_KEYS.testConfirmedAt, new Date().toISOString());
  else await writeKey(PRINTER_KEYS.testConfirmedAt, '');
}

export async function markBannerDismissed() {
  await writeKey(PRINTER_KEYS.bannerDismissedAt, new Date().toISOString());
}

/**
 * Forget the selected printer — clears every printer_* key.
 */
export async function forgetPrinter() {
  for (const key of ALL_KEYS) {
    await writeKey(key, '');
  }
}
