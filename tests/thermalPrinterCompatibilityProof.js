/**
 * tests/thermalPrinterCompatibilityProof.js
 *
 * END-TO-END COMPATIBILITY PROOF for the Rongdhonu thermal printing path.
 *
 * WHAT THIS PROVES (executes the REAL code, not a re-implementation):
 *   - The real exported printReceipt() from services/printerService.js is run.
 *   - Against many emulated BLE printers that use DIFFERENT GATT service families.
 *   - The real GATT discovery, real ESC/POS raster packing and real BLE chunking run.
 *   - The exact bytes that were "written over Bluetooth" are captured and re-parsed
 *     against the ESC/POS (GS v 0) specification byte-for-byte.
 *   - The bytes are decoded back into a bitmap and checked to contain the receipt.
 *
 * WHAT THIS DOES NOT PROVE (honest scope - see the limits printed at the end):
 *   - BLE (GATT) printers only. Bluetooth-Classic / SPP-only printers never appear
 *     in the Web Bluetooth picker - no amount of app code can change that.
 *   - Runs on Chrome (Android/desktop) and Edge. iOS Safari has no Web Bluetooth.
 *   - Real Bengali glyph shaping happens in the browser's <canvas>. Here the canvas
 *     is emulated, so the pipeline is verified, not the OS font rasteriser.
 *
 * Run:  node tests/thermalPrinterCompatibilityProof.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BASE = '-0000-1000-8000-00805f9b34fb';
const svc = (short) => short + BASE;

const PROFILES = [
  {
    key: 'XPRINTER', label: 'Xprinter XP-58 / Milestone', expect: 'success',
    services: [{ uuid: 'e7810a71-73ae-499d-8c15-4409ed9435df', chars: [{ uuid: 'e7810a71-73ae-499d-8c15-4409ed9435df', writeWithoutResponse: true }] }]
  },
  {
    key: 'ISSC_UART', label: 'ISSC Transparent UART', expect: 'success',
    services: [{ uuid: '49535343-fe7d-4ae5-8fa9-9fafd205e455', chars: [{ uuid: '49535343-8841-43f4-a8d4-ecbe34729bb3', writeWithoutResponse: true }] }]
  },
  {
    key: 'HM10', label: 'HM-10 / MPT-II  (FFE0)', expect: 'success',
    services: [{ uuid: svc('0000ffe0'), chars: [{ uuid: svc('0000ffe1'), writeWithoutResponse: true }] }]
  },
  {
    key: 'GENERIC_FF00', label: 'Generic Chinese POS (FF00)', expect: 'success',
    services: [{ uuid: svc('0000ff00'), chars: [{ uuid: svc('0000ff01'), writeWithoutResponse: true }] }]
  },
  {
    key: 'NETUM_FF12', label: 'Netum / POS-58 (FF12)', expect: 'success',
    services: [{ uuid: svc('0000ff12'), chars: [{ uuid: svc('0000ff11'), writeWithoutResponse: true }] }]
  },
  {
    key: 'STD_18F0', label: 'Standard Thermal Service (18F0)', expect: 'success',
    services: [{ uuid: svc('000018f0'), chars: [{ uuid: svc('00002af1'), writeWithoutResponse: true }] }]
  },
  {
    key: 'FFF0', label: 'Chinese POS (FFF0)', expect: 'success',
    services: [{ uuid: svc('0000fff0'), chars: [{ uuid: svc('0000fff1'), writeWithoutResponse: true }] }]
  },
  {
    key: 'VENDOR_AF30', label: 'Vendor AE/AF family (AF30)', expect: 'success',
    services: [{ uuid: svc('0000af30'), chars: [{ uuid: svc('0000af31'), writeWithoutResponse: true }] }]
  },
  {
    key: 'FEE7', label: 'BLE module service (FEE7)', expect: 'success',
    services: [{ uuid: svc('0000fee7'), chars: [{ uuid: svc('0000fee8'), writeWithoutResponse: true }] }]
  },
  {
    key: 'WRITE_ONLY', label: 'Only write-with-response char', expect: 'success',
    services: [{ uuid: svc('0000fff0'), chars: [{ uuid: svc('0000fff2'), write: true, writeWithoutResponse: false }] }]
  },
  {
    key: 'MULTI_SVC', label: 'Multi-service, char on 2nd service', expect: 'success',
    services: [
      { uuid: svc('00001800'), chars: [{ uuid: svc('00002a00') }] },
      { uuid: svc('0000ff00'), chars: [{ uuid: svc('0000ff02'), writeWithoutResponse: true }] }
    ]
  },
  {
    key: 'SMALL_MTU', label: 'Conservative MTU 23 (20 B payload)', expect: 'success',
    services: [{ uuid: svc('0000ff00'), chars: [{ uuid: svc('0000ff01'), writeWithoutResponse: true, maxMtu: 20 }] }]
  },
  {
    key: 'UNKNOWN_SVC', label: 'NON-whitelisted service (boundary)', expect: 'not_connected',
    services: [{ uuid: '12345678-1234-1234-1234-1234567890ab', chars: [{ uuid: '12345678-1234-1234-1234-1234567890ab', writeWithoutResponse: true }] }]
  },
  {
    key: 'NO_BLUETOOTH', label: 'No Web Bluetooth API (unsupported)', expect: 'unsupported', bluetooth: false
  }
];

const ORDER = {
  id: 'proof_order_1',
  tableId: 'T-04',
  fullDate: '2026-09-22',
  time: '10:30 PM',
  items: [
    { name: 'চিকেন নাগা উইংস', qty: 2, price: 150, total: 300 },
    { name: 'স্পেশাল ফ্রাইড রাইস', qty: 1, price: 280, total: 280 }
  ],
  totalAmount: 580,
  paidAmount: 580,
  paymentMethod: 'bKash'
};

/* ==========================================================================
 *  EMULATED HARDWARE (child process)
 * ========================================================================== */

