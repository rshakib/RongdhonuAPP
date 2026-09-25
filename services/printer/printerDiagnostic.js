/**
 * services/printer/printerDiagnostic.js
 *
 * In-memory rolling diagnostic log buffer for physical thermal printer
 * acceptance testing and in-store verification.
 *
 * Captures real-time discovery, connection, transmission, and teardown events
 * without logging secret keys or unmasked personal identifiers.
 */

const MAX_LOGS = 60;
let diagnosticLogs = [];
const listeners = new Set();

const INITIAL_CHECKPOINTS = [
  { id: 1, key: 'permission', label: '1. Bluetooth Permission', status: 'PENDING', detail: 'Not checked yet' },
  { id: 2, key: 'adapter', label: '2. Bluetooth Adapter State', status: 'PENDING', detail: 'Not checked yet' },
  { id: 3, key: 'discovery', label: '3. Device Discovery', status: 'PENDING', detail: 'Not run yet' },
  { id: 4, key: 'selectedPrinter', label: '4. Selected Printer ID', status: 'PENDING', detail: 'No printer selected' },
  { id: 5, key: 'transport', label: '5. Transport Selection', status: 'PENDING', detail: 'Awaiting device selection' },
  { id: 6, key: 'connectAttempt', label: '6. Native Connect Attempt', status: 'PENDING', detail: 'Idle' },
  { id: 7, key: 'connectResult', label: '7. Native Connect Result', status: 'PENDING', detail: 'Disconnected' },
  { id: 8, key: 'imageSubmission', label: '8. Test Image Submission', status: 'PENDING', detail: 'Awaiting print test' },
  { id: 9, key: 'printResult', label: '9. Native Print Result', status: 'PENDING', detail: 'Idle' },
  { id: 10, key: 'teardownReconnect', label: '10. Disconnect & Reconnect', status: 'PENDING', detail: 'Idle' }
];

let diagnosticCheckpoints = JSON.parse(JSON.stringify(INITIAL_CHECKPOINTS));

/**
 * Masks middle octets of a Bluetooth address for privacy (e.g. AA:BB:••:••:••:33)
 */
export function maskAddress(address) {
  if (!address) return '';
  const trimmed = String(address).trim();
  const schemeMatch = trimmed.match(/^(bt|ble|lan|tcp):/i);
  const scheme = schemeMatch ? schemeMatch[0] : '';
  const rawAddr = schemeMatch ? trimmed.slice(scheme.length) : trimmed;

  const parts = rawAddr.split(':');
  if (parts.length === 6) {
    return `${scheme}${parts[0]}:${parts[1]}:••:••:••:${parts[5]}`;
  }
  return `${scheme}${rawAddr.replace(/.(?=.{4})/g, '•')}`;
}

function notifyListeners() {
  const snapshotLogs = getDiagnosticLogs();
  const snapshotCheckpoints = getDiagnosticCheckpoints();
  listeners.forEach((fn) => {
    try { fn(snapshotLogs, snapshotCheckpoints); } catch (e) {}
  });
}

/**
 * Update a specific diagnostic checkpoint status and detail.
 */
export function updateDiagnosticCheckpoint(key, patch = {}) {
  const idx = diagnosticCheckpoints.findIndex((cp) => cp.key === key);
  if (idx !== -1) {
    diagnosticCheckpoints[idx] = {
      ...diagnosticCheckpoints[idx],
      ...patch
    };
    notifyListeners();
  }
}

/**
 * Returns a copy of the 10 diagnostic checkpoints.
 */
export function getDiagnosticCheckpoints() {
  return JSON.parse(JSON.stringify(diagnosticCheckpoints));
}

/**
 * Resets diagnostic checkpoints back to initial PENDING state.
 */
export function resetDiagnosticCheckpoints() {
  diagnosticCheckpoints = JSON.parse(JSON.stringify(INITIAL_CHECKPOINTS));
  notifyListeners();
}

/**
 * Automatically update relevant checkpoints when events occur.
 */
