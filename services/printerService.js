/**
 * services/printerService.js
 * 
 * Direct Web Bluetooth API for 58mm ESC/POS Thermal Receipt Printing
 * 
 * Rules:
 *  - 100% Web Bluetooth API (ESC/POS 58mm)
 *  - Direct connection to paired/selected Bluetooth thermal printer
 *  - No browser print dialogs or PDF save options
 *  - If printer not connected -> show toast: "প্রিন্টার কানেক্ট করুন"
 *  - Works anytime, any date — zero time restrictions.
 */

// Safe loading for React Native runtime
let Platform = { OS: 'web' };
let ToastAndroid = null;
let Alert = { alert: (t, m) => console.log(`[Alert] ${t}: ${m}`) };

try {
  const RN = require('react-native');
  if (RN.Platform) Platform = RN.Platform;
  if (RN.ToastAndroid) ToastAndroid = RN.ToastAndroid;
  if (RN.Alert) Alert = RN.Alert;
} catch (e) {}

// Module-level connection state for Web Bluetooth
let connectedDevice = null;
let writeCharacteristic = null;
let isConnecting = false;

// Standard and vendor thermal printer Bluetooth GATT Services
export const PRINTER_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb', // Standard Thermal Printer Service
  '0000ffe0-0000-1000-8000-00805f9b34fb', // Common Serial / UART (HM-10 / MPT-II)
  '0000fff0-0000-1000-8000-00805f9b34fb', // Common Chinese POS BLE Service
  '0000ff00-0000-1000-8000-00805f9b34fb', // General POS Vendor Service
  '0000ff12-0000-1000-8000-00805f9b34fb', // Netum / POS-58
  '0000ae00-0000-1000-8000-00805f9b34fb', // Common Vendor POS Service
  '0000af30-0000-1000-8000-00805f9b34fb', // Common Chinese Printer Service
  '0000fee7-0000-1000-8000-00805f9b34fb', // Standard BLE Service
  '0000ffff-0000-1000-8000-00805f9b34fb', // Custom POS Service
  'e7810a71-73ae-499d-8c15-4409ed9435df', // Xprinter / Milestone POS
  '49535343-fe7d-4ae5-8fa9-9fafd205e455'  // ISSC Transparent UART
];

/**
 * Display a user toast message across Web and Android
 */
export function showPrinterToast(msg = 'প্রিন্টার কানেক্ট করুন') {
  if (Platform.OS === 'android' && ToastAndroid && ToastAndroid.show) {
    try {
      ToastAndroid.show(msg, ToastAndroid.SHORT);
      return;
    } catch (e) {}
  }
  
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    try {
      let toastEl = document.getElementById('pos-printer-toast');
      if (!toastEl) {
        toastEl = document.createElement('div');
        toastEl.id = 'pos-printer-toast';
        toastEl.style.position = 'fixed';
        toastEl.style.bottom = '40px';
        toastEl.style.left = '50%';
        toastEl.style.transform = 'translateX(-50%)';
        toastEl.style.backgroundColor = '#181e25';
        toastEl.style.color = '#ffb703';
        toastEl.style.padding = '12px 24px';
        toastEl.style.borderRadius = '12px';
        toastEl.style.border = '1.5px solid #ffb703';
        toastEl.style.boxShadow = '0 10px 25px -5px rgba(0,0,0,0.5)';
        toastEl.style.zIndex = '9999999';
        toastEl.style.fontSize = '14px';
        toastEl.style.fontWeight = 'bold';
        toastEl.style.fontFamily = 'sans-serif';
        toastEl.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
        toastEl.style.pointerEvents = 'none';
        document.body.appendChild(toastEl);
      }
      toastEl.textContent = msg;
      toastEl.style.opacity = '1';
      toastEl.style.transform = 'translateX(-50%) translateY(0)';
      setTimeout(() => {
        if (toastEl) {
          toastEl.style.opacity = '0';
          toastEl.style.transform = 'translateX(-50%) translateY(10px)';
        }
      }, 3000);
      return;
    } catch (e) {}
  }

  // Native fallback
  Alert.alert('প্রিন্টার', msg);
}

/**
 * Check if a Web Bluetooth printer is currently connected
 */
export function isPrinterConnected() {
  return Boolean(
    connectedDevice &&
    connectedDevice.gatt &&
    connectedDevice.gatt.connected &&
    writeCharacteristic
  );
}

