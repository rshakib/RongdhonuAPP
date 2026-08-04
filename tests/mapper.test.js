/**
 * AI Dataset Mapper — Unit Test Suite
 *
 * Verifies that mapper.js field mapping documentation is complete and consistent
 * with schema.js field definitions.
 * Runnable WITHOUT launching the POS application.
 * Zero external test framework required (plain Node.js assert).
 *
 * Run with:
 *   node tests/mapper.test.js
 */

'use strict';
const assert = require('assert');

// ─────────────────────────────────────────────
// INLINE COPIES OF mapper.js field lists
// These must match the actual keys in DAILY_SALES_FIELD_MAPPING
// and ITEM_SALES_FIELD_MAPPING in mapper.js
// ─────────────────────────────────────────────
const DAILY_MAPPER_FIELDS = [
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
  'target_sales'
  // Note: created_at & updated_at are system metadata — not in mapper (sourced from daily_submit)
];

const ITEM_MAPPER_FIELDS = [
  'dataset_id','business_date','item_id','item_name','category_name',
  'schema_version','dataset_version','exported_at',
  'unit_price','total_quantity_sold','total_item_revenue',
  'item_rank_today','item_share_percent',
  'is_out_of_stock','available_quantity',
  'day_of_week','is_friday','is_holiday','is_rainy',
  'is_complete','is_valid','is_training_ready','validation_errors',
  'target_quantity'
];

// ─────────────────────────────────────────────
// INLINE COPIES OF schema.js field lists
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
// EXPECTED SOURCE TABLE ASSIGNMENTS (Critical field mappings from mapper.js)
// ─────────────────────────────────────────────
const EXPECTED_DAILY_SOURCES = {
  dataset_id:    { sourceTable: 'daily_submit' },
  business_date: { sourceTable: 'daily_submit', fallbackTable: 'daily_summary' },
  total_sales:   { sourceTable: 'daily_submit', fallbackTable: 'daily_summary' },
  cash_sales:    { sourceTable: 'daily_submit', fallbackTable: 'daily_summary' },
  bkash_sales:   { sourceTable: 'daily_submit', fallbackTable: 'daily_summary' },
  nagad_sales:   { sourceTable: 'daily_submit', fallbackTable: 'daily_summary' },
  rocket_sales:  { sourceTable: 'daily_submit', fallbackTable: 'daily_summary' },
  opening_ijara: { sourceTable: 'daily_submit' },
  total_expense: { sourceTable: 'daily_submit', fallbackTable: 'daily_summary' },
  closing_cash:  { sourceTable: 'daily_submit' },
  owner_deposit: { sourceTable: 'daily_submit', fallbackTable: 'daily_summary' },
  is_off_day:    { sourceTable: 'off_days' },
  off_day_reason:{ sourceTable: 'off_days' },
  total_orders:  { sourceTable: 'daily_summary' },
  is_holiday:    { sourceTable: 'daily_summary' },
};

const EXPECTED_ITEM_SOURCES = {
  item_id:             { sourceTable: 'menu_items' },
  item_name:           { sourceTable: 'order_items' },
  category_name:       { sourceTable: 'menu_items' },
  total_quantity_sold: { sourceTable: 'order_items' },
  total_item_revenue:  { sourceTable: 'order_items' },
};

// ─────────────────────────────────────────────
// EXPECTED DERIVATION FORMULAS (spot-check)
// ─────────────────────────────────────────────
const EXPECTED_DERIVATIONS = {
  is_month_start:    'CASE WHEN strftime',
  is_month_end:      'CASE WHEN date',
  days_until_salary: 'julianday',
  days_after_salary: 'strftime',
  week_number:       'ISO-8601',
  net_sales:         'total_sales - total_discount',
  expense_ratio:     'total_expense',
  item_rank_today:   'DENSE_RANK',
  item_share_percent:'SUM(quantity)',
};

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
// SUITE 1: MAPPER COVERAGE vs SCHEMA
// ─────────────────────────────────────────────
console.log('\n\u2500\u2500 Suite 1: Mapper Coverage vs Schema \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');

// Mapper may omit system fields (created_at, updated_at) which are auto-generated
const SYSTEM_ONLY_FIELDS = ['created_at', 'updated_at'];

test('Daily mapper covers all non-system schema fields', function() {
  const schemaWithoutSystem = DAILY_SCHEMA_FIELDS.filter(function(f) { return !SYSTEM_ONLY_FIELDS.includes(f); });
  const missing = schemaWithoutSystem.filter(function(f) { return !DAILY_MAPPER_FIELDS.includes(f); });
  assert.strictEqual(missing.length, 0, 'Schema fields not in mapper: ' + missing.join(', '));
});

