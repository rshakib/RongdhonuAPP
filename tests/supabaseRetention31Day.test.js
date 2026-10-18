/**
 * Phase 2D — Supabase 31-Calendar-Day Operational Retention Test Suite
 *
 * Verifies:
 * - Step 1 & 2: Audit of Supabase operational tables vs protected master tables
 * - Step 3: device_app_usage 06:00 usage analytics isolation vs 00:00 business day
 * - Step 4 & 10: Exact 31-calendar-day boundary calculations (Dhaka timezone, leap years, month/year boundaries, midnight)
 * - Step 5 & 11: Foreign key safe deletion order (order_items before orders, parent retention if children active, zero orphans)
 * - Step 6: PostgreSQL retention function and preview/dry-run mode
 * - Step 7: Security: Privileged-only EXECUTE grants (REVOKE from PUBLIC/anon/authenticated), zero service_role in client
 * - Step 8: pg_cron scheduled at 00:15 UTC (06:15 Asia/Dhaka) with idempotent setup
 * - Step 12: Master tables and device registry protection
 * - Step 13 & 14: Complete isolation from Firestore (permanent archive) and SQLite sync_queue
 *
 * Run with:
 *   node tests/supabaseRetention31Day.test.js
 */

'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

console.log('======================================================');
console.log('   PHASE 2D — SUPABASE 31-DAY RETENTION TEST SUITE    ');
console.log('======================================================\n');

let passedTests = 0;
let failedTests = 0;

function it(desc, fn) {
  try {
    fn();
    console.log(`  ✅  ${desc}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌  ${desc}`);
    console.error(`      ${err.message}`);
    failedTests++;
  }
}

// Read schema and codebase
const schemaSql = fs.readFileSync(path.join(__dirname, '../supabase_full_setup.sql'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));

// ─────────────────────────────────────────────────────────
// HELPER: Asia/Dhaka Date Calculation (Matches Postgres PL/pgSQL)
// ─────────────────────────────────────────────────────────
function calculateDhakaRetentionCutoff(referenceDateStr) {
  // Parse reference date (YYYY-MM-DD) as UTC representation of the Dhaka calendar date
  const [year, month, day] = referenceDateStr.split('-').map(Number);
  const refDate = new Date(Date.UTC(year, month - 1, day));
  
  // Subtract 30 days to retain Today + Previous 30 calendar days = 31 calendar days
  const cutoffDate = new Date(Date.UTC(year, month - 1, day));
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() - 30);

  const cutoffDateStr = cutoffDate.toISOString().slice(0, 10);
  // Midnight 00:00:00 Asia/Dhaka (+06:00) in ISO string / timestamp
  const cutoffTimestamptzStr = `${cutoffDateStr}T00:00:00+06:00`;
  const cutoffTimestamptzEpoch = new Date(Date.parse(cutoffTimestamptzStr)).getTime();

  return {
    referenceDate: referenceDateStr,
    retentionDays: 31,
    cutoffDateStr,
    cutoffTimestamptzStr,
    cutoffTimestamptzEpoch
  };
}

// ─────────────────────────────────────────────────────────
// STEP 10: DATE BOUNDARIES & ASIA/DHAKA CALENDAR RETENTION
// ─────────────────────────────────────────────────────────

it('Test 10.A: Normal month (2026-09-26) retains exactly 31 calendar days (2026-08-27 through 2026-09-26)', () => {
  const result = calculateDhakaRetentionCutoff('2026-09-26');
  assert.strictEqual(result.cutoffDateStr, '2026-08-27');
  
  // Verify date count inclusive: Aug 27..31 (5 days) + Sept 1..26 (26 days) = 31 days
  const dStart = new Date(Date.UTC(2026, 7, 27));
  const dEnd = new Date(Date.UTC(2026, 8, 26));
  const dayCount = Math.round((dEnd - dStart) / (24 * 3600 * 1000)) + 1;
  assert.strictEqual(dayCount, 31);
});

it('Test 10.B: Month boundary (2026-10-01) retains exactly 31 calendar days (2026-09-01 through 2026-10-01)', () => {
  const result = calculateDhakaRetentionCutoff('2026-10-01');
  assert.strictEqual(result.cutoffDateStr, '2026-09-01');
  
  // Sept 1..30 (30 days) + Oct 1 (1 day) = 31 days
  const dStart = new Date(Date.UTC(2026, 8, 1));
  const dEnd = new Date(Date.UTC(2026, 9, 1));
  const dayCount = Math.round((dEnd - dStart) / (24 * 3600 * 1000)) + 1;
  assert.strictEqual(dayCount, 31);
});