// ---- Printer status (connection state + device name) with change notifications ----
/**
 * Raster ink threshold (0-255). Pixels darker than this become black dots on
 * paper. A higher value keeps more of each glyph's anti-aliased edge, which is
 * what makes the printed text look solid and bold instead of thin and grey.
 */
const INK_THRESHOLD = 200;

const printerStatusListeners = new Set();

function emitPrinterStatusChange() {
  const status = getPrinterStatus();
  printerStatusListeners.forEach(fn => {
    try { fn(status); } catch (e) {}
  });
}

/**
 * Current printer status. `name` is only set while a printer is connected.
 * Returns { connected: boolean, name: string|null }
 */
export function getPrinterStatus() {
  const connected = isPrinterConnected();
  let name = null;

  if (connected) {
    name = (connectedDevice && connectedDevice.name) || null;
    if (!name) {
      try { name = localStorage.getItem('paired_printer_name'); } catch (e) {}
    }
    if (!name) name = 'Bluetooth Printer';
  }

  return { connected, name };
}

/**
 * Subscribe to printer connection changes. Returns an unsubscribe function.
 */
export function onPrinterStatusChange(listener) {
  if (typeof listener !== 'function') return () => {};
  printerStatusListeners.add(listener);
  return () => printerStatusListeners.delete(listener);
}

/**
 * Attempt a silent reconnect to a previously paired printer (no picker dialog)
 * and report the resulting status.
 */
export async function syncPrinterStatus() {
  if (typeof navigator === 'undefined' || !navigator.bluetooth) {
    return getPrinterStatus();
  }
  try {
    await connectWebBluetooth(true);
  } catch (e) {}
  const status = getPrinterStatus();
  emitPrinterStatusChange();
  return status;
}

/**
 * Explicitly connect a printer (may open the device picker). Used by the
 * "প্রিন্টার কানেক্ট করুন" action.
 */
export async function connectPrinter() {
  if (typeof navigator === 'undefined' || !navigator.bluetooth) {
    showPrinterToast('প্রিন্টার কানেক্ট করুন');
    return getPrinterStatus();
  }
  await connectWebBluetooth(false);
  const status = getPrinterStatus();
  emitPrinterStatusChange();
  return status;
}

/**
 * Normalize and parse order item data into an array of { name, qty, price, total }
 */
export function parseOrderItems(order) {
  if (!order) return [];

  let items = [];

  if (Array.isArray(order.items)) {
    items = order.items.map(item => {
      const qty = parseInt(item.qty || item.quantity || 1, 10) || 1;
      const price = parseFloat(item.price || 0) || 0;
      const total = parseFloat(item.total || (qty * price)) || 0;
      const base = {
        name: String(item.name || 'আইটেম').trim(),
        qty,
        price,
        total
      };
      // Additive: pass add-on/extra info through so the receipt can render it
      // as a small nested line under its parent.
      if (item.isExtra) {
        base.isExtra = true;
        base.parentName = item.parentName || null;
      }
      // Additive: a service-charge line is a CHARGE, not an item.
      if (item.isCharge) {
        base.isCharge = true;
      }
      return base;
    });
  } else if (typeof order.items === 'string' && order.items.trim()) {
    const rawParts = order.items.split(',').map(s => s.trim()).filter(Boolean);

    for (const part of rawParts) {
      const match = part.match(/^(.*?)(?:\s+x|\s*x)(\d+)(?:\s*@|\s*@\s*)(\d+(?:\.\d+)?)/i);
      if (match) {
        const name = match[1].trim();
        const qty = parseInt(match[2], 10) || 1;
        const price = parseFloat(match[3]) || 0;
        items.push({
          name: name || part,
          qty,
          price,
          total: qty * price
        });
      } else {
        items.push({
          name: part,
          qty: 1,
          price: 0,
          total: 0
        });
      }
    }

    // Additive: string orders encode extras as "Name (Parent)" and the service
    // charge by its own name -> mark them so the receipt renders correctly.
    items = items.map(it => {
      if (String(it.name || '').trim() === 'সার্ভিস চার্জ') {
        return { ...it, isCharge: true };
      }
      const m = String(it.name || '').match(/^(.*\S)\s\((.+)\)$/);
      if (m && m[1] && m[2]) {
        return { ...it, name: m[1].trim(), isExtra: true, parentName: m[2].trim() };
      }
      return it;
    });
  }

  if (items.length <= 1) return items;

  // Ordering rules:
  // 1. Regular items first
  // 2. "পানি" (Water) comes after regular items
  // 3. "ডেলিভারি চার্জ" (Delivery Charge) must always come at the very end (below water and all items)
  const regularItems = [];
  const waterItems = [];
  const deliveryChargeItems = [];
  const extraItems = [];

  for (const item of items) {
    // Additive: extras are held aside and re-inserted right after their parent.
    if (item.isExtra) {
      extraItems.push(item);
      continue;
    }

    const rawName = String(item.name || '').trim();
    const lowerName = rawName.toLowerCase();

    const isDeliveryCharge =
      rawName === 'ডেলিভারি চার্জ' ||
      rawName.includes('ডেলিভারি চার্জ') ||
      rawName === 'ডেলিভারি' ||
      lowerName.includes('delivery charge') ||
      lowerName === 'delivery';

    const isWater =
      !isDeliveryCharge &&
      (rawName === 'পানি' || rawName.includes('পানি') || lowerName.includes('water'));

    if (isDeliveryCharge) {
      deliveryChargeItems.push(item);
    } else if (isWater) {
      waterItems.push(item);
    } else {
      regularItems.push(item);
    }
  }

  const ordered = [...regularItems, ...waterItems, ...deliveryChargeItems];

  // Insert each extra directly after its parent item (mirrors the order list).
  for (const ex of extraItems) {
    const at = ordered.findIndex(o => !o.isExtra && o.name === ex.parentName);
    if (at > -1) {
      ordered.splice(at + 1, 0, ex);
    } else {
      ordered.push(ex);
    }
  }

  return ordered;
}

