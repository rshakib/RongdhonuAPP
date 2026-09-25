/**
 * services/printer/receiptData.js
 *
 * Pure receipt helpers, re-exported from the original printer service so the
 * receipt maths/layout stay byte-identical to what already shipped.
 *
 * Nothing here touches Bluetooth, the DOM, or a canvas — safe to use anywhere.
 */

export {
  parseOrderItems,
  normalizeOrderForReceipt,
  formatReceiptText,
  toBengaliNumber,
  translatePaymentMethod
} from '../printerService.js';