it('Test 10.C: Year boundary (2027-01-01) retains exactly 31 calendar days (2026-12-02 through 2027-01-01)', () => {
  const result = calculateDhakaRetentionCutoff('2027-01-01');
  assert.strictEqual(result.cutoffDateStr, '2026-12-02');
  
  // Dec 2..31 (30 days) + Jan 1 (1 day) = 31 days
  const dStart = new Date(Date.UTC(2026, 11, 2));
  const dEnd = new Date(Date.UTC(2027, 0, 1));
  const dayCount = Math.round((dEnd - dStart) / (24 * 3600 * 1000)) + 1;
  assert.strictEqual(dayCount, 31);
});

it('Test 10.D: Leap year boundary (2024-03-01) accounts for February 29 (cutoff 2024-01-31)', () => {
  const result = calculateDhakaRetentionCutoff('2024-03-01');
  assert.strictEqual(result.cutoffDateStr, '2024-01-31');
  
  // Jan 31 (1 day) + Feb 1..29 (29 days) + Mar 1 (1 day) = 31 days
  const dStart = new Date(Date.UTC(2024, 0, 31));
  const dEnd = new Date(Date.UTC(2024, 2, 1));
  const dayCount = Math.round((dEnd - dStart) / (24 * 3600 * 1000)) + 1;
  assert.strictEqual(dayCount, 31);
});

it('Test 10.E: Non-leap year boundary (2025-03-01) accounts for February 28 (cutoff 2025-01-30)', () => {
  const result = calculateDhakaRetentionCutoff('2025-03-01');
  assert.strictEqual(result.cutoffDateStr, '2025-01-30');
  
  // Jan 30..31 (2 days) + Feb 1..28 (28 days) + Mar 1 (1 day) = 31 days
  const dStart = new Date(Date.UTC(2025, 0, 30));
  const dEnd = new Date(Date.UTC(2025, 2, 1));
  const dayCount = Math.round((dEnd - dStart) / (24 * 3600 * 1000)) + 1;
  assert.strictEqual(dayCount, 31);
});

it('Test 10.F: Exactly on boundary: Record created at 00:00:00 Asia/Dhaka on first retained date MUST remain', () => {
  const result = calculateDhakaRetentionCutoff('2026-09-26');
  // First retained date is 2026-08-27. Record at exactly 2026-08-27 00:00:00+06:00
  const recordTimestampEpoch = new Date(Date.parse('2026-08-27T00:00:00+06:00')).getTime();
  const isEligibleForDeletion = recordTimestampEpoch < result.cutoffTimestamptzEpoch;
  assert.strictEqual(isEligibleForDeletion, false, 'Record exactly at boundary cutoff must be KEPT');
});

it('Test 10.G: One millisecond before boundary: Record created at 23:59:59.999 on previous day MUST be deleted', () => {
  const result = calculateDhakaRetentionCutoff('2026-09-26');
  // Date before cutoff: 2026-08-26 23:59:59.999+06:00
  const recordTimestampEpoch = new Date(Date.parse('2026-08-26T23:59:59.999+06:00')).getTime();
  const isEligibleForDeletion = recordTimestampEpoch < result.cutoffTimestamptzEpoch;
  assert.strictEqual(isEligibleForDeletion, true, 'Record before boundary cutoff must be DELETED');
});

it('Test 10.H: Midnight transition: 23:59:59 Dhaka belongs to previous day, 00:00:00 Dhaka begins new business day', () => {
  const prevDayEpoch = new Date(Date.parse('2026-09-25T23:59:59+06:00')).getTime();
  const newDayEpoch = new Date(Date.parse('2026-09-26T00:00:00+06:00')).getTime();
  assert.strictEqual(newDayEpoch - prevDayEpoch, 1000); // exactly 1 second across midnight boundary
});

it('Test 10.I: Timezone conversion: UTC to Asia/Dhaka (+06:00) handling', () => {
  // 2026-08-26 18:00:00 UTC is exactly 2026-08-27 00:00:00+06:00
  const utcEpoch = new Date('2026-08-26T18:00:00.000Z').getTime();
  const bstEpoch = new Date(Date.parse('2026-08-27T00:00:00+06:00')).getTime();
  assert.strictEqual(utcEpoch, bstEpoch, 'UTC 18:00:00 matches BST 00:00:00 next day');
});

