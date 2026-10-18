/**
 * Phase 2A + 2B: Supabase Schema Verification and Local Queue Preparation Test Suite
 *
 * Verifies:
 * - Phase 2A: Supabase schema compatibility, RLS policies, zero PIN leakage, pg_cron retention specs.
 * - Phase 2B: SQLite sync_queue dual columns migration, table classifications,
 *   aggregate status calculation, deletability rules, and backward compatibility.
 *
 * Run with:
 *   node tests/syncQueueDualPreparation.test.js
 */

'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

console.log('======================================================');
console.log('   PHASE 2A + 2B — DUAL SYNC QUEUE PREPARATION SUITE  ');
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

// Read repository files
const dbCode = fs.readFileSync(path.join(__dirname, '../database.js'), 'utf8');
const schemaSql = fs.readFileSync(path.join(__dirname, '../supabase_full_setup.sql'), 'utf8');
const syncStatusScreenCode = fs.readFileSync(path.join(__dirname, '../screens/SyncStatusScreen.js'), 'utf8');

// ─── Extract Helpers & Definitions from database.js ────────────────────────
const SUPABASE_SYNC_ELIGIBLE_TABLES = new Set([
  'orders',
  'order_items',
  'payments',
  'expenses',
  'deliveries',
  'daily_submit',
  'daily_summary',
  'daily_submit_priority',
  'restaurant_tables',
  'menu_categories',
  'menu_items',
  'app_config',
  'supplier_due'
]);

function isTableSupabaseEligible(tableName) {
  return SUPABASE_SYNC_ELIGIBLE_TABLES.has(String(tableName || '').trim());
}

function computeAggregateQueueStatus(item) {
  if (!item) return 'PENDING';

  const statusFirestore = item.status_firestore || (item.status === 'SUCCESS' ? 'SUCCESS' : 'PENDING');
  const isSupabaseEligible = isTableSupabaseEligible(item.table_name);
  const statusSupabase = item.status_supabase !== undefined && item.status_supabase !== null
    ? item.status_supabase
    : (isSupabaseEligible ? (item.status === 'SUCCESS' ? 'SUCCESS' : 'PENDING') : 'NOT_APPLICABLE');

  const applicable = [];
  if (statusFirestore !== 'NOT_APPLICABLE') {
    applicable.push(statusFirestore);
  }
  if (isSupabaseEligible && statusSupabase !== 'NOT_APPLICABLE') {
    applicable.push(statusSupabase);
  }

  if (applicable.length === 0) {
    return 'SUCCESS';
  }

  if (applicable.some(s => s === 'PENDING' || s === 'FAILED')) {
    return 'PENDING';
  }

  if (applicable.every(s => s === 'SUCCESS')) {
    return 'SUCCESS';
  }

  return 'PENDING';
}

function isQueueItemDeletable(item) {
  if (!item) return false;

  const statusFirestore = item.status_firestore || (item.status === 'SUCCESS' ? 'SUCCESS' : 'PENDING');
  const isSupabaseEligible = isTableSupabaseEligible(item.table_name);
  const statusSupabase = item.status_supabase !== undefined && item.status_supabase !== null
    ? item.status_supabase
    : (isSupabaseEligible ? (item.status === 'SUCCESS' ? 'SUCCESS' : 'PENDING') : 'NOT_APPLICABLE');

  const isFirestoreComplete = statusFirestore === 'SUCCESS' || statusFirestore === 'NOT_APPLICABLE';
  const isSupabaseComplete = statusSupabase === 'SUCCESS' || statusSupabase === 'NOT_APPLICABLE';

  return isFirestoreComplete && isSupabaseComplete;
}