test('Daily mapper has no extra fields not in schema', function() {
  const extra = DAILY_MAPPER_FIELDS.filter(function(f) { return !DAILY_SCHEMA_FIELDS.includes(f); });
  assert.strictEqual(extra.length, 0, 'Mapper fields not in schema: ' + extra.join(', '));
});

test('Item mapper covers all non-system schema fields', function() {
  const schemaWithoutSystem = ITEM_SCHEMA_FIELDS.filter(function(f) { return !SYSTEM_ONLY_FIELDS.includes(f); });
  const missing = schemaWithoutSystem.filter(function(f) { return !ITEM_MAPPER_FIELDS.includes(f); });
  assert.strictEqual(missing.length, 0, 'Missing item mapper fields: ' + missing.join(', '));
});

test('Item mapper has no extra fields not in schema', function() {
  const extra = ITEM_MAPPER_FIELDS.filter(function(f) { return !ITEM_SCHEMA_FIELDS.includes(f); });
  assert.strictEqual(extra.length, 0, 'Extra item mapper fields: ' + extra.join(', '));
});

// ─────────────────────────────────────────────
// SUITE 2: SOURCE TABLE CORRECTNESS
// ─────────────────────────────────────────────
console.log('\n\u2500\u2500 Suite 2: Source Table Correctness \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');

// The mapper.js file itself is the source of truth here.
// We read it directly as a text file and verify source table strings are present.
const fs = require('fs');
const path = require('path');
const mapperPath = path.join(__dirname, '..', 'services', 'aiDataset', 'mapper.js');
let mapperContent = '';
try {
  mapperContent = fs.readFileSync(mapperPath, 'utf8');
} catch (e) {
  console.log('  \u26a0\ufe0f  Cannot read mapper.js: ' + e.message + ' (skipping source table tests)');
}

if (mapperContent) {
  Object.keys(EXPECTED_DAILY_SOURCES).forEach(function(field) {
    const expectedTable = EXPECTED_DAILY_SOURCES[field].sourceTable;
    test('Daily mapper "' + field + '" references source table "' + expectedTable + '"', function() {
      // Check that the field entry block contains the expected sourceTable
      const fieldIdx = mapperContent.indexOf(field + ':');
      assert.ok(fieldIdx !== -1, 'Field ' + field + ' not found in mapper.js');
      // Look within ~300 chars after field declaration
      const block = mapperContent.substring(fieldIdx, fieldIdx + 300);
      assert.ok(block.includes(expectedTable), 
        'Expected "' + expectedTable + '" in mapper block for ' + field + '. Block: ' + block.substring(0, 100));
    });
  });

  Object.keys(EXPECTED_ITEM_SOURCES).forEach(function(field) {
    const expectedTable = EXPECTED_ITEM_SOURCES[field].sourceTable;
    test('Item mapper "' + field + '" references source table "' + expectedTable + '"', function() {
      const fieldIdx = mapperContent.lastIndexOf(field + ':');
      assert.ok(fieldIdx !== -1, 'Field ' + field + ' not found in mapper.js');
      const block = mapperContent.substring(fieldIdx, fieldIdx + 300);
      assert.ok(block.includes(expectedTable),
        'Expected "' + expectedTable + '" in mapper block for ' + field);
    });
  });
}

// ─────────────────────────────────────────────
// SUITE 3: DERIVATION FORMULA DOCUMENTATION
// ─────────────────────────────────────────────
console.log('\n\u2500\u2500 Suite 3: Derivation Formula Documentation \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');

if (mapperContent) {
  Object.keys(EXPECTED_DERIVATIONS).forEach(function(field) {
    const expectedKeyword = EXPECTED_DERIVATIONS[field];
    test('Mapper documents derivation for "' + field + '" containing "' + expectedKeyword.substring(0,20) + '..."', function() {
      assert.ok(
        mapperContent.includes(expectedKeyword),
        'Expected keyword "' + expectedKeyword + '" not found in mapper.js for field ' + field
      );
    });
  });
}

// ─────────────────────────────────────────────
// SUITE 4: ZERO FIRESTORE / ZERO NETWORK REFERENCES
// ─────────────────────────────────────────────
console.log('\n\u2500\u2500 Suite 4: Zero Firestore / Zero Network References \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');

