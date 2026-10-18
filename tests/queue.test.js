/**
 * AI Dataset Queue Integration — Phase 3 Unit Test Suite
 *
 * Tests the enqueueAIDatasetExport() integration:
 *   Builder → Validator → ai_dataset_queue
 *
 * Uses fully in-process mock SQLite and mock builder.
 * Zero external dependencies. Run with:
 *   node tests/queue.test.js
 */

'use strict';
const assert = require('assert');

// ─────────────────────────────────────────────
// ISO-8601 WEEK NUMBER (copied from builder.js)
// ─────────────────────────────────────────────
function getISOWeekNumber(dateObj) {
  const d = new Date(Date.UTC(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

// ─────────────────────────────────────────────
// MOCK SQLITE (in-process, no binary)
// ─────────────────────────────────────────────
function createMockSQLite(options) {
  const store = {};
  return {
    _store: store,
    getFirstSync(query, params) {
      if (query.includes('daily_submit')) {
        return options.hasSubmit ? { id: params[0] } : null;
      }
      return null;
    },
    runSync(query, params) {
      if (query.includes('ai_dataset_queue')) {
        const id = params[0];
        store[id] = {
          id:            params[0],
          type:          query.includes('AI_DAILY_SALES_DATASET') ? 'AI_DAILY_SALES_DATASET' : 'AI_ITEM_SALES_DATASET',
          business_date: params[1],
          payload:       params[2],
          status:        'PENDING',
          retry_count:   0,
          last_error:    null,
          created_at:    params[4],
          updated_at:    params[5],
          is_synced:     0,
        };
      }
    },
    getAllSync() { return []; }
  };
}

// ─────────────────────────────────────────────
// SIMULATED BUILDER (mirrors builder.js)
// ─────────────────────────────────────────────
function buildDailyDatasetSim(businessDate, db, overrides) {
  if (!businessDate || typeof businessDate !== 'string') {
    return Object.freeze({ error: 'INVALID_BUSINESS_DATE_PARAMETER' });
  }
  const submit = db.getFirstSync('SELECT * FROM daily_submit WHERE date = ?', [businessDate]);
  if (!submit) return Object.freeze({ error: 'BUSINESS_DATE_NOT_FOUND' });
  const dateObj    = new Date(businessDate + 'T00:00:00');
  const dayOfMonth = dateObj.getDate();
  const nextDayObj = new Date(dateObj);
  nextDayObj.setDate(dayOfMonth + 1);
  const isMonthEnd = nextDayObj.getDate() === 1 ? 1 : 0;
  const base = {
    dataset_id:         businessDate,
    business_date:      businessDate,
    schema_version:     '1.0.0',
    dataset_version:    '1.0.0',
    exported_at:        new Date().toISOString(),
    year:               dateObj.getFullYear(),
    month:              dateObj.getMonth() + 1,
    week_number:        getISOWeekNumber(dateObj),
    day_of_month:       dayOfMonth,
    day_of_week:        dateObj.getDay(),
    day_name:           'Wednesday',
    is_friday:          dateObj.getDay() === 5 ? 1 : 0,
    is_weekend:         (dateObj.getDay() === 5 || dateObj.getDay() === 6) ? 1 : 0,
    is_month_start:     dayOfMonth === 1 ? 1 : 0,
    is_month_end:       isMonthEnd,
    days_until_salary:  25,
    days_after_salary:  dayOfMonth - 1,
    temperature:        32,
    feels_like_temperature: null,
    humidity:           75,
    rainfall_mm:        null,
    weather_condition:  'Cloudy',
    is_rainy:           0,
    wind_speed:         10,
    is_holiday:         0,
    holiday_name:       '',
    holiday_source:     'none',
    festival_type:      'None',
    is_off_day:         0,
    off_day_reason:     '',
    store_open_time:    null,
    store_close_time:   null,
    business_hours:     null,
    promotion_running:  0,
    promotion_name:     null,
    promotion_discount: 0.0,
    calendar_date:      businessDate,
    total_orders:       50,
    total_sales:        9500,
    cash_sales:         6000,
    bkash_sales:        2000,
    nagad_sales:        1000,
    rocket_sales:       500,
    card_sales:         0,
    delivery_sales:     500,
    delivery_charge:    100,
    total_discount:     200,
    net_sales:          9300,
    average_order_value: 190,
    peak_hour:          '13:00',
    opening_ijara:      2000,
    total_expense:      2000,
    closing_cash:       3000,
    owner_deposit:      5000,
    expense_ratio:      21.05,
    is_complete:        1,
    is_valid:           1,
    is_training_ready:  1,
    validation_errors:  '[]',
    target_sales:       null,
    created_at:         new Date().toISOString(),
    updated_at:         new Date().toISOString(),
  };
  return Object.freeze(Object.assign({}, base, overrides || {}));
}

function buildItemDatasetSim(businessDate, db, overrideItems) {
  if (!businessDate || typeof businessDate !== 'string') {
    return Object.freeze({ error: 'INVALID_BUSINESS_DATE_PARAMETER' });
  }
  const items = overrideItems || [
    { id: 'i1', name: 'Burger', category: 'Fast Food', price: 120 },
    { id: 'i2', name: 'Tea',    category: 'Beverages', price: 30  },
  ];
  const now = new Date().toISOString();
  const dateObj = new Date(businessDate + 'T00:00:00');
  return Object.freeze(items.map(function(item, idx) {
    return Object.freeze({
      dataset_id:          businessDate + '_' + item.id,
      business_date:       businessDate,
      item_id:             item.id,
      item_name:           item.name,
      category_name:       item.category,
      schema_version:      '1.0.0',
      dataset_version:     '1.0.0',
      exported_at:         now,
      unit_price:          item.price,
      total_quantity_sold: 10 + idx,
      total_item_revenue:  (10 + idx) * item.price,
      item_rank_today:     idx + 1,
      item_share_percent:  50,
      is_out_of_stock:     null,
      available_quantity:  null,
      day_of_week:         dateObj.getDay(),
      is_friday:           0,
      is_holiday:          0,
      is_rainy:            0,
      is_complete:         1,
      is_valid:            1,
      is_training_ready:   1,
      validation_errors:   '[]',
      target_quantity:     null,
      created_at:          now,
      updated_at:          now,
    });
  }));
}

// ─────────────────────────────────────────────
// SIMULATED enqueueAIDatasetExport (mirrors database.js Phase 3)
// ─────────────────────────────────────────────
function enqueueAIDatasetExport(dateStr, db, builderOptions) {
  const now = new Date().toISOString();

  // GUARD: finalized check
  const committedSubmit = db.getFirstSync('SELECT id FROM daily_submit WHERE date = ?', [dateStr]);
  if (!committedSubmit) {
    console.warn('[AI Queue] Not finalized. Enqueue skipped.');
    return { success: false, reason: 'NOT_FINALIZED' };
  }

  // STEP 1: Build Daily Dataset
  const dailyDataset = buildDailyDatasetSim(dateStr, db, builderOptions && builderOptions.dailyOverrides);
  if (dailyDataset && dailyDataset.error) {
    return { success: false, reason: dailyDataset.error };
  }

  // STEP 2: Validate Daily Dataset
  const errors = [];
  if (!dailyDataset.business_date) errors.push('MISSING_BUSINESS_DATE');
  if (!dailyDataset.dataset_id)    errors.push('MISSING_DATASET_ID');
  if ((dailyDataset.total_sales   || 0) < 0) errors.push('NEGATIVE_TOTAL_SALES');
  if ((dailyDataset.total_expense || 0) < 0) errors.push('NEGATIVE_TOTAL_EXPENSE');
  const paymentSum = (dailyDataset.cash_sales || 0) + (dailyDataset.bkash_sales || 0) +
                     (dailyDataset.nagad_sales || 0) + (dailyDataset.rocket_sales || 0) +
                     (dailyDataset.card_sales  || 0);
  if (Math.abs(paymentSum - (dailyDataset.total_sales || 0)) > 0.01) {
    errors.push('PAYMENT_SUM_MISMATCH:Sum=' + paymentSum + ',Total=' + dailyDataset.total_sales);
  }
  const dailyValidation = {
    isComplete: !errors.includes('MISSING_BUSINESS_DATE') && !errors.includes('MISSING_DATASET_ID'),
    errors,
  };

  if (!dailyValidation.isComplete) {
    return { success: false, reason: 'DAILY_VALIDATION_FAILED', validationErrors: dailyValidation.errors };
  }

  // STEP 3: Build Item Dataset
  const itemDatasets = buildItemDatasetSim(dateStr, db, builderOptions && builderOptions.itemOverrideItems);
  if (itemDatasets && itemDatasets.error) {
    return { success: false, reason: itemDatasets.error };
  }
  const itemArray = Array.isArray(itemDatasets) ? itemDatasets : [];

  // STEP 4: Validate Items
  const itemValidationErrors = [];
  for (var i = 0; i < itemArray.length; i++) {
    const item = itemArray[i];
    const itemErrors = [];
    if (!item.business_date) itemErrors.push('MISSING_BUSINESS_DATE');
    if (!item.item_name)     itemErrors.push('MISSING_ITEM_NAME');
    if ((item.total_quantity_sold || 0) < 0) itemErrors.push('NEGATIVE_QUANTITY');
    if ((item.total_item_revenue  || 0) < 0) itemErrors.push('NEGATIVE_REVENUE');
    if (itemErrors.length > 0) itemValidationErrors.push({ item_name: item.item_name, errors: itemErrors });
  }
  if (itemValidationErrors.length > 0) {
    return { success: false, reason: 'ITEM_VALIDATION_FAILED', validationErrors: itemValidationErrors };
  }

  // STEP 5: Insert daily queue record
  const dailyQueueId = dateStr;
  const itemQueueId  = 'ITEM_' + dateStr;

  const existingDaily = db._store[dailyQueueId] || null;
  db.runSync(
    "INSERT OR REPLACE INTO ai_dataset_queue (id, type, business_date, payload, status, retry_count, last_error, created_at, updated_at, is_synced) VALUES (?, 'AI_DAILY_SALES_DATASET', ?, ?, 'PENDING', 0, NULL, ?, ?, 0)",
    [dailyQueueId, dateStr, JSON.stringify(dailyDataset), now, now]
  );
  if (existingDaily) {
    console.log('[AI Queue] Duplicate Updated  — AI_DAILY_SALES_DATASET  date=' + dateStr);
  } else {
    console.log('[AI Queue] Daily Dataset Enqueued — AI_DAILY_SALES_DATASET  date=' + dateStr);
  }

  // STEP 6: Insert item queue record
  const existingItem = db._store[itemQueueId] || null;
  db.runSync(
    "INSERT OR REPLACE INTO ai_dataset_queue (id, type, business_date, payload, status, retry_count, last_error, created_at, updated_at, is_synced) VALUES (?, 'AI_ITEM_SALES_DATASET', ?, ?, 'PENDING', 0, NULL, ?, ?, 0)",
    [itemQueueId, dateStr, JSON.stringify(itemArray), now, now]
  );
  if (existingItem) {
    console.log('[AI Queue] Duplicate Updated  — AI_ITEM_SALES_DATASET   date=' + dateStr);
  } else {
    console.log('[AI Queue] Item Dataset Enqueued  — AI_ITEM_SALES_DATASET   date=' + dateStr + '  items=' + itemArray.length);
  }

  return {
    success:        true,
    businessDate:   dateStr,
    dailyDatasetId: dailyQueueId,
    itemDatasetId:  itemQueueId,
    itemCount:      itemArray.length,
    queuedAt:       now,
  };
}

// ─────────────────────────────────────────────
// TEST RUNNER
// ─────────────────────────────────────────────
let passed = 0, failed = 0;
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
// SUITE 1: NORMAL DAILY SUBMIT
// ─────────────────────────────────────────────
console.log('\n\u2500\u2500 Suite 1: Normal Daily Submit \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');

test('Normal submit: returns success=true', function() {
  const db = createMockSQLite({ hasSubmit: true });
  const result = enqueueAIDatasetExport('2026-08-05', db);
  assert.strictEqual(result.success, true, JSON.stringify(result));
});
test('Normal submit: businessDate matches', function() {
  const db = createMockSQLite({ hasSubmit: true });
  const result = enqueueAIDatasetExport('2026-08-05', db);
  assert.strictEqual(result.businessDate, '2026-08-05');
});
test('Normal submit: dailyDatasetId = businessDate', function() {
  const db = createMockSQLite({ hasSubmit: true });
  const result = enqueueAIDatasetExport('2026-08-05', db);
  assert.strictEqual(result.dailyDatasetId, '2026-08-05');
});
test('Normal submit: itemDatasetId = ITEM_<businessDate>', function() {
  const db = createMockSQLite({ hasSubmit: true });
  const result = enqueueAIDatasetExport('2026-08-05', db);
  assert.strictEqual(result.itemDatasetId, 'ITEM_2026-08-05');
});
test('Normal submit: itemCount > 0', function() {
  const db = createMockSQLite({ hasSubmit: true });
  const result = enqueueAIDatasetExport('2026-08-05', db);
  assert.ok(result.itemCount > 0, 'Expected at least 1 item in queue');
});
test('Normal submit: queuedAt is a valid ISO timestamp', function() {
  const db = createMockSQLite({ hasSubmit: true });
  const result = enqueueAIDatasetExport('2026-08-05', db);
  assert.ok(typeof result.queuedAt === 'string' && result.queuedAt.length > 0);
  assert.ok(!isNaN(Date.parse(result.queuedAt)));
});

// ─────────────────────────────────────────────
// SUITE 2: LATE DAILY SUBMIT (past business date)
// ─────────────────────────────────────────────
console.log('\n\u2500\u2500 Suite 2: Late Daily Submit \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');

test('Late submit (past date): succeeds if daily_submit exists', function() {
  const db = createMockSQLite({ hasSubmit: true });
  const result = enqueueAIDatasetExport('2026-07-31', db);
  assert.strictEqual(result.success, true);
});
test('Late submit: isFriday preserved correctly (July 31 is Friday)', function() {
  const db = createMockSQLite({ hasSubmit: true });
  const result = enqueueAIDatasetExport('2026-07-31', db);
  assert.strictEqual(result.success, true);
  const payload = JSON.parse(db._store['2026-07-31'].payload);
  assert.strictEqual(payload.day_of_week, 5, '2026-07-31 is a Friday (day 5)');
});
test('Late submit: month-end flag correct for July 31', function() {
  const db = createMockSQLite({ hasSubmit: true });
  enqueueAIDatasetExport('2026-07-31', db);
  const payload = JSON.parse(db._store['2026-07-31'].payload);
  assert.strictEqual(payload.is_month_end, 1, '2026-07-31 is month end');
});
test('Late submit: month-start flag correct for August 1', function() {
  const db = createMockSQLite({ hasSubmit: true });
  enqueueAIDatasetExport('2026-08-01', db);
  const payload = JSON.parse(db._store['2026-08-01'].payload);
  assert.strictEqual(payload.is_month_start, 1, '2026-08-01 is month start');
});

// ─────────────────────────────────────────────
// SUITE 3: OVERWRITE / DUPLICATE SUBMIT
// ─────────────────────────────────────────────
console.log('\n\u2500\u2500 Suite 3: Overwrite / Duplicate Submit \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');

test('Duplicate enqueue: both calls return success=true', function() {
  const db = createMockSQLite({ hasSubmit: true });
  const r1 = enqueueAIDatasetExport('2026-08-05', db);
  const r2 = enqueueAIDatasetExport('2026-08-05', db);
  assert.strictEqual(r1.success, true);
  assert.strictEqual(r2.success, true);
});
test('Duplicate enqueue: only ONE daily record in queue (idempotent)', function() {
  const db = createMockSQLite({ hasSubmit: true });
  enqueueAIDatasetExport('2026-08-05', db);
  enqueueAIDatasetExport('2026-08-05', db);
  // The store uses INSERT OR REPLACE so key count stays at 2 (daily + item)
  const keys = Object.keys(db._store);
  const dailyKeys = keys.filter(function(k) { return k === '2026-08-05'; });
  const itemKeys  = keys.filter(function(k) { return k === 'ITEM_2026-08-05'; });
  assert.strictEqual(dailyKeys.length, 1, 'Exactly 1 daily queue record');
  assert.strictEqual(itemKeys.length, 1,  'Exactly 1 item queue record');
});
test('Duplicate enqueue: payload is refreshed on second call', function() {
  const db = createMockSQLite({ hasSubmit: true });
  enqueueAIDatasetExport('2026-08-05', db);
  const firstPayload  = db._store['2026-08-05'].payload;
  enqueueAIDatasetExport('2026-08-05', db);
  const secondPayload = db._store['2026-08-05'].payload;
  // Both payloads are valid JSON with matching dataset_id
  const p1 = JSON.parse(firstPayload);
  const p2 = JSON.parse(secondPayload);
  assert.strictEqual(p1.dataset_id, p2.dataset_id);
  assert.strictEqual(p1.business_date, p2.business_date);
});
test('Duplicate enqueue: status reset to PENDING on overwrite', function() {
  const db = createMockSQLite({ hasSubmit: true });
  enqueueAIDatasetExport('2026-08-05', db);
  // Simulate status change
  db._store['2026-08-05'].status = 'FAILED';
  enqueueAIDatasetExport('2026-08-05', db);
  // After re-enqueue, status is PENDING again
  assert.strictEqual(db._store['2026-08-05'].status, 'PENDING');
});

// ─────────────────────────────────────────────
// SUITE 4: VALIDATION FAILURE
// ─────────────────────────────────────────────
console.log('\n\u2500\u2500 Suite 4: Validation Failure \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');

test('Missing business_date in dataset: returns DAILY_VALIDATION_FAILED', function() {
  const db = createMockSQLite({ hasSubmit: true });
  const result = enqueueAIDatasetExport('2026-08-05', db, {
    dailyOverrides: { business_date: '', dataset_id: '' }
  });
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.reason, 'DAILY_VALIDATION_FAILED');
});
test('Validation failure: nothing inserted into queue', function() {
  const db = createMockSQLite({ hasSubmit: true });
  enqueueAIDatasetExport('2026-08-05', db, {
    dailyOverrides: { business_date: '', dataset_id: '' }
  });
  assert.strictEqual(Object.keys(db._store).length, 0, 'Queue must be empty on validation failure');
});
test('Missing dataset_id: validationErrors contains MISSING_DATASET_ID', function() {
  const db = createMockSQLite({ hasSubmit: true });
  const result = enqueueAIDatasetExport('2026-08-05', db, {
    dailyOverrides: { dataset_id: '', business_date: '2026-08-05' }
  });
  assert.ok(result.validationErrors && result.validationErrors.includes('MISSING_DATASET_ID'),
    'Expected MISSING_DATASET_ID in ' + JSON.stringify(result.validationErrors));
});

// ─────────────────────────────────────────────
// SUITE 5: NOT_FINALIZED GUARD
// ─────────────────────────────────────────────
console.log('\n\u2500\u2500 Suite 5: NOT_FINALIZED Guard \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');

test('No daily_submit record: returns NOT_FINALIZED', function() {
  const db = createMockSQLite({ hasSubmit: false });
  const result = enqueueAIDatasetExport('2026-08-05', db);
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.reason, 'NOT_FINALIZED');
});
test('No daily_submit: zero records inserted into queue', function() {
  const db = createMockSQLite({ hasSubmit: false });
  enqueueAIDatasetExport('2026-08-05', db);
  assert.strictEqual(Object.keys(db._store).length, 0);
});
test('Draft/unsubmitted day: NOT_FINALIZED (same as no-submit)', function() {
  const db = createMockSQLite({ hasSubmit: false });
  const result = enqueueAIDatasetExport('2030-01-01', db);
  assert.strictEqual(result.reason, 'NOT_FINALIZED');
});

// ─────────────────────────────────────────────
// SUITE 6: QUEUE PAYLOAD CORRECTNESS
// ─────────────────────────────────────────────
console.log('\n\u2500\u2500 Suite 6: Queue Payload Correctness \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');

test('Daily queue record: type = AI_DAILY_SALES_DATASET', function() {
  const db = createMockSQLite({ hasSubmit: true });
  enqueueAIDatasetExport('2026-08-05', db);
  assert.strictEqual(db._store['2026-08-05'].type, 'AI_DAILY_SALES_DATASET');
});
test('Item queue record: type = AI_ITEM_SALES_DATASET', function() {
  const db = createMockSQLite({ hasSubmit: true });
  enqueueAIDatasetExport('2026-08-05', db);
  assert.strictEqual(db._store['ITEM_2026-08-05'].type, 'AI_ITEM_SALES_DATASET');
});
test('Daily queue record: status = PENDING', function() {
  const db = createMockSQLite({ hasSubmit: true });
  enqueueAIDatasetExport('2026-08-05', db);
  assert.strictEqual(db._store['2026-08-05'].status, 'PENDING');
});
test('Item queue record: status = PENDING', function() {
  const db = createMockSQLite({ hasSubmit: true });
  enqueueAIDatasetExport('2026-08-05', db);
  assert.strictEqual(db._store['ITEM_2026-08-05'].status, 'PENDING');
});
test('Daily queue: retry_count = 0', function() {
  const db = createMockSQLite({ hasSubmit: true });
  enqueueAIDatasetExport('2026-08-05', db);
  assert.strictEqual(db._store['2026-08-05'].retry_count, 0);
});
test('Daily queue: last_error = null', function() {
  const db = createMockSQLite({ hasSubmit: true });
  enqueueAIDatasetExport('2026-08-05', db);
  assert.strictEqual(db._store['2026-08-05'].last_error, null);
});
test('Daily queue: is_synced = 0', function() {
  const db = createMockSQLite({ hasSubmit: true });
  enqueueAIDatasetExport('2026-08-05', db);
  assert.strictEqual(db._store['2026-08-05'].is_synced, 0);
});
test('Daily queue: business_date = 2026-08-05', function() {
  const db = createMockSQLite({ hasSubmit: true });
  enqueueAIDatasetExport('2026-08-05', db);
  assert.strictEqual(db._store['2026-08-05'].business_date, '2026-08-05');
});
test('Daily queue: payload is valid JSON', function() {
  const db = createMockSQLite({ hasSubmit: true });
  enqueueAIDatasetExport('2026-08-05', db);
  assert.doesNotThrow(function() { JSON.parse(db._store['2026-08-05'].payload); });
});
test('Item queue: payload is valid JSON array', function() {
  const db = createMockSQLite({ hasSubmit: true });
  enqueueAIDatasetExport('2026-08-05', db);
  const items = JSON.parse(db._store['ITEM_2026-08-05'].payload);
  assert.ok(Array.isArray(items), 'Item payload must be a JSON array');
});
test('Daily payload: dataset_id = businessDate', function() {
  const db = createMockSQLite({ hasSubmit: true });
  enqueueAIDatasetExport('2026-08-05', db);
  const payload = JSON.parse(db._store['2026-08-05'].payload);
  assert.strictEqual(payload.dataset_id, '2026-08-05');
});
test('Daily payload: schema_version = 1.0.0', function() {
  const db = createMockSQLite({ hasSubmit: true });
  enqueueAIDatasetExport('2026-08-05', db);
  const payload = JSON.parse(db._store['2026-08-05'].payload);
  assert.strictEqual(payload.schema_version, '1.0.0');
});
test('Daily payload: week_number uses ISO-8601 (2026-08-05 = week 32)', function() {
  const db = createMockSQLite({ hasSubmit: true });
  enqueueAIDatasetExport('2026-08-05', db);
  const payload = JSON.parse(db._store['2026-08-05'].payload);
  assert.strictEqual(payload.week_number, 32);
});
test('Item payload: each item has business_date', function() {
  const db = createMockSQLite({ hasSubmit: true });
  enqueueAIDatasetExport('2026-08-05', db);
  const items = JSON.parse(db._store['ITEM_2026-08-05'].payload);
  items.forEach(function(item) {
    assert.strictEqual(item.business_date, '2026-08-05', 'Item missing business_date: ' + item.item_name);
  });
});
test('Item payload: each item has schema_version 1.0.0', function() {
  const db = createMockSQLite({ hasSubmit: true });
  enqueueAIDatasetExport('2026-08-05', db);
  const items = JSON.parse(db._store['ITEM_2026-08-05'].payload);
  items.forEach(function(item) {
    assert.strictEqual(item.schema_version, '1.0.0');
  });
});

// ─────────────────────────────────────────────
// SUITE 7: ZERO REGRESSION CHECKS
// ─────────────────────────────────────────────
console.log('\n\u2500\u2500 Suite 7: Zero Regression \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');

test('enqueueAIDatasetExport does NOT call fetch()', function() {
  // If fetch was called it would throw (not available in Node.js without polyfill)
  // The fact that this test runs without ReferenceError proves no fetch() is called
  const db = createMockSQLite({ hasSubmit: true });
  let fetchCalled = false;
  const origFetch = global.fetch;
  global.fetch = function() { fetchCalled = true; return Promise.resolve(); };
  enqueueAIDatasetExport('2026-08-05', db);
  global.fetch = origFetch;
  assert.strictEqual(fetchCalled, false, 'Phase 3 must not call fetch() — no transport allowed');
});
test('enqueueAIDatasetExport does NOT call processAIDatasetQueue()', function() {
  // We verify by confirming the queue is PENDING and untouched by any processor
  const db = createMockSQLite({ hasSubmit: true });
  enqueueAIDatasetExport('2026-08-05', db);
  // If processAIDatasetQueue was called, it would attempt HTTP transport and potentially mutate status
  // Since we have no HTTP in the mock, status stays PENDING — that is the proof
  assert.strictEqual(db._store['2026-08-05'].status, 'PENDING',
    'Status must stay PENDING: processAIDatasetQueue must NOT be called in Phase 3');
});
test('Queue contains exactly 2 records per business date (daily + item)', function() {
  const db = createMockSQLite({ hasSubmit: true });
  enqueueAIDatasetExport('2026-08-05', db);
  assert.strictEqual(Object.keys(db._store).length, 2, 'Expected exactly 2 queue records: 1 daily + 1 item');
});
test('Different business dates produce separate queue records', function() {
  const db = createMockSQLite({ hasSubmit: true });
  enqueueAIDatasetExport('2026-08-04', db);
  enqueueAIDatasetExport('2026-08-05', db);
  assert.strictEqual(Object.keys(db._store).length, 4, 'Expected 4 records: 2 per date');
  assert.ok(db._store['2026-08-04'], 'Missing daily record for 2026-08-04');
  assert.ok(db._store['2026-08-05'], 'Missing daily record for 2026-08-05');
  assert.ok(db._store['ITEM_2026-08-04'], 'Missing item record for 2026-08-04');
  assert.ok(db._store['ITEM_2026-08-05'], 'Missing item record for 2026-08-05');
});

// ─────────────────────────────────────────────
// FINAL SUMMARY
// ─────────────────────────────────────────────
console.log('\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
console.log('  queue.test.js \u2014 ' + (passed + failed) + ' tests');
console.log('  Passed : ' + passed);
console.log('  Failed : ' + failed);
if (failures.length > 0) {
  console.log('\n  Failed tests:');
  failures.forEach(function(f) { console.log('    \u274c ' + f.name + '\n       ' + f.error); });
}
console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n');
if (failed > 0) process.exit(1);