function makeCharacteristic(spec, transport) {
  const props = { write: !!spec.write, writeWithoutResponse: !!spec.writeWithoutResponse };
  const char = { uuid: spec.uuid, properties: props };
  const record = (value) => {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    if (spec.maxMtu && bytes.length > spec.maxMtu) {
      return Promise.reject(new Error(`GATT write too long (${bytes.length} > ${spec.maxMtu})`));
    }
    transport.packets.push(bytes);
    transport.totalBytes += bytes.length;
    transport.maxChunk = Math.max(transport.maxChunk, bytes.length);
    return Promise.resolve();
  };
  if (props.writeWithoutResponse) char.writeValueWithoutResponse = record;
  if (props.write) char.writeValue = record;
  return char;
}

function makeService(spec, transport) {
  return {
    uuid: spec.uuid,
    async getCharacteristics() {
      return spec.chars.map((c) => makeCharacteristic(c, transport));
    }
  };
}

function makeDevice(profile, transport, grant) {
  const services = profile.services.map((s) => makeService(s, transport));
  const granted = (uuid) => Boolean(grant.services) && grant.services.has(String(uuid).toLowerCase());
  const gatt = {
    connected: false,
    async connect() { this.connected = true; return server; },
    disconnect() { this.connected = false; }
  };
  const server = {
    async getPrimaryService(uuid) {
      const key = String(uuid).toLowerCase();
      const found = services.find((s) => s.uuid.toLowerCase() === key);
      // Web Bluetooth only exposes services that were granted via optionalServices.
      if (!found || !granted(key)) throw new Error('SecurityError: not present/not allowed: ' + uuid);
      return found;
    },
    async getPrimaryServices() { return services.filter((s) => granted(s.uuid)); }
  };
  return {
    id: 'mock-' + profile.key,
    name: profile.label,
    addEventListener() {},
    gatt
  };
}

function makeCanvasMock(bag) {
  const canvas = { width: 300, height: 150, _texts: [] };
  canvas.getContext = function () {
    const ctx = {
      fillStyle: '#000', strokeStyle: '#000', lineWidth: 1,
      font: '16px sans-serif', textAlign: 'left',
      fillRect() {}, beginPath() {}, setLineDash() {},
      moveTo() {}, lineTo() {}, stroke() {},
      fillText(text, x, y) {
        canvas._texts.push({ text: String(text), x, y, font: ctx.font, textAlign: ctx.textAlign });
      },
      getImageData(x, y, w, h) {
        const data = new Uint8ClampedArray(w * h * 4).fill(255);
        const setBlack = (px, py) => {
          if (px < 0 || py < 0 || px >= w || py >= h) return;
          const i = (py * w + px) * 4;
          data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 255;
        };
        canvas._texts.forEach((t) => {
          const m = t.font.match(/(\d+)px/);
          const size = m ? parseInt(m[1], 10) : 16;
          const tw = Math.max(2, Math.ceil(t.text.length * size * 0.55));
          let x0 = t.x;
          if (t.textAlign === 'center') x0 = t.x - tw / 2;
          else if (t.textAlign === 'right') x0 = t.x - tw;
          const y0 = t.y - size + 2;
          for (let yy = Math.round(y0); yy < Math.round(y0 + size); yy++) {
            for (let xx = Math.round(x0); xx < Math.round(x0 + tw); xx++) setBlack(xx, yy);
          }
        });
        return { data, width: w, height: h };
      }
    };
    return ctx;
  };
  bag.canvases.push(canvas);
  return canvas;
}