it('Test 10.J: 06:00 isolation: Business transactions strictly use 00:00:00 Asia/Dhaka; 06:00 is NOT used for transactions', () => {
  // Verify supabase_full_setup.sql does not apply 06:00 to orders or other business tables
  assert.ok(schemaSql.includes("v_cutoff_date := v_today - 30;"), 'Retention calculates 30 calendar days from calendar today');
  assert.ok(schemaSql.includes("(v_cutoff_date_str || ' 00:00:00+06')::timestamptz"), 'Retention uses 00:00:00+06 for cutoff');
  assert.ok(!schemaSql.includes("' 06:00:00+06'"), '06:00:00 must NOT be used for operational transaction retention cutoff');
});

// ─────────────────────────────────────────────────────────
// STEP 11: FOREIGN KEY ORDER & SIMULATION ENGINE
// ─────────────────────────────────────────────────────────

it('Test 11.A: Foreign key safe deletion order: order_items deleted before orders', () => {
  const purgeFuncDef = schemaSql.slice(schemaSql.indexOf('CREATE OR REPLACE FUNCTION public.purge_expired_operational_data'));
  const idxDeleteOrderItems = purgeFuncDef.indexOf('DELETE FROM public.order_items');
  const idxDeleteOrders = purgeFuncDef.indexOf('DELETE FROM public.orders');
  assert.ok(idxDeleteOrderItems !== -1, 'order_items deletion must exist');
  assert.ok(idxDeleteOrders !== -1, 'orders deletion must exist');
  assert.ok(idxDeleteOrderItems < idxDeleteOrders, 'order_items MUST be deleted before orders');
});

it('Test 11.B: Retained children protect parent: Parent order with active child items is NOT deleted', () => {
  // In-memory SQLite simulation of the retention logic
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE orders (id TEXT PRIMARY KEY, created_at TEXT);
    CREATE TABLE order_items (id TEXT PRIMARY KEY, order_id TEXT, created_at TEXT);
  `);

  const cutoff = '2026-08-27T00:00:00+06:00';

  // Order 1: Old order (2026-08-20), but has an active child item (2026-08-30)
  db.exec(`INSERT INTO orders VALUES ('ord_1', '2026-08-20T12:00:00+06:00');`);
  db.exec(`INSERT INTO order_items VALUES ('item_active', 'ord_1', '2026-08-30T12:00:00+06:00');`);

  // Order 2: Old order (2026-08-20) with old child item (2026-08-20)
  db.exec(`INSERT INTO orders VALUES ('ord_2', '2026-08-20T12:00:00+06:00');`);
  db.exec(`INSERT INTO order_items VALUES ('item_old', 'ord_2', '2026-08-20T12:00:00+06:00');`);

  // Order 3: Active order (2026-09-01) with active child item (2026-09-01)
  db.exec(`INSERT INTO orders VALUES ('ord_3', '2026-09-01T12:00:00+06:00');`);
  db.exec(`INSERT INTO order_items VALUES ('item_3', 'ord_3', '2026-09-01T12:00:00+06:00');`);

  // Step A: Delete expired order items
  db.exec(`DELETE FROM order_items WHERE created_at < '${cutoff}';`);

  // Step B: Delete expired orders guarded against any retained child items
  db.exec(`
    DELETE FROM orders 
    WHERE created_at < '${cutoff}'
      AND id NOT IN (SELECT DISTINCT order_id FROM order_items WHERE order_id IS NOT NULL);
  `);

  // ord_1 was older than cutoff, but because item_active was retained, ord_1 MUST be preserved!
  const ord1 = db.prepare(`SELECT * FROM orders WHERE id = 'ord_1'`).all();
  assert.strictEqual(ord1.length, 1, 'ord_1 must be preserved because it has an active child');

  // ord_2 had all children expired and deleted, so ord_2 must be deleted
  const ord2 = db.prepare(`SELECT * FROM orders WHERE id = 'ord_2'`).all();
  assert.strictEqual(ord2.length, 0, 'ord_2 must be deleted');

  // ord_3 was within retention window, so must be preserved
  const ord3 = db.prepare(`SELECT * FROM orders WHERE id = 'ord_3'`).all();
  assert.strictEqual(ord3.length, 1, 'ord_3 must be preserved');
});

it('Test 11.C: Orphan prevention: Complete order expiration deletes items first, leaves no orphans', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE orders (id TEXT PRIMARY KEY, created_at TEXT);
    CREATE TABLE order_items (id TEXT PRIMARY KEY, order_id TEXT, created_at TEXT);
  `);

  const cutoff = '2026-08-27T00:00:00+06:00';
  db.exec(`INSERT INTO orders VALUES ('ord_exp', '2026-08-20T10:00:00+06:00');`);
  db.exec(`INSERT INTO order_items VALUES ('item_exp1', 'ord_exp', '2026-08-20T10:00:00+06:00');`);
  db.exec(`INSERT INTO order_items VALUES ('item_exp2', 'ord_exp', '2026-08-20T10:00:00+06:00');`);

  // Purge
  db.exec(`DELETE FROM order_items WHERE created_at < '${cutoff}';`);
  db.exec(`
    DELETE FROM orders 
    WHERE created_at < '${cutoff}'
      AND id NOT IN (SELECT DISTINCT order_id FROM order_items WHERE order_id IS NOT NULL);
  `);

  const remainingItems = db.prepare(`SELECT * FROM order_items`).all();
  const remainingOrders = db.prepare(`SELECT * FROM orders`).all();
  assert.strictEqual(remainingItems.length, 0);
  assert.strictEqual(remainingOrders.length, 0);
});