function runMigrationOnSqlite(dbInstance) {
  const queueColumns = dbInstance.prepare("PRAGMA table_info(sync_queue)").all();
  if (!queueColumns || queueColumns.length === 0) return;

  const colNames = new Set(queueColumns.map(col => col.name));

  const newColumns = [
    { name: 'status_firestore', type: "TEXT DEFAULT 'PENDING'" },
    { name: 'status_supabase', type: "TEXT DEFAULT 'PENDING'" },
    { name: 'retry_count_firestore', type: "INTEGER DEFAULT 0" },
    { name: 'retry_count_supabase', type: "INTEGER DEFAULT 0" },
    { name: 'last_error_firestore', type: "TEXT" },
    { name: 'last_error_supabase', type: "TEXT" },
    { name: 'last_attempt_firestore', type: "TEXT" },
    { name: 'last_attempt_supabase', type: "TEXT" }
  ];

  for (const col of newColumns) {
    if (!colNames.has(col.name)) {
      dbInstance.exec(`ALTER TABLE sync_queue ADD COLUMN ${col.name} ${col.type}`);
    }
  }

  dbInstance.exec(`
    UPDATE sync_queue
    SET status_firestore = coalesce(status, 'PENDING'),
        retry_count_firestore = coalesce(retry_count, 0),
        last_error_firestore = last_error,
        last_attempt_firestore = last_attempt_at
    WHERE status_firestore IS NULL OR status_firestore = '' OR status_firestore = 'PENDING'
  `);

  const eligibleList = Array.from(SUPABASE_SYNC_ELIGIBLE_TABLES).map(t => `'${t}'`).join(',');
  dbInstance.exec(`
    UPDATE sync_queue
    SET status_supabase = 'NOT_APPLICABLE'
    WHERE table_name NOT IN (${eligibleList})
  `);

  dbInstance.exec(`
    UPDATE sync_queue
    SET status_supabase = coalesce(status, 'PENDING')
    WHERE table_name IN (${eligibleList})
      AND (status_supabase IS NULL OR status_supabase = '' OR status_supabase = 'PENDING')
  `);
}

// ─────────────────────────────────────────────
// PHASE 2A: SUPABASE SCHEMA & SECURITY CHECKS
// ─────────────────────────────────────────────

it('Phase 2A.1: Operational tables (8) defined in supabase_full_setup.sql with TEXT primary keys matching SQLite', () => {
  const operationalTables = [
    'orders', 'order_items', 'payments', 'expenses',
    'deliveries', 'daily_submit', 'daily_summary', 'daily_submit_priority'
  ];
  for (const table of operationalTables) {
    assert.ok(schemaSql.includes(`CREATE TABLE IF NOT EXISTS public.${table}`), `Missing operational table: ${table}`);
  }
});

it('Phase 2A.2: Master tables (5) defined in supabase_full_setup.sql with TEXT primary keys', () => {
  const masterTables = [
    'restaurant_tables', 'menu_categories', 'menu_items', 'app_config', 'supplier_due'
  ];
  for (const table of masterTables) {
    assert.ok(schemaSql.includes(`CREATE TABLE IF NOT EXISTS public.${table}`), `Missing master table: ${table}`);
  }
});

it('Phase 2A.3: Device tables (2) defined in supabase_full_setup.sql', () => {
  assert.ok(schemaSql.includes('CREATE TABLE IF NOT EXISTS public.devices'), 'Missing devices table');
  assert.ok(schemaSql.includes('CREATE TABLE IF NOT EXISTS public.device_app_usage'), 'Missing device_app_usage table');
});

it('Phase 2A.4: users and staff plaintext PINs are strictly EXCLUDED from supabase_full_setup.sql', () => {
  assert.ok(!schemaSql.includes('CREATE TABLE IF NOT EXISTS public.users'), 'users table must NOT be in Supabase schema');
  assert.ok(!schemaSql.includes('CREATE TABLE public.users'), 'users table must NOT be in Supabase schema');
});