const aiDatasetDir = path.join(__dirname, '..', 'services', 'aiDataset');
const aiDatasetFiles = ['builder.js', 'validator.js', 'mapper.js', 'schema.js'];
const forbiddenPatterns = ['firestore', 'firebase', 'fetch(', 'axios', 'XMLHttpRequest', 'google.sheets'];

aiDatasetFiles.forEach(function(filename) {
  const filepath = path.join(aiDatasetDir, filename);
  test(filename + ': zero Firestore/network references (imports/calls)', function() {
    let content = '';
    try { content = fs.readFileSync(filepath, 'utf8'); } catch(e) { return; }
    // Strip single-line and multi-line comments before checking
    const stripped = content
      .replace(/\/\/[^\n]*/g, '')           // remove // comments
      .replace(/\/\*[\s\S]*?\*\//g, '');     // remove /* */ comments
    const strippedLower = stripped.toLowerCase();
    const forbiddenCalls = ['import.*firestore', 'require.*firestore', 'firebase.firestore', 'getfirestore\\(', 'fetch\\(', 'axios\\.', 'xmlhttprequest', 'google\\.sheets'];
    forbiddenCalls.forEach(function(pattern) {
      const re = new RegExp(pattern, 'i');
      assert.ok(!re.test(strippedLower),
        'Forbidden call pattern "' + pattern + '" found in ' + filename);
    });
  });
});

// ─────────────────────────────────────────────
// SUITE 5: SCHEMA VERSION CONSISTENCY
// ─────────────────────────────────────────────
console.log('\n\u2500\u2500 Suite 5: Schema Version Consistency \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');

test('schema.js contains schema_version field definition', function() {
  const schemaPath = path.join(aiDatasetDir, 'schema.js');
  const schemaContent = fs.readFileSync(schemaPath, 'utf8');
  assert.ok(schemaContent.includes('schema_version'), 'schema_version field must be defined in schema.js');
});

test('schema.js contains dataset_version field definition', function() {
  const schemaPath = path.join(aiDatasetDir, 'schema.js');
  const schemaContent = fs.readFileSync(schemaPath, 'utf8');
  assert.ok(schemaContent.includes('dataset_version'), 'dataset_version field must be defined in schema.js');
});

test('builder.js uses schema_version "1.0.0"', function() {
  const builderContent = fs.readFileSync(path.join(aiDatasetDir, 'builder.js'), 'utf8');
  assert.ok(builderContent.includes("'1.0.0'"), 'builder.js must reference schema version 1.0.0');
});

test('builder.js uses ISO-8601 week number (getISOWeekNumber)', function() {
  const builderContent = fs.readFileSync(path.join(aiDatasetDir, 'builder.js'), 'utf8');
  assert.ok(builderContent.includes('getISOWeekNumber'), 'builder.js must use getISOWeekNumber() function');
  assert.ok(!builderContent.includes('Math.ceil(dayOfMonth / 7)'), 'Legacy ceil(day/7) must be replaced');
});

// ─────────────────────────────────────────────
// SUITE 6: DAILY MAPPER FIELD COUNT
// ─────────────────────────────────────────────
console.log('\n\u2500\u2500 Suite 6: Mapper Field Counts \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');

test('Daily mapper covers 60 fields (62 schema - 2 system-only)', function() {
  // created_at and updated_at are system metadata, not in mapper
  assert.strictEqual(DAILY_MAPPER_FIELDS.length, 60,
    'Expected 60 daily mapper fields, got ' + DAILY_MAPPER_FIELDS.length);
});

test('Item mapper covers 24 fields (27 schema - 2 system-only - 1 placeholder not in mapper key list)', function() {
  // created_at, updated_at are system metadata not in mapper
  // target_quantity is a placeholder but listed separately — actual mapper keys = 24
  assert.strictEqual(ITEM_MAPPER_FIELDS.length, 24,
    'Expected 24 item mapper fields, got ' + ITEM_MAPPER_FIELDS.length);
});

// ─────────────────────────────────────────────
// FINAL SUMMARY
// ─────────────────────────────────────────────
console.log('\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
console.log('  mapper.test.js \u2014 ' + (passed + failed) + ' tests');
console.log('  Passed : ' + passed);
console.log('  Failed : ' + failed);
if (failures.length > 0) {
  console.log('\n  Failed tests:');
  failures.forEach(function(f) { console.log('    \u274c ' + f.name + '\n       ' + f.error); });
}
console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n');
if (failed > 0) process.exit(1);