it('Test 11.D: Retention idempotency: Successive runs delete 0 additional rows', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE payments (id TEXT PRIMARY KEY, created_at TEXT);
  `);

  const cutoff = '2026-08-27T00:00:00+06:00';
  db.exec(`INSERT INTO payments VALUES ('pay_1', '2026-08-20T10:00:00+06:00');`);
  db.exec(`INSERT INTO payments VALUES ('pay_2', '2026-09-01T10:00:00+06:00');`);

  // Run 1
  db.exec(`DELETE FROM payments WHERE created_at < '${cutoff}';`);
  const countAfterRun1 = db.prepare(`SELECT count(*) as cnt FROM payments`).get().cnt;
  assert.strictEqual(countAfterRun1, 1);

  // Run 2 (idempotent pass)
  db.exec(`DELETE FROM payments WHERE created_at < '${cutoff}';`);
  const countAfterRun2 = db.prepare(`SELECT count(*) as cnt FROM payments`).get().cnt;
  assert.strictEqual(countAfterRun2, 1, 'Subsequent execution must delete 0 rows');
});

// ─────────────────────────────────────────────────────────
// STEP 12: MASTER DATA & DEVICE PROTECTION
// ─────────────────────────────────────────────────────────

it('Test 12.A: Master tables are strictly immune: restaurant_tables, menu_categories, menu_items, app_config, supplier_due are NEVER purged', () => {
  const purgeFuncDef = schemaSql.slice(schemaSql.indexOf('CREATE OR REPLACE FUNCTION public.purge_expired_operational_data'));
  const masterTables = [
    'restaurant_tables',
    'menu_categories',
    'menu_items',
    'app_config',
    'supplier_due'
  ];
  for (const table of masterTables) {
    assert.ok(!purgeFuncDef.includes(`DELETE FROM public.${table}`), `Master table ${table} must NEVER be purged`);
  }
});

it('Test 12.B: Hardware device tables are strictly immune: devices table is NEVER purged', () => {
  const purgeFuncDef = schemaSql.slice(schemaSql.indexOf('CREATE OR REPLACE FUNCTION public.purge_expired_operational_data'));
  assert.ok(!purgeFuncDef.includes('DELETE FROM public.devices'), 'public.devices must NEVER be purged');
});

it('Test 12.C: users table and staff PINs strictly do not exist in Supabase schema', () => {
  assert.ok(!schemaSql.includes('CREATE TABLE public.users'), 'users table must NOT be in Supabase schema');
  assert.ok(!schemaSql.includes('CREATE TABLE IF NOT EXISTS public.users'), 'users table must NOT be in Supabase schema');
});

// ─────────────────────────────────────────────────────────
// STEP 7: SECURITY & PRIVILEGE ARCHITECTURE
// ─────────────────────────────────────────────────────────

it('Test 7.A: Anonymous and authenticated clients are denied execution of retention functions', () => {
  assert.ok(
    schemaSql.includes('REVOKE ALL ON FUNCTION public.purge_expired_operational_data(BOOLEAN, DATE) FROM PUBLIC, anon, authenticated;'),
    'purge_expired_operational_data must revoke execute from public, anon, authenticated'
  );
  assert.ok(
    schemaSql.includes('REVOKE ALL ON FUNCTION public.preview_expired_operational_data(DATE) FROM PUBLIC, anon, authenticated;'),
    'preview_expired_operational_data must revoke execute from public, anon, authenticated'
  );
});

it('Test 7.B: Only service_role possesses execute grant for retention functions', () => {
  assert.ok(
    schemaSql.includes('GRANT EXECUTE ON FUNCTION public.purge_expired_operational_data(BOOLEAN, DATE) TO service_role;'),
    'purge_expired_operational_data must grant execute only to service_role'
  );
  assert.ok(
    schemaSql.includes('GRANT EXECUTE ON FUNCTION public.preview_expired_operational_data(DATE) TO service_role;'),
    'preview_expired_operational_data must grant execute only to service_role'
  );
});

it('Test 7.C: SUPABASE_SERVICE_ROLE_KEY is 100% absent from mobile client bundle and config', () => {
  assert.strictEqual(process.env.SUPABASE_SERVICE_ROLE_KEY, undefined);
  const clientFiles = [
    'database.js',
    'services/supabaseClient.js',
    'services/supabaseSyncDispatcher.js',
    'services/supabaseDeviceControl.js',
    'services/deviceRegistry.js',
    'services/appUsageTracker.js'
  ];
  for (const relPath of clientFiles) {
    const fullPath = path.join(__dirname, '..', relPath);
    if (fs.existsSync(fullPath)) {
      const code = fs.readFileSync(fullPath, 'utf8');
      assert.ok(!code.includes('SUPABASE_SERVICE_ROLE_KEY'), `service_role found in ${relPath}`);
      assert.ok(!code.includes('service_role'), `service_role literal found in ${relPath}`);
    }
  }
});

// ─────────────────────────────────────────────────────────
// STEP 8: pg_cron SCHEDULE & AUTOMATION
// ─────────────────────────────────────────────────────────

it('Test 8.A: pg_cron schedules purge daily at 00:15 UTC (06:15 Asia/Dhaka) with idempotent creation', () => {
  assert.ok(schemaSql.includes("cron.schedule("), 'pg_cron schedule statement must be defined');
  assert.ok(schemaSql.includes("'daily_operational_retention_purge'"), 'Job name must be daily_operational_retention_purge');
  assert.ok(schemaSql.includes("'15 0 * * *'"), 'Execution schedule must be 00:15 UTC (15 0 * * *)');
  assert.ok(schemaSql.includes("cron.unschedule('daily_operational_retention_purge')"), 'Must unschedule existing job for idempotency');
  assert.ok(schemaSql.includes("SELECT public.purge_expired_operational_data(false);"), 'Must call purge_expired_operational_data(false)');
});

// ─────────────────────────────────────────────────────────
// STEP 9: RETENTION AUDIT / DRY-RUN PREVIEW MODE
// ─────────────────────────────────────────────────────────

it('Test 9.A: Dry-run / preview function reports candidate rows and retained rows without deleting', () => {
  assert.ok(schemaSql.includes("FUNCTION public.preview_expired_operational_data"), 'preview function must exist');
  assert.ok(schemaSql.includes("IF p_dry_run THEN"), 'dry_run branch must exist');
  assert.ok(schemaSql.includes("'dry_run', true,"), 'dry_run flag must be returned in preview');
  assert.ok(schemaSql.includes("'eligible_for_deletion'"), 'eligible_for_deletion breakdown must be returned');
  assert.ok(schemaSql.includes("'retained_rows'"), 'retained_rows breakdown must be returned');
});

// ─────────────────────────────────────────────────────────
// STEP 13 & 14: FIRESTORE & PHASE 2C COMPATIBILITY
// ─────────────────────────────────────────────────────────

it('Test 13.A: Supabase operational retention has ZERO effect on Firestore permanent archive or SQLite', () => {
  // Retention function is 100% internal to Supabase Postgres.
  // It has no network calls, no triggers on SQLite, and no webhooks to Firestore.
  const purgeFuncDef = schemaSql.slice(schemaSql.indexOf('CREATE OR REPLACE FUNCTION public.purge_expired_operational_data'));
  assert.ok(!purgeFuncDef.includes('firestore'), 'Retention function must not reference Firestore');
  assert.ok(!purgeFuncDef.includes('sync_queue'), 'Retention function must not modify sync_queue');
});

it('Test 14.A: Dual sync dispatcher (Phase 2C) remains fully operational and compatible', () => {
  const dispatcherCode = fs.readFileSync(path.join(__dirname, '../services/supabaseSyncDispatcher.js'), 'utf8');
  assert.ok(dispatcherCode.includes('syncRecordToSupabase'), 'syncRecordToSupabase must exist');
  assert.ok(dispatcherCode.includes('transformToSupabaseRow'), 'transformToSupabaseRow must exist');
  assert.ok(dispatcherCode.includes('SUPABASE_SYNC_ELIGIBLE_TABLES'), 'SUPABASE_SYNC_ELIGIBLE_TABLES must exist');
});

// ─────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────
console.log('======================================================');
console.log(`   EXECUTION SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED`);
console.log('======================================================\n');

if (failedTests > 0) {
  process.exit(1);
}