/**
 * Format order values for receipt display
 */
export function normalizeOrderForReceipt(order) {
  if (!order) return null;

  const allParsed = parseOrderItems(order);
  const chargeItems = allParsed.filter(i => i.isCharge);
  const items = allParsed.filter(i => !i.isCharge);
  const rawSubtotal = parseFloat(order.totalAmount ?? order.subtotal ?? order.amount ?? 0) || 0;
  const deliveryCharge = parseFloat(order.deliveryCharge ?? 0) || 0;
  const changeMoney = parseFloat(order.changeMoneyGiven ?? 0) || 0;
  // Service charge is a CHARGE, not an item. rawSubtotal already includes it, so
  // the shown subtotal excludes it while the overall (finalAmount) keeps it.
  const serviceCharge = parseFloat(order.serviceCharge ?? 0) || chargeItems.reduce((s, i) => s + (i.total || 0), 0);
  const paid = parseFloat(order.paidAmount ?? order.grandTotal ?? order.finalAmount ?? rawSubtotal) || rawSubtotal;

  const expectedTotal = rawSubtotal + deliveryCharge + changeMoney;
  const discount = parseFloat(order.discount ?? Math.max(0, expectedTotal - paid)) || 0;
  const finalAmount = paid > 0 ? paid : expectedTotal;

  // Formatting date and time
  let dateStr = order.fullDate || order.date || '';
  if (!dateStr || dateStr === 'আজ') {
    dateStr = new Date().toISOString().substring(0, 10);
  }
  let timeStr = order.time || '';
  if (!timeStr) {
    timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  const tableName = String(order.tableId || order.table || 'টেবিল').trim();
  const rawMethod = String(order.paymentMethod || order.method || 'Cash').trim();

  // Split payment breakdown extraction
  const breakdownSource = (order.breakdown && typeof order.breakdown === 'object') ? order.breakdown : {};
  const cash = parseFloat(order.cashAmount ?? order.cash_amount ?? breakdownSource.cash ?? breakdownSource['ক্যাশ'] ?? 0) || 0;
  const bkash = parseFloat(order.bkashAmount ?? order.bkash_amount ?? breakdownSource.bkash ?? breakdownSource['বিকাশ'] ?? 0) || 0;
  const nagad = parseFloat(order.nagadAmount ?? order.nagad_amount ?? breakdownSource.nagad ?? breakdownSource['নগদ'] ?? 0) || 0;
  const rocket = parseFloat(order.rocketAmount ?? order.rocket_amount ?? breakdownSource.rocket ?? breakdownSource['রকেট'] ?? 0) || 0;

  const splitBreakdown = [];
  if (cash > 0) splitBreakdown.push({ label: 'ক্যাশ:', amount: cash });
  if (bkash > 0) splitBreakdown.push({ label: 'বিকাশ:', amount: bkash });
  if (nagad > 0) splitBreakdown.push({ label: 'নগদ:', amount: nagad });
  if (rocket > 0) splitBreakdown.push({ label: 'রকেট:', amount: rocket });

  // Any custom keys in breakdownSource
  Object.keys(breakdownSource).forEach(key => {
    const k = key.toLowerCase();
    if (!['cash', 'bkash', 'nagad', 'rocket', 'ক্যাশ', 'বিকাশ', 'নগদ', 'রকেট'].includes(k)) {
      const amt = parseFloat(breakdownSource[key]) || 0;
      if (amt > 0) {
        splitBreakdown.push({ label: `${key}:`, amount: amt });
      }
    }
  });

  const isSplit = rawMethod.toLowerCase() === 'split' || rawMethod === 'স্প্লিট' || splitBreakdown.length > 1;
  const paymentMethod = isSplit ? 'স্প্লিট' : rawMethod;

  return {
    tableName,
    date: dateStr,
    time: timeStr,
    items,
    subtotal: rawSubtotal,
    serviceCharge,
    deliveryCharge,
    changeMoney,
    discount,
    finalAmount,
    paymentMethod,
    isSplit,
    splitBreakdown
  };
}

/**
 * Convert English numbers/digits to Bengali digits (e.g. 120 -> ১২০)
 */
export function toBengaliNumber(num) {
  if (num === null || num === undefined) return '';
  const bengaliDigits = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
  return String(num).replace(/\d/g, d => bengaliDigits[parseInt(d, 10)]);
}

/**
 * Translate payment method name to Bengali
 */
export function translatePaymentMethod(method) {
  if (!method) return 'ক্যাশ';
  const m = String(method).trim().toLowerCase();
  if (m === 'cash' || m === 'ক্যাশ') return 'ক্যাশ';
  if (m === 'bkash' || m === 'বিকাশ') return 'বিকাশ';
  if (m === 'nagad' || m === 'নগদ') return 'নগদ';
  if (m === 'rocket' || m === 'রকেট') return 'রকেট';
  if (m === 'split' || m === 'স্প্লিট') return 'স্প্লিট';
  if (m === 'due' || m === 'বাকি') return 'বাকি';
  if (m === 'bill' || m === 'বিল') return 'বিল';
  return method;
}

/**
 * Generate 58mm ESC/POS formatted receipt text
 */
export function formatReceiptText(order) {
  const norm = normalizeOrderForReceipt(order);
  if (!norm) return '';

  const border = '--------------------------------';
  const padRow = (label, val) => {
    const spaces = Math.max(1, 32 - label.length - val.length);
    return label + ' '.repeat(spaces) + val;
  };

  const lines = [
    border,
    '  রংধনু ক্যাফে এন্ড রেস্টুরেন্ট',
    'পুলিশ মোড়, দুর্গাপুর, নেত্রকোনা',
    'মোবাইল: 01953838244',
    border,
    `টেবিল: ${toBengaliNumber(norm.tableName)}`,
    `তারিখ: ${toBengaliNumber(norm.date)}  সময়: ${toBengaliNumber(norm.time)}`,
    border
  ];

  norm.items.forEach(item => {
    // Extras render as a small nested line with a ↳ arrow, like the app order list.
    lines.push(item.isExtra ? ` ↳ ${item.name}` : item.name);
    const qtyPrice = `  ${toBengaliNumber(item.qty)} × ${toBengaliNumber(item.price)}`;
    const itemTotal = `৳${toBengaliNumber(item.total)}`;
    const spaces = Math.max(1, 32 - qtyPrice.length - itemTotal.length);
    lines.push(qtyPrice + ' '.repeat(spaces) + itemTotal);
  });

  lines.push(border);
  // Service charge is added INSIDE the totals section, BEFORE the overall total,
  // so "সর্বমোট" already includes it.
  if (norm.serviceCharge > 0) {
    lines.push(padRow('সার্ভিস চার্জ:', `৳${toBengaliNumber(norm.serviceCharge)}`));
  }
  lines.push(padRow('সর্বমোট:', `৳${toBengaliNumber(norm.subtotal)}`));
  if (norm.discount > 0) {
    lines.push(padRow('ডিসকাউন্ট:', `৳${toBengaliNumber(norm.discount)}`));
  }
  if (norm.deliveryCharge > 0) {
    lines.push(padRow('ডেলিভারি চার্জ:', `৳${toBengaliNumber(norm.deliveryCharge)}`));
  }
  lines.push(padRow('পরিশোধ:', `৳${toBengaliNumber(norm.finalAmount)}`));
  lines.push(border);
  lines.push(padRow('পেমেন্ট:', translatePaymentMethod(norm.paymentMethod)));
  if (norm.isSplit && norm.splitBreakdown && norm.splitBreakdown.length > 0) {
    norm.splitBreakdown.forEach(split => {
      lines.push(padRow(`  ${split.label}`, `৳${toBengaliNumber(split.amount)}`));
    });
  }
  lines.push(border);
  lines.push('     ধন্যবাদ, আবার আসবেন!');
  lines.push(border);

  return lines.join('\n');
}

/**
 * Render receipt to 1-bit monochrome ESC/POS raster image bytes via HTML5 Canvas (384 dots width)
 * Prints directly to 58mm thermal printers without requiring Bengali fonts on the printer hardware
 */
export async function renderReceiptToEscPosBytes(order) {
  if (typeof document === 'undefined') return null;

  const norm = normalizeOrderForReceipt(order);
  if (!norm) return null;

  const canvasWidth = 384; // 58mm = 384 dots (48 bytes per line)
  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;

  // Calculate dynamic height based on item count and split breakdown
  const splitRowsCount = (norm.isSplit && norm.splitBreakdown) ? norm.splitBreakdown.length : 0;
  const baseHeight = 350 + (splitRowsCount * 22) + ((norm.serviceCharge > 0 ? 1 : 0) * 22);
  const itemHeight = norm.items.length * 44;
  const canvasHeight = baseHeight + itemHeight;
  canvas.height = canvasHeight;

  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  ctx.fillStyle = '#000000';

  let y = 20;

  // Thermal clarity: a 1-bit raster drops anti-aliased glyph edges, so the
  // printed text comes out thinner than on screen. Drawing a hairline outline
  // (fill + stroke) thickens every glyph and keeps it solid after thresholding.
  const drawText = (text, x, posY) => {
    ctx.fillText(text, x, posY);
    const size = Number(String(ctx.font).match(/(\d+(?:\.\d+)?)px/)?.[1]) || 16;
    // Tuned to a true hairline (0.09 → 0.072 → 0.03) to match ReceiptPaper:
    // a thicker outline blurs into the 1-bit threshold and clogs small glyphs.
    ctx.lineWidth = Math.max(0.27, size * 0.03);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#000000';
    ctx.strokeText(text, x, posY);
  };

  const drawDashedLine = (currentY) => {
    ctx.beginPath();
    ctx.setLineDash([4, 4]);
    ctx.moveTo(8, currentY);
    ctx.lineTo(canvasWidth - 8, currentY);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);
  };

  // Header Divider
  drawDashedLine(y);
  y += 24;

  const BENGALI_FONT = '"Noto Sans Bengali", "SolaimanLipi", "Kalpurush", sans-serif';

  // Restaurant Title
  ctx.font = `900 24px ${BENGALI_FONT}`;
  ctx.textAlign = 'center';
  drawText('রংধনু ক্যাফে এন্ড রেস্টুরেন্ট', canvasWidth / 2, y);
  y += 20;

  // Restaurant Address
  ctx.font = `14px ${BENGALI_FONT}`;
  drawText('পুলিশ মোড়, দুর্গাপুর, নেত্রকোনা', canvasWidth / 2, y);
  y += 18;

  // Restaurant Mobile
  ctx.font = `bold 15px ${BENGALI_FONT}`;
  drawText('মোবাইল: 01953838244', canvasWidth / 2, y);
  y += 16;

  // Divider
  drawDashedLine(y);
  y += 24;

  // Table
  ctx.textAlign = 'left';
  ctx.font = `bold 18px ${BENGALI_FONT}`;
  drawText(`টেবিল: ${toBengaliNumber(norm.tableName)}`, 12, y);
  y += 22;

  // Date and Time
  ctx.font = `bold 15px ${BENGALI_FONT}`;
  drawText(`তারিখ: ${toBengaliNumber(norm.date)}`, 12, y);
  ctx.textAlign = 'right';
  drawText(`সময়: ${toBengaliNumber(norm.time)}`, canvasWidth - 12, y);
  y += 16;

  // Divider
  drawDashedLine(y);
  y += 24;

  // Items
  norm.items.forEach(item => {
    ctx.textAlign = 'left';
    ctx.font = `900 18px ${BENGALI_FONT}`;
    drawText(item.name, 12, y);
    y += 20;

    ctx.font = `bold 16px ${BENGALI_FONT}`;
    drawText(`  ${toBengaliNumber(item.qty)} × ${toBengaliNumber(item.price)}`, 12, y);
    ctx.textAlign = 'right';
    ctx.font = `900 18px ${BENGALI_FONT}`;
    drawText(`৳${toBengaliNumber(item.total)}`, canvasWidth - 12, y);
    y += 22;
  });

  // Divider
  drawDashedLine(y);
  y += 24;

  // Service Charge (a charge, not an item) — added before the overall total
  if (norm.serviceCharge > 0) {
    ctx.textAlign = 'left';
    ctx.font = `bold 17px ${BENGALI_FONT}`;
    drawText('সার্ভিস চার্জ:', 12, y);
    ctx.textAlign = 'right';
    drawText(`৳${toBengaliNumber(norm.serviceCharge)}`, canvasWidth - 12, y);
    y += 22;
  }

  // Subtotal (already includes the service charge)
  ctx.textAlign = 'left';
  ctx.font = `bold 18px ${BENGALI_FONT}`;
  drawText('সর্বমোট:', 12, y);
  ctx.textAlign = 'right';
  drawText(`৳${toBengaliNumber(norm.subtotal)}`, canvasWidth - 12, y);
  y += 22;

  // Discount
  if (norm.discount > 0) {
    ctx.textAlign = 'left';
    ctx.font = `bold 17px ${BENGALI_FONT}`;
    drawText('ডিসকাউন্ট:', 12, y);
    ctx.textAlign = 'right';
    drawText(`৳${toBengaliNumber(norm.discount)}`, canvasWidth - 12, y);
    y += 22;
  }

  // Delivery Charge
  if (norm.deliveryCharge > 0) {
    ctx.textAlign = 'left';
    ctx.font = `bold 17px ${BENGALI_FONT}`;
    drawText('ডেলিভারি চার্জ:', 12, y);
    ctx.textAlign = 'right';
    drawText(`৳${toBengaliNumber(norm.deliveryCharge)}`, canvasWidth - 12, y);
    y += 22;
  }

  // Service Charge (a charge, not an item)
  // (drawn earlier, before the overall total)

  // Final Amount
  ctx.textAlign = 'left';
  ctx.font = `900 22px ${BENGALI_FONT}`;
  drawText('পরিশোধ:', 12, y);
  ctx.textAlign = 'right';
  drawText(`৳${toBengaliNumber(norm.finalAmount)}`, canvasWidth - 12, y);
  y += 20;

  // Divider
  drawDashedLine(y);
  y += 24;

  // Payment Method: label on left, value on right
  ctx.textAlign = 'left';
  ctx.font = `bold 18px ${BENGALI_FONT}`;
  drawText('পেমেন্ট:', 12, y);
  ctx.textAlign = 'right';
  drawText(translatePaymentMethod(norm.paymentMethod), canvasWidth - 12, y);
  y += 20;

  // Split Breakdown if applicable
  if (norm.isSplit && norm.splitBreakdown && norm.splitBreakdown.length > 0) {
    ctx.font = `bold 16px ${BENGALI_FONT}`;
    norm.splitBreakdown.forEach(split => {
      ctx.textAlign = 'left';
      drawText(`  ${split.label}`, 12, y);
      ctx.textAlign = 'right';
      drawText(`৳${toBengaliNumber(split.amount)}`, canvasWidth - 12, y);
      y += 20;
    });
  }

  // Divider
  drawDashedLine(y);
  y += 26;

  // Footer Greeting
  ctx.textAlign = 'center';
  ctx.font = `bold 18px ${BENGALI_FONT}`;
  drawText('ধন্যবাদ, আবার আসবেন!', canvasWidth / 2, y);
  y += 18;

  // Final Divider
  drawDashedLine(y);
  y += 16;

  // Convert canvas pixel data to ESC/POS Raster Bit Image (GS v 0)
  const actualHeight = Math.min(y, canvasHeight);
  const imgData = ctx.getImageData(0, 0, canvasWidth, actualHeight);
  const widthBytes = Math.floor(canvasWidth / 8); // 48 bytes per line
  const heightPixels = actualHeight;

  // ESC/POS header: ESC @ (Init) + GS v 0 0 xL xH yL yH (Raster image)
  const escPosHeader = [
    0x1B, 0x40, // ESC @ (Initialize printer)
    0x1D, 0x76, 0x30, 0x00, // GS v 0 0
    widthBytes & 0xFF,
    (widthBytes >> 8) & 0xFF,
    heightPixels & 0xFF,
    (heightPixels >> 8) & 0xFF
  ];

  const rasterBytes = new Uint8Array(escPosHeader.length + (widthBytes * heightPixels) + 6);
  rasterBytes.set(escPosHeader, 0);

  let byteIdx = escPosHeader.length;
  const pixels = imgData.data;

  for (let r = 0; r < heightPixels; r++) {
    for (let c = 0; c < widthBytes; c++) {
      let b = 0;
      for (let bit = 0; bit < 8; bit++) {
        const x = (c * 8) + bit;
        const pIdx = ((r * canvasWidth) + x) * 4;
        const red = pixels[pIdx];
        const green = pixels[pIdx + 1];
        const blue = pixels[pIdx + 2];
        const luminance = (red * 0.299) + (green * 0.587) + (blue * 0.114);
        // If dark pixel -> set bit to 1 (print black dot). The threshold is
        // deliberately permissive so anti-aliased glyph edges are PRESERVED
        // (ink) instead of being dropped, which would print thin grey text.
        if (luminance < INK_THRESHOLD) {
          b |= (1 << (7 - bit));
        }
      }
      rasterBytes[byteIdx++] = b;
    }
  }

  // Paper feed 4 lines + partial cut
  rasterBytes[byteIdx++] = 0x1B;
  rasterBytes[byteIdx++] = 0x64;
  rasterBytes[byteIdx++] = 0x04; // Feed 4 lines
  rasterBytes[byteIdx++] = 0x1D;
  rasterBytes[byteIdx++] = 0x56;
  rasterBytes[byteIdx++] = 0x01; // Partial cut

  return rasterBytes.subarray(0, byteIdx);
}