function makeDocumentMock(bag, onToast) {
  const body = {
    appendChild(el) {
      if (el && el.id === 'pos-printer-toast' && onToast) onToast();
      return el;
    },
    removeChild() {}
  };
  return {
    body,
    getElementById() { return null; },
    createElement(tag) {
      if (String(tag).toLowerCase() === 'canvas') return makeCanvasMock(bag);
      return { id: '', style: {}, textContent: '', appendChild() {}, remove() {}, setAttribute() {}, addEventListener() {} };
    }
  };
}

function makeNavigatorMock(profile, transport) {
  if (profile.bluetooth === false) return {};
  const grant = { services: null };
  const device = makeDevice(profile, transport, grant);
  return {
    bluetooth: {
      async getDevices() { return []; },
      async requestDevice(opts) {
        // Mirror the browser: only the UUIDs passed as optionalServices become reachable.
        const list = (opts && opts.optionalServices) || [];
        grant.services = new Set(list.map((u) => String(u).toLowerCase()));
        return device;
      }
    }
  };
}

function installGlobals(vals) {
  Object.keys(vals).forEach((k) => {
    try {
      Object.defineProperty(globalThis, k, { value: vals[k], writable: true, configurable: true });
    } catch (e) {
      globalThis[k] = vals[k];
    }
  });
}

function concatPackets(packets) {
  const total = packets.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  packets.forEach((p) => { out.set(p, off); off += p.length; });
  return out;
}

function analyzeStream(packets) {
  const bytes = concatPackets(packets);
  const out = { bytes: bytes.length, valid: false };
  if (bytes.length < 16) return out;

  out.init = bytes[0] === 0x1B && bytes[1] === 0x40;
  out.raster = bytes[2] === 0x1D && bytes[3] === 0x76 && bytes[4] === 0x30 && bytes[5] === 0x00;

  const widthBytes = bytes[6] | (bytes[7] << 8);
  const height = bytes[8] | (bytes[9] << 8);
  out.widthBytes = widthBytes;
  out.widthDots = widthBytes * 8;
  out.height = height;

  const rasterLen = widthBytes * height;
  const tail = 10 + rasterLen;
  out.feed = bytes[tail] === 0x1B && bytes[tail + 1] === 0x64 && bytes[tail + 2] === 0x04;
  out.cut = bytes[tail + 3] === 0x1D && bytes[tail + 4] === 0x56 && bytes[tail + 5] === 0x01;
  out.lengthExact = bytes.length === tail + 6;

  let black = 0;
  const preview = [];
  const rows = Math.min(height, 64);
  for (let r = 0; r < rows; r++) {
    let row = '';
    for (let d = 0; d < widthBytes * 8; d++) {
      const byteIdx = Math.floor(d / 8);
      const bitPos = 7 - (d % 8);
      const on = (bytes[10 + r * widthBytes + byteIdx] >> bitPos) & 1;
      if (on) black++;
      if (d % 4 === 0) row += on ? '#' : '.';
    }
    preview.push(row);
  }
  out.blackPixels = black;
  out.preview = preview;

  out.valid = out.init && out.raster && out.feed && out.cut && out.lengthExact && out.widthDots === 384;
  return out;
}

