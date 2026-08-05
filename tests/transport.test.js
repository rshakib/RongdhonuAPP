/**
 * AI Dataset Transport Layer — Unit Test Suite
 *
 * Runnable WITHOUT launching the POS application.
 * Plain Node.js assert. Tests batching, payload compaction, and transport functions.
 *
 * Run with:
 *   node tests/transport.test.js
 */

'use strict';
const assert = require('assert');

// ─────────────────────────────────────────────
// INLINE TRANSPORT LOGIC FOR ISOLATED TESTING
// ─────────────────────────────────────────────
const DEFAULT_BATCH_SIZE = 25;
const SPREADSHEET_NAME = 'Rongdhonu_ML_Dataset';

function optimizePayloadForTransport(payloadObj) {
  if (!payloadObj) return null;
  if (Array.isArray(payloadObj)) {
    return payloadObj.map(item => optimizePayloadForTransport(item));
  }
  if (typeof payloadObj !== 'object') return payloadObj;
  const clean = Object.assign({}, payloadObj);
  delete clean._debug;
  delete clean._temp;
  delete clean.__v;
  return clean;
}

function buildBatchPayload(queueRecords) {
  const dailyRows = [];
  const itemRows = [];
  const processedRecordIds = [];

  for (let i = 0; i < queueRecords.length; i++) {
    const record = queueRecords[i];
    processedRecordIds.push(record.id);
    let parsedPayload;
    try {
      parsedPayload = typeof record.payload === 'string' ? JSON.parse(record.payload) : record.payload;
    } catch (e) {
      continue;
    }

    const cleanPayload = optimizePayloadForTransport(parsedPayload);

    if (record.type === 'AI_DAILY_SALES_DATASET') {
      dailyRows.push(cleanPayload);
    } else if (record.type === 'AI_ITEM_SALES_DATASET') {
      if (Array.isArray(cleanPayload)) {
        itemRows.push.apply(itemRows, cleanPayload);
      } else {
        itemRows.push(cleanPayload);
      }
    }
  }

  return {
    spreadsheetName: SPREADSHEET_NAME,
    batchSize: queueRecords.length,
    timestamp: new Date().toISOString(),
    compression: 'none',
    sheets: {
      dailySales: {
        targetTab: 'AI_Daily_Sales_Dataset',
        rows: dailyRows,
      },
      itemSales: {
        targetTab: 'AI_Item_Sales_Dataset',
        rows: itemRows,
      },
    },
    recordIds: processedRecordIds,
  };
}

// ─────────────────────────────────────────────
// TEST RUNNER
// ─────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    console.log('  \u2705  ' + name);
    passed++;
  } catch (err) {
    console.log('  \u274c  ' + name);
    console.log('      \u2192 ' + err.message);
    failures.push({ name, error: err.message });
    failed++;
  }
}

// ─────────────────────────────────────────────
// SUITE 1: PAYLOAD OPTIMIZATION
// ─────────────────────────────────────────────
console.log('\n\u2500\u2500 Suite 1: Payload Optimization \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');

test('Payload optimization strips transient _debug and _temp fields', function() {
  const raw = { dataset_id: '2026-08-05', total_sales: 1000, _debug: 'test', _temp: 123 };
  const clean = optimizePayloadForTransport(raw);
  assert.strictEqual(clean._debug, undefined);
  assert.strictEqual(clean._temp, undefined);
  assert.strictEqual(clean.dataset_id, '2026-08-05');
  assert.strictEqual(clean.total_sales, 1000);
});

test('Payload optimization handles arrays of item datasets losslessly', function() {
  const items = [
    { item_name: 'Burger', total_quantity_sold: 10, _debug: true },
    { item_name: 'Pizza', total_quantity_sold: 5, _temp: 'delete' },
  ];
  const clean = optimizePayloadForTransport(items);
  assert.strictEqual(clean.length, 2);
  assert.strictEqual(clean[0]._debug, undefined);
  assert.strictEqual(clean[0].item_name, 'Burger');
  assert.strictEqual(clean[1]._temp, undefined);
  assert.strictEqual(clean[1].item_name, 'Pizza');
});

// ─────────────────────────────────────────────
// SUITE 2: BATCH PAYLOAD CONSTRUCTION
// ─────────────────────────────────────────────
console.log('\n\u2500\u2500 Suite 2: Batch Payload Construction \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');

test('buildBatchPayload creates structured batch object for multi-record queues', function() {
  const records = [
    {
      id: '2026-08-05',
      type: 'AI_DAILY_SALES_DATASET',
      payload: JSON.stringify({ dataset_id: '2026-08-05', total_sales: 5000 }),
    },
    {
      id: 'ITEM_2026-08-05',
      type: 'AI_ITEM_SALES_DATASET',
      payload: JSON.stringify([{ item_name: 'Burger', total_quantity_sold: 10 }]),
    },
  ];

  const batch = buildBatchPayload(records);

  assert.strictEqual(batch.spreadsheetName, 'Rongdhonu_ML_Dataset');
  assert.strictEqual(batch.batchSize, 2);
  assert.strictEqual(batch.compression, 'none');
  assert.strictEqual(batch.sheets.dailySales.targetTab, 'AI_Daily_Sales_Dataset');
  assert.strictEqual(batch.sheets.dailySales.rows.length, 1);
  assert.strictEqual(batch.sheets.itemSales.targetTab, 'AI_Item_Sales_Dataset');
  assert.strictEqual(batch.sheets.itemSales.rows.length, 1);
  assert.deepStrictEqual(batch.recordIds, ['2026-08-05', 'ITEM_2026-08-05']);
});

test('buildBatchPayload supports up to 25 items in a single batch', function() {
  const records = [];
  for (let i = 1; i <= 25; i++) {
    records.push({
      id: `2026-08-${String(i).padStart(2, '0')}`,
      type: 'AI_DAILY_SALES_DATASET',
      payload: JSON.stringify({ dataset_id: `2026-08-${String(i).padStart(2, '0')}`, total_sales: 1000 * i }),
    });
  }

  const batch = buildBatchPayload(records);
  assert.strictEqual(batch.batchSize, 25);
  assert.strictEqual(batch.sheets.dailySales.rows.length, 25);
  assert.strictEqual(batch.recordIds.length, 25);
});

// ─────────────────────────────────────────────
// FINAL SUMMARY
// ─────────────────────────────────────────────
console.log('\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
console.log('  transport.test.js \u2014 ' + (passed + failed) + ' tests');
console.log('  Passed : ' + passed);
console.log('  Failed : ' + failed);
if (failures.length > 0) {
  console.log('\n  Failed tests:');
  failures.forEach(function(f) { console.log('    \u274c ' + f.name + '\n       ' + f.error); });
}
console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n');
if (failed > 0) process.exit(1);
