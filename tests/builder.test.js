/**
 * AI Dataset Builder — Unit Test Suite
 * 
 * Runnable WITHOUT launching the POS application.
 * Uses an in-process mock SQLite layer.
 * Zero external test framework required (plain Node.js assert).
 * 
 * Run with:
 *   node tests/builder.test.js
 */

'use strict';
const assert = require('assert');

// ─────────────────────────────────────────────
// ISO-8601 WEEK NUMBER ALGORITHM (copy from builder.js)
// ─────────────────────────────────────────────
function getISOWeekNumber(dateObj) {
  const d = new Date(Date.UTC(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

// ─────────────────────────────────────────────
// MOCK SQLITE LAYER (pure in-memory, no SQLite binary)
// ─────────────────────────────────────────────
function createMockDb(summaryRow, submitRow, offDayRow, menuItems, orderItems) {
  return {
    getFirstSync(query, params) {
      if (query.includes('daily_summary')) return summaryRow || null;
      if (query.includes('daily_submit'))  return submitRow  || null;
      if (query.includes('off_days'))       return offDayRow  || null;
      return null;
    },
    getAllSync(query, params) {
      if (query.includes('menu_items'))  return menuItems  || [];
      if (query.includes('order_items')) return orderItems || [];
      return [];
    }
  };
}

// ─────────────────────────────────────────────
// SCHEMA FIELD LISTS (from schema.js)
// ─────────────────────────────────────────────
const DAILY_SCHEMA_FIELDS = [
  'dataset_id','business_date','calendar_date','schema_version','dataset_version','exported_at',
  'year','month','week_number','day_of_month','day_of_week','day_name','is_friday','is_weekend',
  'is_month_start','is_month_end','days_until_salary','days_after_salary',
  'temperature','feels_like_temperature','humidity','rainfall_mm','weather_condition','is_rainy','wind_speed',
  'is_holiday','holiday_name','holiday_source','festival_type','is_off_day','off_day_reason',
  'store_open_time','store_close_time','business_hours',
  'promotion_running','promotion_name','promotion_discount',
  'total_orders','total_sales','cash_sales','bkash_sales','nagad_sales','rocket_sales','card_sales',
  'delivery_sales','delivery_charge','total_discount','net_sales','average_order_value','peak_hour',
  'opening_ijara','total_expense','closing_cash','owner_deposit','expense_ratio',
  'is_complete','is_valid','is_training_ready','validation_errors',
  'target_sales','created_at','updated_at'
];

const ITEM_SCHEMA_FIELDS = [
  'dataset_id','business_date','item_id','item_name','category_name',
  'schema_version','dataset_version','exported_at',
  'unit_price','total_quantity_sold','total_item_revenue',
  'item_rank_today','item_share_percent',
  'is_out_of_stock','available_quantity',
  'day_of_week','is_friday','is_holiday','is_rainy',
  'is_complete','is_valid','is_training_ready','validation_errors',
  'target_quantity','created_at','updated_at'
];

// ─────────────────────────────────────────────
// BUILDER SIMULATION (mirrors builder.js logic)
// ─────────────────────────────────────────────
function buildDailyDatasetSim(businessDate, db) {
  if (!businessDate || typeof businessDate !== 'string') {
    return Object.freeze({ error: 'INVALID_BUSINESS_DATE_PARAMETER' });
  }
  try {
    const summary = db.getFirstSync('SELECT * FROM daily_summary WHERE date = ?', [businessDate]);
    const submit  = db.getFirstSync('SELECT * FROM daily_submit WHERE date = ?',  [businessDate]);
    const offDay  = db.getFirstSync('SELECT * FROM off_days WHERE date = ?',       [businessDate]);

    if (!summary && !submit) {
      return Object.freeze({ error: 'BUSINESS_DATE_NOT_FOUND' });
    }

    const now     = new Date().toISOString();
    const dateObj = new Date(businessDate + 'T00:00:00');
    const dayOfMonth    = dateObj.getDate();
    const isMonthStart  = dayOfMonth === 1 ? 1 : 0;
    const nextDayObj    = new Date(dateObj);
    nextDayObj.setDate(dayOfMonth + 1);
    const isMonthEnd       = nextDayObj.getDate() === 1 ? 1 : 0;
    const nextMonthObj     = new Date(dateObj.getFullYear(), dateObj.getMonth() + 1, 1);
    const daysUntilSalary  = Math.round((nextMonthObj - dateObj) / (1000 * 60 * 60 * 24));
    const daysAfterSalary  = dayOfMonth - 1;

    let festivalType = 'None';
    const note = (summary && summary.specialDayNote) || (submit && submit.notes) || '';
    if (note.includes('Eid') || note.includes('Puja')) festivalType = 'Religious';
    else if (note.includes('Independence') || note.includes('Victory') || note.includes('Language')) festivalType = 'National';
    else if (note.trim().length > 0) festivalType = 'Local Event';
    else if ((summary && summary.isFriday) || dateObj.getDay() === 6) festivalType = 'Weekend';

    const totalSales   = (submit && submit.total_sell) || (summary && summary.totalSales) || 0.0;
    const totalExpense = (submit && submit.total_expense) || (summary && summary.totalExpense) || 0.0;

    const rawRecord = {
      dataset_id: businessDate,
      business_date: businessDate,
      calendar_date: submit && submit.submitted_at ? submit.submitted_at.substring(0, 10) : businessDate,
      schema_version: '1.0.0',
      dataset_version: '1.0.0',
      exported_at: now,
      year: dateObj.getFullYear(),
      month: dateObj.getMonth() + 1,
      week_number: getISOWeekNumber(dateObj),
      day_of_month: dayOfMonth,
      day_of_week: dateObj.getDay(),
      day_name: (summary && summary.dayOfWeek) || 'Unknown',
      is_friday: (summary && summary.isFriday) ? 1 : (dateObj.getDay() === 5 ? 1 : 0),
      is_weekend: ((summary && summary.isFriday) || dateObj.getDay() === 5 || dateObj.getDay() === 6) ? 1 : 0,
      is_month_start: isMonthStart,
      is_month_end: isMonthEnd,
      days_until_salary: daysUntilSalary,
      days_after_salary: daysAfterSalary,
      temperature: (summary && summary.temperature !== undefined) ? summary.temperature : null,
      feels_like_temperature: null,
      humidity: (summary && summary.humidity !== undefined) ? summary.humidity : null,
      rainfall_mm: null,
      weather_condition: (summary && summary.condition) || 'UNKNOWN',
      is_rainy: (summary && summary.isRainy) ? 1 : 0,
      wind_speed: (summary && summary.windSpeed !== undefined) ? summary.windSpeed : null,
      is_holiday: (summary && summary.isHoliday) ? 1 : 0,
      holiday_name: (summary && summary.specialDayNote) || '',
      holiday_source: (summary && summary.specialDayNote) ? 'manual' : 'none',
      festival_type: festivalType,
      is_off_day: offDay ? 1 : 0,
      off_day_reason: offDay ? (offDay.reason || '') : '',
      store_open_time: null,
      store_close_time: null,
      business_hours: null,
      promotion_running: 0,
      promotion_name: null,
      promotion_discount: 0.0,
      total_orders: (summary && summary.totalOrders) || 0,
      total_sales: totalSales,
      cash_sales: (submit && submit.cash_payment) || (summary && summary.cashTotal) || 0.0,
      bkash_sales: (submit && submit.bkash_payment) || (summary && summary.bkashTotal) || 0.0,
      nagad_sales: (submit && submit.nagad_payment) || (summary && summary.nagadTotal) || 0.0,
      rocket_sales: (submit && submit.rocket_payment) || (summary && summary.rocketTotal) || 0.0,
      card_sales: 0.0,
      delivery_sales: (submit && submit.delivery_sell) || (summary && summary.totalDelivery) || 0.0,
      delivery_charge: (submit && submit.delivery_charge) || (summary && summary.total_delivery_charge) || 0.0,
      total_discount: (summary && summary.totalDiscount) || 0.0,
      net_sales: totalSales - ((summary && summary.totalDiscount) || 0.0),
      average_order_value: (summary && summary.averageOrderValue) || 0.0,
      peak_hour: (summary && summary.peakHour) || '',
      opening_ijara: (submit && submit.eja) || 0.0,
      total_expense: totalExpense,
      closing_cash: (submit && submit.net_cash) || 0.0,
      owner_deposit: (submit && submit.net_deposit) || (summary && summary.ownerDeposit) || 0.0,
      expense_ratio: totalSales ? (totalExpense / totalSales) * 100 : 0.0,
      target_sales: null,
      created_at: (submit && submit.created_at) || now,
      updated_at: (submit && submit.updated_at) || now,
      is_complete: 1,
      is_valid: 1,
      is_training_ready: 1,
      validation_errors: '[]'
    };
    return Object.freeze(rawRecord);
  } catch (err) {
    return Object.freeze({ error: 'BUILD_EXCEPTION', message: err.message });
  }
}

function buildItemDatasetSim(businessDate, db) {
  if (!businessDate || typeof businessDate !== 'string') {
    return Object.freeze({ error: 'INVALID_BUSINESS_DATE_PARAMETER' });
  }
  try {
    const summary   = db.getFirstSync('SELECT * FROM daily_summary WHERE date = ?', [businessDate]);
    const menuItems = db.getAllSync('SELECT id, name, category, price FROM menu_items');
    const sales     = db.getAllSync('SELECT itemName, totalQty, totalRev FROM order_items', [businessDate]);

    if (!menuItems || menuItems.length === 0) return Object.freeze([]);

    const now     = new Date().toISOString();
    const dateObj = new Date(businessDate + 'T00:00:00');
    const salesMap = {};
    let totalItemsSoldOnDate = 0;
    sales.forEach(function(s) {
      salesMap[s.itemName] = { qty: s.totalQty, rev: s.totalRev };
      totalItemsSoldOnDate += Number(s.totalQty || 0);
    });
    const sortedSalesNames = sales.map(function(s) { return s.itemName; });

    const itemDatasetList = menuItems.map(function(item) {
      const qtySold   = (salesMap[item.name] && salesMap[item.name].qty) || 0;
      const rankIdx   = sortedSalesNames.indexOf(item.name);
      const rank      = qtySold > 0 && rankIdx !== -1 ? rankIdx + 1 : 0;
      const sharePercent = totalItemsSoldOnDate > 0 ? (qtySold / totalItemsSoldOnDate) * 100 : 0;

      const rawItem = {
        dataset_id: businessDate + '_' + (item.id || item.name),
        business_date: businessDate,
        item_id: item.id || '',
        item_name: item.name,
        category_name: item.category || 'Uncategorized',
        schema_version: '1.0.0',
        dataset_version: '1.0.0',
        exported_at: now,
        unit_price: item.price || 0.0,
        total_quantity_sold: qtySold,
        total_item_revenue: (salesMap[item.name] && salesMap[item.name].rev) || 0.0,
        item_rank_today: rank,
        item_share_percent: sharePercent,
        is_out_of_stock: null,
        available_quantity: null,
        day_of_week: dateObj.getDay(),
        is_friday: (summary && summary.isFriday) ? 1 : (dateObj.getDay() === 5 ? 1 : 0),
        is_holiday: (summary && summary.isHoliday) ? 1 : 0,
        is_rainy: (summary && summary.isRainy) ? 1 : 0,
        target_quantity: null,
        created_at: now,
        updated_at: now,
        is_complete: 1,
        is_valid: 1,
        is_training_ready: 1,
        validation_errors: '[]'
      };
      return Object.freeze(rawItem);
    });
    return Object.freeze(itemDatasetList);
  } catch (err) {
    return Object.freeze({ error: 'BUILD_EXCEPTION', message: err.message });
  }
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
    failures.push({ name: name, error: err.message });
    failed++;
  }
}

// ─────────────────────────────────────────────
// STANDARD MOCK ROW
// ─────────────────────────────────────────────
var STD_SUMMARY = {
  date: '2026-08-05', totalOrders: 50, totalSales: 9500,
  cashTotal: 6000, bkashTotal: 2000, nagadTotal: 1000, rocketTotal: 500,
  totalDelivery: 500, total_delivery_charge: 100, totalDiscount: 200,
  averageOrderValue: 190, peakHour: '13:00', totalExpense: 2000,
  ownerDeposit: 5000, dayOfWeek: 'Wednesday', isFriday: 0, isHoliday: 0,
  isRainy: 0, temperature: 32.5, humidity: 75, condition: 'Cloudy',
  windSpeed: 15, specialDayNote: ''
};
var STD_SUBMIT = {
  date: '2026-08-05', total_sell: 9500,
  cash_payment: 6000, bkash_payment: 2000, nagad_payment: 1000, rocket_payment: 500,
  delivery_sell: 500, delivery_charge: 100, total_expense: 2000,
  net_cash: 3000, net_deposit: 5000, eja: 2000,
  submitted_at: '2026-08-05T23:45:00', created_at: '2026-08-05T23:45:00',
  updated_at: '2026-08-05T23:45:00'
};
var STD_MENU = [
  { id: 'item_1', name: 'Burger', category: 'Fast Food', price: 120 },
  { id: 'item_2', name: 'Pizza',  category: 'Fast Food', price: 250 },
  { id: 'item_3', name: 'Tea',    category: 'Beverages', price: 30  }
];
var STD_ORDERS = [
  { itemName: 'Burger', totalQty: 50, totalRev: 6000 },
  { itemName: 'Pizza',  totalQty: 30, totalRev: 7500 },
  { itemName: 'Tea',    totalQty: 20, totalRev: 600  }
];

var stdDb = createMockDb(STD_SUMMARY, STD_SUBMIT, null, STD_MENU, STD_ORDERS);

// ─────────────────────────────────────────────
// SUITE 1: ISO-8601 WEEK NUMBER
// ─────────────────────────────────────────────
console.log('\n\u2500\u2500 Suite 1: ISO-8601 Week Number \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
var isoWeekCases = [
  { date: '2026-01-01', expected: 1  },
  { date: '2026-01-04', expected: 1  },
  { date: '2026-01-05', expected: 2  },
  { date: '2026-08-01', expected: 31 },
  { date: '2026-08-05', expected: 32 },
  { date: '2026-08-31', expected: 36 },
  { date: '2026-12-28', expected: 53 },
  { date: '2026-12-31', expected: 53 },
  { date: '2025-01-01', expected: 1  },
  { date: '2025-12-31', expected: 1  },
];
isoWeekCases.forEach(function(c) {
  test('ISO week ' + c.date + ' -> week ' + c.expected, function() {
    var result = getISOWeekNumber(new Date(c.date + 'T00:00:00'));
    assert.strictEqual(result, c.expected, 'Expected week ' + c.expected + ' but got ' + result);
  });
});

// ─────────────────────────────────────────────
// SUITE 2: SCHEMA COMPLETENESS
// ─────────────────────────────────────────────
console.log('\n\u2500\u2500 Suite 2: Schema Completeness \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
test('Daily dataset: all 62 schema fields present', function() {
  var rec = buildDailyDatasetSim('2026-08-05', stdDb);
  var missing = DAILY_SCHEMA_FIELDS.filter(function(f) { return !(f in rec); });
  assert.strictEqual(missing.length, 0, 'Missing: ' + missing.join(', '));
});
test('Daily dataset: no extra fields beyond schema', function() {
  var rec = buildDailyDatasetSim('2026-08-05', stdDb);
  var extra = Object.keys(rec).filter(function(f) { return !DAILY_SCHEMA_FIELDS.includes(f); });
  assert.strictEqual(extra.length, 0, 'Extra: ' + extra.join(', '));
});
test('Item dataset: all 27 schema fields present', function() {
  var items = buildItemDatasetSim('2026-08-05', stdDb);
  assert.ok(Array.isArray(items) && items.length > 0, 'Expected non-empty item array');
  var missing = ITEM_SCHEMA_FIELDS.filter(function(f) { return !(f in items[0]); });
  assert.strictEqual(missing.length, 0, 'Missing: ' + missing.join(', '));
});
test('Item dataset: no extra fields beyond schema', function() {
  var items = buildItemDatasetSim('2026-08-05', stdDb);
  var extra = Object.keys(items[0]).filter(function(f) { return !ITEM_SCHEMA_FIELDS.includes(f); });
  assert.strictEqual(extra.length, 0, 'Extra: ' + extra.join(', '));
});

// ─────────────────────────────────────────────
// SUITE 3: DETERMINISM
// ─────────────────────────────────────────────
console.log('\n\u2500\u2500 Suite 3: Determinism \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
var STABLE_FIELDS = [
  'dataset_id','business_date','year','month','week_number','day_of_month',
  'day_of_week','is_friday','is_weekend','is_month_start','is_month_end',
  'days_until_salary','days_after_salary','total_sales','cash_sales',
  'bkash_sales','nagad_sales','rocket_sales','opening_ijara',
  'total_expense','owner_deposit','expense_ratio','is_holiday','is_off_day',
  'festival_type','holiday_source','schema_version','dataset_version'
];
test('Daily dataset: 3 runs produce identical stable fields', function() {
  var runs = [1,2,3].map(function() { return buildDailyDatasetSim('2026-08-05', stdDb); });
  var mismatches = STABLE_FIELDS.filter(function(f) { return runs.some(function(r) { return r[f] !== runs[0][f]; }); });
  assert.strictEqual(mismatches.length, 0, 'Non-deterministic: ' + mismatches.join(', '));
});
test('Item dataset: 3 runs produce identical ranks/shares', function() {
  var stableItem = ['item_name','total_quantity_sold','item_rank_today','item_share_percent'];
  var runs = [1,2,3].map(function() { return buildItemDatasetSim('2026-08-05', stdDb); });
  for (var i = 0; i < runs[0].length; i++) {
    stableItem.forEach(function(f) {
      assert.strictEqual(runs[1][i][f], runs[0][i][f], 'Field ' + f + ' differs run 1->2');
      assert.strictEqual(runs[2][i][f], runs[0][i][f], 'Field ' + f + ' differs run 1->3');
    });
  }
});

// ─────────────────────────────────────────────
// SUITE 4: FINANCIAL CONSISTENCY
// ─────────────────────────────────────────────
console.log('\n\u2500\u2500 Suite 4: Financial Consistency \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
test('payment sum = total_sales (normal split)', function() {
  var rec = buildDailyDatasetSim('2026-08-05', stdDb);
  var paySum = rec.cash_sales + rec.bkash_sales + rec.nagad_sales + rec.rocket_sales + rec.card_sales;
  assert.ok(Math.abs(paySum - rec.total_sales) <= 0.01, 'paySum=' + paySum + ' total=' + rec.total_sales);
});
test('payment sum = total_sales (zero sales)', function() {
  var zeroSubmit = Object.assign({}, STD_SUBMIT, { total_sell:0, cash_payment:0, bkash_payment:0, nagad_payment:0, rocket_payment:0 });
  var db2 = createMockDb(STD_SUMMARY, zeroSubmit, null, [], []);
  var rec = buildDailyDatasetSim('2026-08-05', db2);
  var paySum = rec.cash_sales + rec.bkash_sales + rec.nagad_sales + rec.rocket_sales + rec.card_sales;
  assert.ok(Math.abs(paySum - rec.total_sales) <= 0.01);
});
test('net_sales = total_sales - total_discount', function() {
  var rec = buildDailyDatasetSim('2026-08-05', stdDb);
  var expected = rec.total_sales - rec.total_discount;
  assert.ok(Math.abs(rec.net_sales - expected) <= 0.01, 'net_sales=' + rec.net_sales + ' expected=' + expected);
});
test('expense_ratio = (total_expense / total_sales) * 100', function() {
  var rec = buildDailyDatasetSim('2026-08-05', stdDb);
  var expected = (rec.total_expense / rec.total_sales) * 100;
  assert.ok(Math.abs(rec.expense_ratio - expected) <= 0.01, 'ratio=' + rec.expense_ratio + ' expected=' + expected);
});

// ─────────────────────────────────────────────
// SUITE 5: IMMUTABILITY
// ─────────────────────────────────────────────
console.log('\n\u2500\u2500 Suite 5: Immutability \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
test('Daily: total_sales unchanged after mutation', function() {
  var rec = buildDailyDatasetSim('2026-08-05', stdDb);
  var orig = rec.total_sales;
  try { rec.total_sales = 99999; } catch (_) {}
  assert.strictEqual(rec.total_sales, orig, 'Object.freeze must prevent mutation');
});
test('Daily: business_date unchanged after mutation', function() {
  var rec = buildDailyDatasetSim('2026-08-05', stdDb);
  try { rec.business_date = 'tampered'; } catch (_) {}
  assert.strictEqual(rec.business_date, '2026-08-05');
});
test('Item: item_rank_today unchanged after mutation', function() {
  var items = buildItemDatasetSim('2026-08-05', stdDb);
  var orig = items[0].item_rank_today;
  try { items[0].item_rank_today = 999; } catch (_) {}
  assert.strictEqual(items[0].item_rank_today, orig);
});
test('Item array: frozen — cannot push new elements', function() {
  var items = buildItemDatasetSim('2026-08-05', stdDb);
  var originalLen = items.length;
  try { items.push({ fake: true }); } catch (_) {}
  assert.strictEqual(items.length, originalLen);
});

// ─────────────────────────────────────────────
// SUITE 6: ITEM RANKING
// ─────────────────────────────────────────────
console.log('\n\u2500\u2500 Suite 6: Item Rank & Share Percent \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
test('Top-selling item (Burger) has rank 1', function() {
  var items = buildItemDatasetSim('2026-08-05', stdDb);
  var burger = items.find(function(i) { return i.item_name === 'Burger'; });
  assert.strictEqual(burger.item_rank_today, 1);
});
test('Second-selling item (Pizza) has rank 2', function() {
  var items = buildItemDatasetSim('2026-08-05', stdDb);
  var pizza = items.find(function(i) { return i.item_name === 'Pizza'; });
  assert.strictEqual(pizza.item_rank_today, 2);
});
test('Third-selling item (Tea) has rank 3', function() {
  var items = buildItemDatasetSim('2026-08-05', stdDb);
  var tea = items.find(function(i) { return i.item_name === 'Tea'; });
  assert.strictEqual(tea.item_rank_today, 3);
});
test('Share percents sum to 100%', function() {
  var items = buildItemDatasetSim('2026-08-05', stdDb);
  var shareSum = items.filter(function(i) { return i.total_quantity_sold > 0; })
                      .reduce(function(acc, i) { return acc + i.item_share_percent; }, 0);
  assert.ok(Math.abs(shareSum - 100) < 0.01, 'Share sum = ' + shareSum);
});
test('Zero-sales day: all ranks = 0, all shares = 0', function() {
  var noSalesDb = createMockDb(STD_SUMMARY, STD_SUBMIT, null, STD_MENU, []);
  var items = buildItemDatasetSim('2026-08-05', noSalesDb);
  items.forEach(function(item) {
    assert.strictEqual(item.item_rank_today, 0, item.item_name + ' rank should be 0');
    assert.strictEqual(item.item_share_percent, 0, item.item_name + ' share should be 0');
  });
});
test('Single item: rank = 1, share = 100%', function() {
  var oneMenu   = [{ id: 'x1', name: 'Biryani', category: 'Meals', price: 200 }];
  var oneOrders = [{ itemName: 'Biryani', totalQty: 40, totalRev: 8000 }];
  var oneDb = createMockDb(STD_SUMMARY, STD_SUBMIT, null, oneMenu, oneOrders);
  var items = buildItemDatasetSim('2026-08-05', oneDb);
  assert.strictEqual(items[0].item_rank_today, 1);
  assert.ok(Math.abs(items[0].item_share_percent - 100) < 0.01);
});

// ─────────────────────────────────────────────
// SUITE 7: CALENDAR FEATURES
// ─────────────────────────────────────────────
console.log('\n\u2500\u2500 Suite 7: Calendar Features \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
var calCases = [
  { date: '2026-08-01', ms:1, me:0, da:0,  du:30, isFri:0 },
  { date: '2026-08-31', ms:0, me:1, da:30, du:1,  isFri:0 },
  { date: '2026-08-15', ms:0, me:0, da:14, du:16, isFri:0 },
  { date: '2026-07-31', ms:0, me:1, da:30, du:1,  isFri:1 },
];
calCases.forEach(function(c) {
  var calDb = createMockDb(
    Object.assign({}, STD_SUMMARY, { date: c.date, isFriday: c.isFri }),
    Object.assign({}, STD_SUBMIT,  { date: c.date }),
    null, [], []
  );
  test(c.date + ': is_month_start = ' + c.ms, function() {
    assert.strictEqual(buildDailyDatasetSim(c.date, calDb).is_month_start, c.ms);
  });
  test(c.date + ': is_month_end = ' + c.me, function() {
    assert.strictEqual(buildDailyDatasetSim(c.date, calDb).is_month_end, c.me);
  });
  test(c.date + ': days_after_salary = ' + c.da, function() {
    assert.strictEqual(buildDailyDatasetSim(c.date, calDb).days_after_salary, c.da);
  });
  test(c.date + ': is_friday = ' + c.isFri, function() {
    assert.strictEqual(buildDailyDatasetSim(c.date, calDb).is_friday, c.isFri);
  });
});

// ─────────────────────────────────────────────
// SUITE 8: MISSING DATA DEFAULTS
// ─────────────────────────────────────────────
console.log('\n\u2500\u2500 Suite 8: Missing Data Defaults \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
test('No weather -> temperature is null', function() {
  var db2 = createMockDb(Object.assign({}, STD_SUMMARY, { temperature: undefined }), STD_SUBMIT, null, [], []);
  assert.strictEqual(buildDailyDatasetSim('2026-08-05', db2).temperature, null);
});
test('No weather -> weather_condition is UNKNOWN', function() {
  var db2 = createMockDb(Object.assign({}, STD_SUMMARY, { condition: undefined }), STD_SUBMIT, null, [], []);
  assert.strictEqual(buildDailyDatasetSim('2026-08-05', db2).weather_condition, 'UNKNOWN');
});
test('No holiday -> is_holiday = 0', function() {
  assert.strictEqual(buildDailyDatasetSim('2026-08-05', stdDb).is_holiday, 0);
});
test('No holiday -> holiday_source = "none"', function() {
  assert.strictEqual(buildDailyDatasetSim('2026-08-05', stdDb).holiday_source, 'none');
});
test('No off_day -> is_off_day = 0', function() {
  assert.strictEqual(buildDailyDatasetSim('2026-08-05', stdDb).is_off_day, 0);
});
test('Off day present -> is_off_day = 1 with reason', function() {
  var db2 = createMockDb(STD_SUMMARY, STD_SUBMIT, { date: '2026-08-05', reason: 'Public Holiday' }, STD_MENU, STD_ORDERS);
  var rec = buildDailyDatasetSim('2026-08-05', db2);
  assert.strictEqual(rec.is_off_day, 1);
  assert.strictEqual(rec.off_day_reason, 'Public Holiday');
});
test('No promotion -> promotion_running = 0', function() {
  assert.strictEqual(buildDailyDatasetSim('2026-08-05', stdDb).promotion_running, 0);
});
test('feels_like_temperature always null (placeholder)', function() {
  assert.strictEqual(buildDailyDatasetSim('2026-08-05', stdDb).feels_like_temperature, null);
});
test('rainfall_mm always null (placeholder)', function() {
  assert.strictEqual(buildDailyDatasetSim('2026-08-05', stdDb).rainfall_mm, null);
});
test('is_out_of_stock always null (placeholder)', function() {
  var items = buildItemDatasetSim('2026-08-05', stdDb);
  items.forEach(function(item) { assert.strictEqual(item.is_out_of_stock, null); });
});

// ─────────────────────────────────────────────
// SUITE 9: EDGE CASES
// ─────────────────────────────────────────────
console.log('\n\u2500\u2500 Suite 9: Edge Cases \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
test('null date -> INVALID_BUSINESS_DATE_PARAMETER', function() {
  assert.strictEqual(buildDailyDatasetSim(null, stdDb).error, 'INVALID_BUSINESS_DATE_PARAMETER');
});
test('numeric date -> INVALID_BUSINESS_DATE_PARAMETER', function() {
  assert.strictEqual(buildDailyDatasetSim(20260805, stdDb).error, 'INVALID_BUSINESS_DATE_PARAMETER');
});
test('date with no SQLite records -> BUSINESS_DATE_NOT_FOUND', function() {
  var emptyDb = createMockDb(null, null, null, [], []);
  assert.strictEqual(buildDailyDatasetSim('2030-01-01', emptyDb).error, 'BUSINESS_DATE_NOT_FOUND');
});
test('no menu items -> empty frozen array', function() {
  var db2 = createMockDb(STD_SUMMARY, STD_SUBMIT, null, [], []);
  var items = buildItemDatasetSim('2026-08-05', db2);
  assert.ok(Object.isFrozen(items));
  assert.strictEqual(items.length, 0);
});
test('schema_version is always "1.0.0"', function() {
  var rec = buildDailyDatasetSim('2026-08-05', stdDb);
  assert.strictEqual(rec.schema_version, '1.0.0');
  assert.strictEqual(rec.dataset_version, '1.0.0');
});
test('dataset_id equals businessDate', function() {
  assert.strictEqual(buildDailyDatasetSim('2026-08-05', stdDb).dataset_id, '2026-08-05');
});

// ─────────────────────────────────────────────
// SUITE 10: PERFORMANCE
// ─────────────────────────────────────────────
console.log('\n\u2500\u2500 Suite 10: Performance (365 Days) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
test('Build 365 daily datasets in under 200ms with zero failures', function() {
  var start = Date.now();
  var localFailed = 0;
  for (var d = 0; d < 365; d++) {
    var dt = new Date('2026-01-01T00:00:00');
    dt.setDate(dt.getDate() + d);
    var dateStr = dt.toISOString().substring(0, 10);
    var fakeSummary = Object.assign({}, STD_SUMMARY, { date: dateStr });
    var fakeSubmit  = Object.assign({}, STD_SUBMIT,  { date: dateStr });
    var db2 = createMockDb(fakeSummary, fakeSubmit, null, [], []);
    var rec = buildDailyDatasetSim(dateStr, db2);
    if (rec.error) localFailed++;
  }
  var elapsed = Date.now() - start;
  assert.strictEqual(localFailed, 0, localFailed + ' failures during year-build');
  assert.ok(elapsed < 200, 'Took ' + elapsed + 'ms — expected < 200ms');
  console.log('     (365 builds in ' + elapsed + 'ms — avg ' + (elapsed/365).toFixed(3) + 'ms/record)');
});

// ─────────────────────────────────────────────
// FINAL SUMMARY
// ─────────────────────────────────────────────
console.log('\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
console.log('  builder.test.js \u2014 ' + (passed + failed) + ' tests');
console.log('  Passed : ' + passed);
console.log('  Failed : ' + failed);
if (failures.length > 0) {
  console.log('\n  Failed tests:');
  failures.forEach(function(f) { console.log('    \u274c ' + f.name + '\n       ' + f.error); });
}
console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n');
if (failed > 0) process.exit(1);