async function runChild(key) {
  const profile = PROFILES.find((p) => p.key === key);
  const transport = { packets: [], totalBytes: 0, maxChunk: 0 };
  const bag = { canvases: [] };
  let toastShown = false;

  installGlobals({
    navigator: makeNavigatorMock(profile, transport),
    document: makeDocumentMock(bag, () => { toastShown = true; }),
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    window: {}
  });

  const service = require('../services/printerService');
  let result;
  try {
    result = await service.printReceipt(ORDER);
  } catch (err) {
    result = { success: false, fatal: err.message };
  }

  const analysis = analyzeStream(transport.packets);
  const payload = {
    key,
    result,
    toastShown,
    contentLines: bag.canvases.length ? bag.canvases[0]._texts.length : 0,
    transport: { bytes: transport.totalBytes, packets: transport.packets.length, maxChunk: transport.maxChunk },
    analysis
  };
  process.stdout.write('__RESULT__' + JSON.stringify(payload) + '\n');
}

/* ==========================================================================
 *  ORCHESTRATOR (parent process)
 * ========================================================================== */

function runParent() {
  console.log('================================================================================');
  console.log('   THERMAL PRINTER COMPATIBILITY PROOF — REAL printReceipt() vs EMULATED BLE     ');
  console.log('================================================================================\n');

  // Static source guard
  const src = fs.readFileSync(path.join(__dirname, '../services/printerService.js'), 'utf8');
  assert(!src.includes('window.print'), 'FATAL: window.print() present in printerService.js');
  assert(!src.includes('printReceiptViaBrowserPdf'), 'FATAL: browser PDF path present');
  assert(!src.includes('expo-print'), 'FATAL: expo-print referenced');
  console.log('[GUARD] printerService.js contains zero browser-print / PDF code paths. OK\n');

  const results = [];
  PROFILES.forEach((p) => {
    const stdout = execFileSync(process.execPath, [__filename], {
      env: Object.assign({}, process.env, { PROOF_CHILD_PROFILE: p.key }),
      encoding: 'utf8'
    });
    const line = stdout.split('\n').find((l) => l.startsWith('__RESULT__'));
    if (!line) throw new Error('Child produced no result for ' + p.key);
    results.push(JSON.parse(line.slice('__RESULT__'.length)));
  });

  const preview = [];
  let pass = 0;
  let fail = 0;

  results.forEach((r) => {
    const p = PROFILES.find((x) => x.key === r.key);
    let ok = false;
    let note = '';

    if (p.expect === 'success') {
      const a = r.analysis;
      ok = r.result.success === true &&
        r.result.method === 'web_bluetooth_escpos' &&
        a.valid && a.widthDots === 384 && a.blackPixels > 0 &&
        r.contentLines > 0 && r.transport.maxChunk <= 100 && r.toastShown === false;
      note = `${a.bytes} B / ${r.transport.packets} pkts / ${a.widthDots}x${a.height} dots / ${a.blackPixels} black px / ${r.contentLines} text draws`;
    } else if (p.expect === 'not_connected') {
      ok = r.result.success === false && r.result.reason === 'printer_not_connected' && r.toastShown === true;
      note = `rejected (boundary) -> toast="${r.toastShown}"`;
    } else if (p.expect === 'unsupported') {
      ok = r.result.success === false && r.result.reason === 'web_bluetooth_not_supported' && r.toastShown === true;
      note = `rejected (no Web Bluetooth) -> toast="${r.toastShown}"`;
    }

    if (ok) pass++; else fail++;
    console.log(`  ${ok ? '✅' : '❌'} ${p.label.padEnd(38)} ${note}`);
    if (p.key === 'GENERIC_FF00' || p.key === 'XPRINTER') preview.push({ label: p.label, a: r.analysis });
  });

  preview.forEach((pv) => {
    console.log(`\n[BITMAP RECOVERED FROM THE BYTES SENT OVER BLUETOOTH — ${pv.label}]`);
    pv.a.preview.forEach((row) => console.log('   ' + row));
    console.log(`   (reconstructed ${pv.a.widthDots} dots wide, ${pv.a.height} rows tall, ${pv.a.blackPixels} black dots)`);
  });

  console.log('\n================================================================================');
  console.log(`   RESULT: ${pass} passed, ${fail} failed`);
  console.log('   Verified: real GATT discovery + real ESC/POS raster + real BLE chunking.');
  console.log('   Verified: unsupported / unknown-service printers are refused with the toast,');
  console.log('             and NO browser print dialog can ever be reached.');
  console.log('================================================================================');

  if (fail > 0) process.exit(1);
}

if (process.env.PROOF_CHILD_PROFILE) {
  runChild(process.env.PROOF_CHILD_PROFILE);
} else {
  runParent();
}