/**
 * Traverse GATT server services and find writable characteristic
 */
async function findWriteCharacteristic(server) {
  try {
    // 1. Try known primary services first
    for (const serviceUuid of PRINTER_SERVICES) {
      try {
        const service = await server.getPrimaryService(serviceUuid);
        const characteristics = await service.getCharacteristics();
        for (const char of characteristics) {
          if (char.properties.write || char.properties.writeWithoutResponse) {
            return char;
          }
        }
      } catch (e) {
        // service not on this device, check next
      }
    }

    // 2. Generic fallback across all primary services
    const services = await server.getPrimaryServices();
    for (const service of services) {
      try {
        const characteristics = await service.getCharacteristics();
        for (const char of characteristics) {
          if (char.properties.write || char.properties.writeWithoutResponse) {
            return char;
          }
        }
      } catch (e) {}
    }
  } catch (e) {}
  return null;
}

/**
 * Connect to Web Bluetooth thermal printer
 */
async function connectWebBluetooth(silent = false) {
  if (typeof navigator === 'undefined' || !navigator.bluetooth) {
    if (!silent) {
      showPrinterToast('প্রিন্টার কানেক্ট করুন');
    }
    return null;
  }

  // 1. If currently connected, return active characteristic
  if (connectedDevice && connectedDevice.gatt && connectedDevice.gatt.connected && writeCharacteristic) {
    return writeCharacteristic;
  }

  // 2. Try reconnecting to cached device in memory
  if (connectedDevice && connectedDevice.gatt && !connectedDevice.gatt.connected) {
    try {
      const server = await connectedDevice.gatt.connect();
      const char = await findWriteCharacteristic(server);
      if (char) {
        writeCharacteristic = char;
        return char;
      }
    } catch (e) {
      console.log('[WebBluetooth] Reconnect cached device failed:', e?.message);
    }
  }

  // 3. Try previously paired devices using navigator.bluetooth.getDevices() (Chrome 85+, no picker dialog)
  if (navigator.bluetooth.getDevices) {
    try {
      const devices = await navigator.bluetooth.getDevices();
      if (devices && devices.length > 0) {
        const savedId = typeof localStorage !== 'undefined' ? localStorage.getItem('paired_printer_id') : null;
        const targetDevice = devices.find(d => d.id === savedId) || devices[0];
        
        if (targetDevice && targetDevice.gatt) {
          targetDevice.addEventListener('gattserverdisconnected', () => {
            console.log('[WebBluetooth] Printer disconnected');
            writeCharacteristic = null;
            emitPrinterStatusChange();
          });
          const server = await targetDevice.gatt.connect();
          const char = await findWriteCharacteristic(server);
          if (char) {
            connectedDevice = targetDevice;
            writeCharacteristic = char;
            emitPrinterStatusChange();
            return char;
          }
        }
      }
    } catch (e) {
      console.log('[WebBluetooth] getDevices auto-connect skipped/failed:', e?.message);
    }
  }

  // 4. If silent (autoPrint when order placed), do not prompt user picker
  if (silent) {
    return null;
  }

  if (isConnecting) return null;
  isConnecting = true;

  try {
    // 5. Connect to Bluetooth printer via browser device selector
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: PRINTER_SERVICES
    });

    if (!device) {
      showPrinterToast('প্রিন্টার কানেক্ট করুন');
      return null;
    }

    device.addEventListener('gattserverdisconnected', () => {
      console.log('[WebBluetooth] Printer disconnected');
      writeCharacteristic = null;
      emitPrinterStatusChange();
    });

    const server = await device.gatt.connect();
    const char = await findWriteCharacteristic(server);

    if (!char) {
      showPrinterToast('প্রিন্টার কানেক্ট করুন');
      return null;
    }

    connectedDevice = device;
    writeCharacteristic = char;

    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('paired_printer_id', device.id || '');
        localStorage.setItem('paired_printer_name', device.name || 'Bluetooth Printer');
      }
    } catch (e) {}

    emitPrinterStatusChange();
    return char;
  } catch (err) {
    console.warn('[WebBluetooth] Connection failed or cancelled:', err?.message);
    showPrinterToast('প্রিন্টার কানেক্ট করুন');
    return null;
  } finally {
    isConnecting = false;
  }
}

