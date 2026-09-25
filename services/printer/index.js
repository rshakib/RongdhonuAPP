/**
 * services/printer/index.js
 *
 * Public printer API for the app. Screens import from here — never from the
 * transport adapter or the native library directly.
 */

export {
  STATUS,
  MESSAGES,
  RECEIPT_RASTER_WIDTH,
  getStatus,
  getErrorMessage,
  resolveError,
  computeStatus,
  subscribe,
  refresh,
  scanForDevices,
  connectDevice,
  autoConnectSavedPrinter,
  scanAndConnect,
  connectKnown,
  disconnect,
  forget,
  dismissBanner,
  watchConnection,
  printReceipt,
  printTestReceipt,
  confirmPhysicalTest,
  getBluetoothDetectionReport
} from './printerManager.js';

export {
  computeButtonStates,
  getDisabledReason
} from './printerButtonStates.js';

export { loadSettings } from './printerSettings.js';

export {
  parseOrderItems,
  normalizeOrderForReceipt,
  formatReceiptText,
  toBengaliNumber,
  translatePaymentMethod
} from './receiptData.js';

export {
  isAvailable as isPrinterPlatformAvailable,
  requestPermissions as requestPrinterPermissions,
  openAppSettings,
  isAudioDevice
} from './printerTransport.js';

export {
  getDiagnosticLogs,
  clearDiagnosticLogs,
  subscribeDiagnostics,
  maskAddress,
  getDiagnosticCheckpoints,
  updateDiagnosticCheckpoint,
  resetDiagnosticCheckpoints
} from './printerDiagnostic.js';