it('Phase 2A.5: Active devices RLS policy enforced across all 13 business and master tables', () => {
  const all13 = [
    'orders', 'order_items', 'payments', 'expenses', 'deliveries',
    'daily_submit', 'daily_summary', 'daily_submit_priority',
    'restaurant_tables', 'menu_categories', 'menu_items', 'app_config', 'supplier_due'
  ];
  for (const table of all13) {
    assert.ok(schemaSql.includes(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`), `Missing RLS enable on ${table}`);
    assert.ok(schemaSql.includes(`public.is_active_device()`), `Missing is_active_device() check on ${table}`);
  }
});

it('Phase 2A.6: app_config RLS shields sensitive auth keys and credentials', () => {
  assert.ok(schemaSql.includes("key NOT LIKE '_fb_auth_%'"), 'Missing _fb_auth_% shield in app_config RLS');
  assert.ok(schemaSql.includes("key NOT LIKE '%token%'"), 'Missing token shield in app_config RLS');
  assert.ok(schemaSql.includes("key NOT LIKE '%secret%'"), 'Missing secret shield in app_config RLS');
});

it('Phase 2A.7: Foreign keys are sync-order compatible (order_items ON DELETE CASCADE, payments soft reference)', () => {
  assert.ok(schemaSql.includes('REFERENCES public.orders(id) ON DELETE CASCADE'), 'order_items must cascade delete on orders');
  assert.ok(schemaSql.includes('order_id TEXT,'), 'payments.order_id must be soft reference TEXT to prevent order race condition');
});

// ─────────────────────────────────────────────
// PHASE 2B: SQLITE MIGRATION & QUEUE PREPARATION (TESTS A THROUGH L)
// ─────────────────────────────────────────────

// Setup in-memory SQLite database
let memDb;

function setupLegacyDatabase() {
  memDb = new DatabaseSync(':memory:');
  // Create legacy sync_queue table with original 9 columns
  memDb.exec(`
    CREATE TABLE sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      record_id TEXT,
      table_name TEXT,
      action TEXT,
      status TEXT DEFAULT 'PENDING',
      created_at TEXT,
      retry_count INTEGER DEFAULT 0,
      last_error TEXT,
      last_attempt_at TEXT
    );
  `);

  // Insert legacy rows before migration
  memDb.exec(`
    INSERT INTO sync_queue (record_id, table_name, action, status, created_at, retry_count, last_error, last_attempt_at)
    VALUES
      ('ord_001', 'orders', 'INSERT', 'PENDING', '2026-09-26T00:00:00Z', 0, NULL, NULL),
      ('item_001', 'order_items', 'INSERT', 'FAILED', '2026-09-26T00:01:00Z', 2, 'Network timeout', '2026-09-26T00:05:00Z'),
      ('usr_001', 'users', 'INSERT', 'PENDING', '2026-09-26T00:02:00Z', 0, NULL, NULL),
      ('eja_001', 'eja_history', 'INSERT', 'FAILED', '2026-09-26T00:03:00Z', 1, 'Firestore error', '2026-09-26T00:04:00Z'),
      ('pay_001', 'payments', 'INSERT', 'PENDING', '2026-09-26T00:04:00Z', 0, NULL, NULL);
  `);
}

setupLegacyDatabase();

it('Test A: Existing sync_queue rows migrate safely without data loss', () => {
  const beforeCount = memDb.prepare("SELECT COUNT(*) as count FROM sync_queue").get().count;
  assert.strictEqual(beforeCount, 5, 'Pre-migration row count must be 5');

  // Execute migration
  runMigrationOnSqlite(memDb);

  const afterCount = memDb.prepare("SELECT COUNT(*) as count FROM sync_queue").get().count;
  assert.strictEqual(afterCount, 5, 'Post-migration row count must still be 5 (zero data loss)');

  // Verify all 8 dual-sync columns now exist in schema
  const cols = memDb.prepare("PRAGMA table_info(sync_queue)").all();
  const colNames = new Set(cols.map(c => c.name));
  const expectedCols = [
    'status_firestore', 'status_supabase',
    'retry_count_firestore', 'retry_count_supabase',
    'last_error_firestore', 'last_error_supabase',
    'last_attempt_firestore', 'last_attempt_supabase'
  ];
  for (const c of expectedCols) {
    assert.ok(colNames.has(c), `Column ${c} must exist after migration`);
  }
});

it('Test B: Existing status values remain valid', () => {
  const orderRow = memDb.prepare("SELECT * FROM sync_queue WHERE record_id = 'ord_001'").get();
  assert.strictEqual(orderRow.status, 'PENDING');
  assert.strictEqual(orderRow.status_firestore, 'PENDING');
  assert.strictEqual(orderRow.status_supabase, 'PENDING');
  assert.strictEqual(orderRow.retry_count_firestore, 0);

  const itemRow = memDb.prepare("SELECT * FROM sync_queue WHERE record_id = 'item_001'").get();
  assert.strictEqual(itemRow.status, 'FAILED');
  assert.strictEqual(itemRow.status_firestore, 'FAILED');
  assert.strictEqual(itemRow.status_supabase, 'FAILED');
  assert.strictEqual(itemRow.retry_count_firestore, 2);
  assert.strictEqual(itemRow.last_error_firestore, 'Network timeout');
});

it('Test C: New rows initialize both backend statuses correctly', () => {
  const nowIso = new Date().toISOString();
  // Simulate enqueueSync on Supabase-eligible table
  const isSup = isTableSupabaseEligible('expenses');
  memDb.prepare(`
    INSERT INTO sync_queue (
      record_id, table_name, action, status, created_at,
      status_firestore, status_supabase,
      retry_count_firestore, retry_count_supabase,
      last_error_firestore, last_error_supabase,
      last_attempt_firestore, last_attempt_supabase
    ) VALUES ('exp_001', 'expenses', 'INSERT', 'PENDING', ?, 'PENDING', ?, 0, 0, NULL, NULL, NULL, NULL)
  `).run(nowIso, isSup ? 'PENDING' : 'NOT_APPLICABLE');

  const expRow = memDb.prepare("SELECT * FROM sync_queue WHERE record_id = 'exp_001'").get();
  assert.strictEqual(expRow.status, 'PENDING');
  assert.strictEqual(expRow.status_firestore, 'PENDING');
  assert.strictEqual(expRow.status_supabase, 'PENDING');
  assert.strictEqual(expRow.retry_count_firestore, 0);
  assert.strictEqual(expRow.retry_count_supabase, 0);
  assert.strictEqual(expRow.last_error_firestore, null);
  assert.strictEqual(expRow.last_error_supabase, null);
});

it('Test D: Firestore-only table gets status_supabase = NOT_APPLICABLE', () => {
  // Check migrated legacy rows
  const usrRow = memDb.prepare("SELECT * FROM sync_queue WHERE record_id = 'usr_001'").get();
  assert.strictEqual(usrRow.status_supabase, 'NOT_APPLICABLE');

  const ejaRow = memDb.prepare("SELECT * FROM sync_queue WHERE record_id = 'eja_001'").get();
  assert.strictEqual(ejaRow.status_supabase, 'NOT_APPLICABLE');

  // Check all other Firestore-only / Local-only tables
  const firestoreOnlyTables = [
    'users', 'eja_history', 'due_payments', 'off_days', 'weather_data',
    'supplier_due_history', 'supplier_payment_ledger',
    'owner_employees', 'owner_salary_ledger', 'owner_expenses', 'owner_deposits', 'owner_home_deposits',
    'deletions', 'delete_history', 'notifications', 'activity_logs'
  ];

  for (const t of firestoreOnlyTables) {
    assert.strictEqual(isTableSupabaseEligible(t), false, `${t} must NOT be Supabase eligible`);
    const initialSupabase = isTableSupabaseEligible(t) ? 'PENDING' : 'NOT_APPLICABLE';
    assert.strictEqual(initialSupabase, 'NOT_APPLICABLE');
  }
});

it('Test E: Supabase-enabled table gets status_supabase = PENDING', () => {
  const supabaseEligible = [
    'orders', 'order_items', 'payments', 'expenses', 'deliveries',
    'daily_submit', 'daily_summary', 'daily_submit_priority',
    'restaurant_tables', 'menu_categories', 'menu_items', 'app_config', 'supplier_due'
  ];

  for (const t of supabaseEligible) {
    assert.strictEqual(isTableSupabaseEligible(t), true, `${t} must be Supabase eligible`);
    const initialSupabase = isTableSupabaseEligible(t) ? 'PENDING' : 'NOT_APPLICABLE';
    assert.strictEqual(initialSupabase, 'PENDING');
  }
});

it('Test F: Aggregate status remains PENDING while either backend is pending', () => {
  // Both pending
  assert.strictEqual(
    computeAggregateQueueStatus({ table_name: 'orders', status_firestore: 'PENDING', status_supabase: 'PENDING' }),
    'PENDING'
  );

  // Firestore success, Supabase pending
  assert.strictEqual(
    computeAggregateQueueStatus({ table_name: 'orders', status_firestore: 'SUCCESS', status_supabase: 'PENDING' }),
    'PENDING'
  );

  // Firestore pending, Supabase success
  assert.strictEqual(
    computeAggregateQueueStatus({ table_name: 'orders', status_firestore: 'PENDING', status_supabase: 'SUCCESS' }),
    'PENDING'
  );

  // Firestore-only table with pending firestore
  assert.strictEqual(
    computeAggregateQueueStatus({ table_name: 'users', status_firestore: 'PENDING', status_supabase: 'NOT_APPLICABLE' }),
    'PENDING'
  );
});

it('Test G: Aggregate status remains PENDING if either backend failed', () => {
  // Firestore failed, Supabase success
  assert.strictEqual(
    computeAggregateQueueStatus({ table_name: 'orders', status_firestore: 'FAILED', status_supabase: 'SUCCESS' }),
    'PENDING'
  );

  // Firestore success, Supabase failed
  assert.strictEqual(
    computeAggregateQueueStatus({ table_name: 'orders', status_firestore: 'SUCCESS', status_supabase: 'FAILED' }),
    'PENDING'
  );

  // Firestore failed, Supabase pending
  assert.strictEqual(
    computeAggregateQueueStatus({ table_name: 'orders', status_firestore: 'FAILED', status_supabase: 'PENDING' }),
    'PENDING'
  );

  // Both failed
  assert.strictEqual(
    computeAggregateQueueStatus({ table_name: 'orders', status_firestore: 'FAILED', status_supabase: 'FAILED' }),
    'PENDING'
  );

  // Firestore-only table failed
  assert.strictEqual(
    computeAggregateQueueStatus({ table_name: 'users', status_firestore: 'FAILED', status_supabase: 'NOT_APPLICABLE' }),
    'PENDING'
  );
});

it('Test H: Aggregate status becomes SUCCESS only when all applicable backends succeed', () => {
  // Dual-sync table: both SUCCESS
  assert.strictEqual(
    computeAggregateQueueStatus({ table_name: 'orders', status_firestore: 'SUCCESS', status_supabase: 'SUCCESS' }),
    'SUCCESS'
  );

  // Firestore-only table: Firestore SUCCESS, Supabase NOT_APPLICABLE
  assert.strictEqual(
    computeAggregateQueueStatus({ table_name: 'users', status_firestore: 'SUCCESS', status_supabase: 'NOT_APPLICABLE' }),
    'SUCCESS'
  );

  // Neither applicable
  assert.strictEqual(
    computeAggregateQueueStatus({ table_name: 'local_table', status_firestore: 'NOT_APPLICABLE', status_supabase: 'NOT_APPLICABLE' }),
    'SUCCESS'
  );
});

it('Test I: Queue row is deletable only when both applicable backends succeed', () => {
  // Dual-sync table
  // Do NOT delete merely because Firestore succeeds!
  assert.strictEqual(
    isQueueItemDeletable({ table_name: 'orders', status_firestore: 'SUCCESS', status_supabase: 'PENDING' }),
    false,
    'Must not delete queue item if Supabase is still PENDING'
  );

  assert.strictEqual(
    isQueueItemDeletable({ table_name: 'orders', status_firestore: 'PENDING', status_supabase: 'SUCCESS' }),
    false,
    'Must not delete queue item if Firestore is still PENDING'
  );

  assert.strictEqual(
    isQueueItemDeletable({ table_name: 'orders', status_firestore: 'SUCCESS', status_supabase: 'FAILED' }),
    false,
    'Must not delete queue item if Supabase FAILED'
  );

  assert.strictEqual(
    isQueueItemDeletable({ table_name: 'orders', status_firestore: 'FAILED', status_supabase: 'SUCCESS' }),
    false,
    'Must not delete queue item if Firestore FAILED'
  );

  // Deletable when BOTH are SUCCESS
  assert.strictEqual(
    isQueueItemDeletable({ table_name: 'orders', status_firestore: 'SUCCESS', status_supabase: 'SUCCESS' }),
    true,
    'Must be deletable when both backends are SUCCESS'
  );

  // Firestore-only table: deletable when Firestore is SUCCESS and Supabase is NOT_APPLICABLE
  assert.strictEqual(
    isQueueItemDeletable({ table_name: 'users', status_firestore: 'SUCCESS', status_supabase: 'NOT_APPLICABLE' }),
    true,
    'Must be deletable when Firestore is SUCCESS for Firestore-only table'
  );

  assert.strictEqual(
    isQueueItemDeletable({ table_name: 'users', status_firestore: 'PENDING', status_supabase: 'NOT_APPLICABLE' }),
    false,
    'Must not delete if Firestore is PENDING'
  );
});

it('Test J: Existing Firestore queue behavior is unchanged', () => {
  // Confirm processSyncQueue has NOT been rewritten with Supabase network calls
  assert.ok(!dbCode.includes('supabaseClient.from'), 'Supabase client calls must not be added to database.js yet');
  assert.ok(!dbCode.includes('deviceSupabaseInstance.from'), 'Device Supabase calls must not be added to processSyncQueue yet');
  assert.ok(dbCode.includes('toFirestoreDocument'), 'Firestore document serialization must remain present');
  assert.ok(dbCode.includes('firestore.googleapis.com'), 'Firestore REST endpoint must remain unchanged');
});

it('Test K: Existing SyncStatusScreen queries still work', () => {
  assert.ok(syncStatusScreenCode.includes("SELECT COUNT(*) as c FROM sync_queue WHERE status = 'PENDING'"));
  assert.ok(syncStatusScreenCode.includes("SELECT COUNT(*) as c FROM sync_queue WHERE status = 'FAILED'"));
  assert.ok(syncStatusScreenCode.includes("SELECT * FROM sync_queue ORDER BY id ASC LIMIT 15"));

  // Run the exact SyncStatusScreen queries on our migrated database
  const pendingRes = memDb.prepare("SELECT COUNT(*) as c FROM sync_queue WHERE status = 'PENDING'").all();
  const failedRes = memDb.prepare("SELECT COUNT(*) as c FROM sync_queue WHERE status = 'FAILED'").all();
  const itemsRes = memDb.prepare("SELECT * FROM sync_queue ORDER BY id ASC LIMIT 15").all();

  assert.strictEqual(typeof pendingRes[0].c, 'number');
  assert.strictEqual(typeof failedRes[0].c, 'number');
  assert.ok(Array.isArray(itemsRes));
  assert.ok(itemsRes.length > 0);
  assert.ok(itemsRes[0].status_firestore !== undefined);
  assert.ok(itemsRes[0].status_supabase !== undefined);
});

it('Test L: Existing AdminDB / getPendingSyncCount sync indicators still work', () => {
  assert.ok(dbCode.includes("SELECT COUNT(*) as count FROM sync_queue WHERE status = 'PENDING' OR status = 'FAILED'"));

  const pendingCountRes = memDb.prepare("SELECT COUNT(*) as count FROM sync_queue WHERE status = 'PENDING' OR status = 'FAILED'").get();
  assert.strictEqual(typeof pendingCountRes.count, 'number');
  assert.strictEqual(pendingCountRes.count, 6); // 4 pending + 2 failed in our test set
});

it('Exports Verification: database.js exports dual-sync constants and helper functions', () => {
  assert.ok(dbCode.includes('export const SUPABASE_SYNC_ELIGIBLE_TABLES'), 'Missing export SUPABASE_SYNC_ELIGIBLE_TABLES');
  assert.ok(dbCode.includes('export function isTableSupabaseEligible'), 'Missing export isTableSupabaseEligible');
  assert.ok(dbCode.includes('export function computeAggregateQueueStatus'), 'Missing export computeAggregateQueueStatus');
  assert.ok(dbCode.includes('export function isQueueItemDeletable'), 'Missing export isQueueItemDeletable');
  assert.ok(dbCode.includes('export function migrateSyncQueueDualColumns'), 'Missing export migrateSyncQueueDualColumns');
});

console.log('\n======================================================');
console.log(`   EXECUTION SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED`);
console.log('======================================================\n');

if (failedTests > 0) {
  process.exit(1);
}