/**
 * Send raw byte chunks over BLE characteristic.
 * Starts at 100-byte chunks (fits the usual negotiated ATT MTU) and automatically
 * falls back to smaller packets if the stack negotiated a small MTU (e.g. 23 -> 20 B),
 * so printers with conservative stacks still receive the full receipt.
 */
async function sendBytesToCharacteristic(characteristic, bytes) {
  const write = (chunk) =>
    characteristic.writeValueWithoutResponse
      ? characteristic.writeValueWithoutResponse(chunk)
      : characteristic.writeValue(chunk);

  let chunkSize = 100;
  let offset = 0;

  while (offset < bytes.length) {
    const chunk = bytes.slice(offset, offset + chunkSize);
    try {
      await write(chunk);
      offset += chunk.length;
    } catch (err) {
      if (chunkSize > 20) {
        chunkSize = Math.max(20, Math.floor(chunkSize / 2));
        continue;
      }
      throw err;
    }
    // Delay between Bluetooth packets to prevent buffer overrun
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

/**
 * PRIMARY EXPORT: One reusable print function used everywhere
 * 
 * Works anytime, any date — NO time restriction on printing.
 * Always prints via Web Bluetooth ESC/POS directly to the 58mm thermal printer.
 * Never opens a browser print dialog or PDF save option.
 */
export async function printReceipt(order, options = {}) {
  const { autoPrintOnlyIfConnected = false, onSuccess, onError } = options;

  if (!order) {
    console.warn('[Printer] Cannot print: invalid order data');
    return { success: false, error: 'অর্ডার ডাটা পাওয়া যায়নি' };
  }

  const isWeb = typeof window !== 'undefined' && typeof navigator !== 'undefined';
  const hasWebBluetooth = isWeb && Boolean(navigator.bluetooth);

  if (!hasWebBluetooth) {
    if (!autoPrintOnlyIfConnected) {
      showPrinterToast('প্রিন্টার কানেক্ট করুন');
    }
    return { success: false, reason: 'web_bluetooth_not_supported' };
  }

  try {
    const char = await connectWebBluetooth(autoPrintOnlyIfConnected);

    if (char) {
      // Render 58mm ESC/POS 1-bit raster image
      const rasterBytes = await renderReceiptToEscPosBytes(order);
      if (rasterBytes && rasterBytes.length > 0) {
        await sendBytesToCharacteristic(char, rasterBytes);
        if (onSuccess) onSuccess();
        return { success: true, method: 'web_bluetooth_escpos' };
      }
    } else {
      if (!autoPrintOnlyIfConnected) {
        showPrinterToast('প্রিন্টার কানেক্ট করুন');
      }
      return { success: false, reason: 'printer_not_connected' };
    }
  } catch (err) {
    console.warn('[Printer] Web Bluetooth printing failed:', err?.message);
    if (!autoPrintOnlyIfConnected) {
      showPrinterToast('প্রিন্টার কানেক্ট করুন');
    }
    if (onError) onError(err);
    return { success: false, error: err.message };
  }

  return { success: false, reason: 'printer_not_connected' };
}

/**
 * Convenient auto-print helper for Payment Done confirmation
 * Only prints if printer is already connected, otherwise silently skips
 */
export async function autoPrintReceiptIfConnected(order) {
  return await printReceipt(order, { autoPrintOnlyIfConnected: true });
}