function syncCheckpointsFromEvent(type, payload) {
  switch (type) {
    case 'DISCOVERY_STARTED':
      updateDiagnosticCheckpoint('discovery', {
        status: 'RUNNING',
        detail: 'Scanning paired & nearby Bluetooth devices...'
      });
      break;

    case 'DISCOVERY_COMPLETED':
      updateDiagnosticCheckpoint('permission', {
        status: 'PASS',
        detail: 'Bluetooth runtime permissions granted'
      });
      updateDiagnosticCheckpoint('adapter', {
        status: 'PASS',
        detail: 'Bluetooth radio adapter is ON & responsive'
      });
      updateDiagnosticCheckpoint('discovery', {
        status: 'PASS',
        detail: `Completed: ${payload.pairedCount ?? 0} paired, ${payload.foundCount ?? 0} discovered (${payload.durationMs ?? 0}ms)`
      });
      break;

    case 'DISCOVERY_FAILED':
      if (payload.code === 'BLUETOOTH_PERMISSION_DENIED' || payload.code === 'PERMISSION_BLOCKED') {
        updateDiagnosticCheckpoint('permission', {
          status: 'FAIL',
          detail: `Permission denied (${payload.code})`
        });
      }
      if (payload.code === 'BLUETOOTH_DISABLED' || payload.code === 'BT_DISABLED') {
        updateDiagnosticCheckpoint('adapter', {
          status: 'FAIL',
          detail: 'Bluetooth radio is switched OFF'
        });
      }
      updateDiagnosticCheckpoint('discovery', {
        status: 'FAIL',
        detail: `${payload.code || 'FAILED'}: ${payload.error || 'Scan error'}`
      });
      break;

    case 'CONNECT_ATTEMPT':
      updateDiagnosticCheckpoint('selectedPrinter', {
        status: 'PASS',
        detail: `${payload.name || 'Printer'} [${payload.wireAddress || payload.address || ''}]`
      });
      updateDiagnosticCheckpoint('transport', {
        status: 'PASS',
        detail: `${String(payload.transport || 'SPP').toUpperCase()} scheme wired [${payload.wireAddress || ''}]`
      });
      updateDiagnosticCheckpoint('connectAttempt', {
        status: 'RUNNING',
        detail: `Connecting (12s timeout) to ${payload.wireAddress || ''}...`
      });
      break;

    case 'CONNECT_SUCCESS':
      updateDiagnosticCheckpoint('connectAttempt', {
        status: 'PASS',
        detail: `Socket connected in ${payload.durationMs ?? 0}ms`
      });
      updateDiagnosticCheckpoint('connectResult', {
        status: 'PASS',
        detail: `Active RFCOMM/GATT link verified (${payload.durationMs ?? 0}ms)`
      });
      updateDiagnosticCheckpoint('teardownReconnect', {
        status: 'READY',
        detail: 'Active link open. Ready for disconnect / reconnect testing.'
      });
      break;

    case 'CONNECT_FAILED':
      updateDiagnosticCheckpoint('connectAttempt', {
        status: 'FAIL',
        detail: `Timed out or failed after ${payload.durationMs ?? 0}ms`
      });
      updateDiagnosticCheckpoint('connectResult', {
        status: 'FAIL',
        detail: `${payload.code || 'CONNECT_FAILED'}: ${payload.error || 'Socket connection failed'}`
      });
      break;

    case 'PRINT_SUBMITTED':
      updateDiagnosticCheckpoint('imageSubmission', {
        status: 'PASS',
        detail: `Rasterized ${payload.width || 384} dots (58mm) • ~${Math.round((payload.payloadChars || 0) * 0.75 / 1024)} KB base64`
      });
      updateDiagnosticCheckpoint('printResult', {
        status: 'RUNNING',
        detail: 'Streaming 1-bit ESC/POS GS v 0 chunks to native transport...'
      });
      break;

    case 'PRINT_SUCCESS':
      updateDiagnosticCheckpoint('printResult', {
        status: 'PASS',
        detail: `Delivered all bytes to printer in ${payload.durationMs ?? 0}ms`
      });
      break;

    case 'PRINT_FAILED':
      updateDiagnosticCheckpoint('printResult', {
        status: 'FAIL',
        detail: `${payload.code || 'PRINT_FAILED'}: ${payload.error || 'Print failed'}`
      });
      break;

    case 'DISCONNECT':
      updateDiagnosticCheckpoint('connectResult', {
        status: 'CLOSED',
        detail: 'Socket closed cleanly'
      });
      updateDiagnosticCheckpoint('teardownReconnect', {
        status: 'PASS',
        detail: `Disconnected from ${payload.wireAddress || payload.address || 'printer'}. Ready for reconnection.`
      });
      break;

    default:
      break;
  }
}

/**
 * Log a diagnostic hardware event.
 *
 * @param {string} type - Event category (e.g. 'DISCOVERY', 'CONNECT', 'PRINT')
 * @param {object} payload - Key-value event details
 */
export function logDiagnosticEvent(type, payload = {}) {
  const timestamp = new Date().toISOString();
  const safePayload = { ...payload };

  if (safePayload.address) {
    safePayload.address = maskAddress(safePayload.address);
  }
  if (safePayload.wireAddress) {
    safePayload.wireAddress = maskAddress(safePayload.wireAddress);
  }

  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp,
    ...safePayload,
    type
  };

  diagnosticLogs.unshift(entry);
  if (diagnosticLogs.length > MAX_LOGS) {
    diagnosticLogs.length = MAX_LOGS;
  }

  syncCheckpointsFromEvent(type, safePayload);
  notifyListeners();
  return entry;
}

/**
 * Returns a copy of the current diagnostic events (newest first).
 */
export function getDiagnosticLogs() {
  return [...diagnosticLogs];
}

/**
 * Clears all diagnostic events.
 */
export function clearDiagnosticLogs() {
  diagnosticLogs = [];
  resetDiagnosticCheckpoints();
}

/**
 * Subscribe to real-time diagnostic log updates.
 */
export function subscribeDiagnostics(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

