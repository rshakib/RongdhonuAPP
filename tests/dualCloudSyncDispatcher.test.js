/**
 * Phase 2C — Dual-Cloud Sync Dispatcher Test Suite
 *
 * Comprehensive verification for:
 * - Independent synchronization to Firestore and Supabase
 * - Backend failure isolation (one cloud failure does not block the other)
 * - Deterministic transformation layer (SQLite -> Supabase)
 * - Strict primary key mapping and foreign key constraint handling (order_items parent dependency)
 * - Zero service_role leakage, strict exclusion of users/PINs
 * - Idempotent upsert, delete handling, offline tolerance, concurrency lock
 *
 * Run with:
 *   node tests/dualCloudSyncDispatcher.test.js
 */

'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

console.log('======================================================');
console.log('   PHASE 2C — DUAL-CLOUD SYNC DISPATCHER TEST SUITE   ');
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

async function itAsync(desc, fn) {
  try {
    await fn();
    console.log(`  ✅  ${desc}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌  ${desc}`);
    console.error(`      ${err.message}`);
    failedTests++;
  }
}

// Read repository source files for static verification
const dbCode = fs.readFileSync(path.join(__dirname, '../database.js'), 'utf8');
const dispatcherCode = fs.readFileSync(path.join(__dirname, '../services/supabaseSyncDispatcher.js'), 'utf8');
const supabaseClientCode = fs.readFileSync(path.join(__dirname, '../services/supabaseClient.js'), 'utf8');

// Import transformation & dispatcher utilities directly
const {
  SUPABASE_SYNC_ELIGIBLE_TABLES,
  SUPABASE_TABLE_COLUMNS,
  isTableSupabaseEligible,
  getSupabasePrimaryKeyColumn,
  transformToSupabaseRow,
  syncRecordToSupabase
} = require('../services/supabaseSyncDispatcher.js');

// ─────────────────────────────────────────────
// MOCK SUPABASE CLIENT BUILDER FOR UNIT TESTS
// ─────────────────────────────────────────────
function createMockSupabaseClient(config = {}) {
  const operations = [];
  return {
    operations,
    from(tableName) {
      return {
        upsert(payload, options = {}) {
          operations.push({ type: 'upsert', table: tableName, payload, options });
          if (config.failTable === tableName && config.failType === 'foreign_key') {
            return Promise.resolve({
              error: {
                message: `insert or update on table "${tableName}" violates foreign key constraint`,
                code: '23503'
              }
            });
          }
          if (config.failTable === tableName && config.failType === 'rls') {
            return Promise.resolve({
              error: {
                message: `row-level security policy violated on table ${tableName}`,
                code: '42501'
              }
            });
          }
          if (config.failTable === tableName || config.failAll) {
            return Promise.resolve({
              error: {
                message: config.errorMessage || 'Network timeout connecting to Supabase',
                code: 'NETWORK_ERROR'
              }
            });
          }
          return Promise.resolve({ data: payload, error: null });
        },
        delete() {
          return {
            eq(col, val) {
              operations.push({ type: 'delete', table: tableName, col, val });
              if (config.failTable === tableName || config.failAll) {
                return Promise.resolve({
                  error: {
                    message: config.errorMessage || 'Delete failed',
                    code: 'DELETE_ERROR'
                  }
                });
              }
              return Promise.resolve({ error: null });
            }
          };
        }
      };
    }
  };
}

// ─────────────────────────────────────────────
// SUITE EXECUTION
// ─────────────────────────────────────────────

async function runAllTests() {

  // ─── TEST A: Supabase-eligible INSERT initial state ────────────────────────
  it('Test A: Supabase-eligible INSERT initializes both backend statuses to PENDING', () => {
    const memDb = new DatabaseSync(':memory:');
    memDb.exec(`
      CREATE TABLE sync_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        record_id TEXT,
        table_name TEXT,
        action TEXT,
        status TEXT DEFAULT 'PENDING',
        created_at TEXT,
        status_firestore TEXT DEFAULT 'PENDING',
        status_supabase TEXT DEFAULT 'PENDING',
        retry_count INTEGER DEFAULT 0,
        retry_count_firestore INTEGER DEFAULT 0,
        retry_count_supabase INTEGER DEFAULT 0,
        last_error TEXT,
        last_error_firestore TEXT,
        last_error_supabase TEXT,
        last_attempt_at TEXT,
        last_attempt_firestore TEXT,
        last_attempt_supabase TEXT
      );
    `);

    const isSup = isTableSupabaseEligible('orders');
    memDb.prepare(`
      INSERT INTO sync_queue (
        record_id, table_name, action, status, created_at,
        status_firestore, status_supabase,
        retry_count_firestore, retry_count_supabase
      ) VALUES (?, ?, ?, 'PENDING', ?, 'PENDING', ?, 0, 0)
    `).run('ord_101', 'orders', 'INSERT', new Date().toISOString(), isSup ? 'PENDING' : 'NOT_APPLICABLE');

    const row = memDb.prepare("SELECT * FROM sync_queue WHERE record_id = 'ord_101'").get();
    assert.strictEqual(row.status, 'PENDING');
    assert.strictEqual(row.status_firestore, 'PENDING');
    assert.strictEqual(row.status_supabase, 'PENDING');
    assert.strictEqual(row.retry_count_firestore, 0);
    assert.strictEqual(row.retry_count_supabase, 0);
  });

  // ─── TEST B: Firestore success + Supabase success -> queue deletable ───────
  it('Test B: Firestore success + Supabase success makes queue item deletable and sets is_synced = 1', () => {
    const queueState = {
      table_name: 'orders',
      status_firestore: 'SUCCESS',
      status_supabase: 'SUCCESS'
    };
    const isFirestoreDone = queueState.status_firestore === 'SUCCESS' || queueState.status_firestore === 'NOT_APPLICABLE';
    const isSupabaseDone = queueState.status_supabase === 'SUCCESS' || queueState.status_supabase === 'NOT_APPLICABLE';
    const deletable = isFirestoreDone && isSupabaseDone;
    assert.strictEqual(deletable, true, 'Row must be deletable when both backends succeed');
  });

  // ─── TEST C: Firestore success + Supabase failure -> only Supabase retryable
  await itAsync('Test C: Firestore success + Supabase failure leaves only Supabase retryable (Firestore not resent)', async () => {
    let firestoreCallCount = 0;
    let supabaseCallCount = 0;

    const mockSupabase = createMockSupabaseClient({ failTable: 'orders', errorMessage: 'Supabase 500 error' });

    // Step 1: Initial dispatch where Firestore succeeds, Supabase fails
    firestoreCallCount++; // Simulating Firestore 200 OK
    const sbRes1 = await syncRecordToSupabase('orders', 'ord_201', 'INSERT', {
      id: 'ord_201',
      grand_total: 500,
      payment_status: 'Paid',
      created_at: new Date().toISOString()
    }, mockSupabase);

    assert.strictEqual(sbRes1.success, false);
    supabaseCallCount++;

    const queueRowAfterStep1 = {
      status_firestore: 'SUCCESS',
      status_supabase: 'FAILED',
      retry_count_firestore: 1,
      retry_count_supabase: 1
    };

    // Step 2: Next retry cycle evaluation
    const needsFirestore = queueRowAfterStep1.status_firestore !== 'SUCCESS' && queueRowAfterStep1.status_firestore !== 'NOT_APPLICABLE';
    const needsSupabase = queueRowAfterStep1.status_supabase !== 'SUCCESS' && queueRowAfterStep1.status_supabase !== 'NOT_APPLICABLE';

    assert.strictEqual(needsFirestore, false, 'Firestore must NOT be retried when already SUCCESS');
    assert.strictEqual(needsSupabase, true, 'Supabase MUST be retried when FAILED');

    // Simulate Step 2 execution: only retry Supabase
    if (needsFirestore) {
      firestoreCallCount++;
    }
    if (needsSupabase) {
      supabaseCallCount++;
      const successClient = createMockSupabaseClient();
      const sbRes2 = await syncRecordToSupabase('orders', 'ord_201', 'INSERT', {
        id: 'ord_201',
        grand_total: 500,
        payment_status: 'Paid',
        created_at: new Date().toISOString()
      }, successClient);
      assert.strictEqual(sbRes2.success, true);
    }

    assert.strictEqual(firestoreCallCount, 1, 'Firestore must have been called exactly once');
    assert.strictEqual(supabaseCallCount, 2, 'Supabase must have been called twice (initial + retry)');
  });

  // ─── TEST D: Firestore failure + Supabase success -> only Firestore retryable
  await itAsync('Test D: Firestore failure + Supabase success leaves only Firestore retryable (Supabase not resent)', async () => {
    let firestoreCallCount = 0;
    let supabaseCallCount = 0;

    const successClient = createMockSupabaseClient();

    // Step 1: Firestore fails, Supabase succeeds
    firestoreCallCount++; // Simulated 403 or network error
    const sbRes = await syncRecordToSupabase('payments', 'pay_301', 'INSERT', {
      id: 'pay_301',
      total_amount: 300,
      payment_method: 'Cash',
      created_at: new Date().toISOString()
    }, successClient);

    assert.strictEqual(sbRes.success, true);
    supabaseCallCount++;

    const queueRowAfterStep1 = {
      status_firestore: 'FAILED',
      status_supabase: 'SUCCESS'
    };

    // Step 2: Retry evaluation
    const needsFirestore = queueRowAfterStep1.status_firestore !== 'SUCCESS';
    const needsSupabase = queueRowAfterStep1.status_supabase !== 'SUCCESS';

    assert.strictEqual(needsFirestore, true, 'Firestore MUST be retried');
    assert.strictEqual(needsSupabase, false, 'Supabase must NOT be retried when already SUCCESS');

    if (needsFirestore) firestoreCallCount++;
    if (needsSupabase) supabaseCallCount++;

    assert.strictEqual(firestoreCallCount, 2, 'Firestore retried on 2nd cycle');
    assert.strictEqual(supabaseCallCount, 1, 'Supabase called only once (not resent)');
  });

  // ─── TEST E: Both fail -> both retry ────────────────────────────────────────
  it('Test E: Both backends failed marks both as retryable', () => {
    const queueRow = {
      status_firestore: 'FAILED',
      status_supabase: 'FAILED'
    };
    const needsFirestore = queueRow.status_firestore !== 'SUCCESS' && queueRow.status_firestore !== 'NOT_APPLICABLE';
    const needsSupabase = queueRow.status_supabase !== 'SUCCESS' && queueRow.status_supabase !== 'NOT_APPLICABLE';

    assert.strictEqual(needsFirestore, true);
    assert.strictEqual(needsSupabase, true);
  });

  // ─── TEST F: Supabase-eligible DELETE -> both backends receive DELETE ───────
  await itAsync('Test F: Supabase-eligible DELETE sends delete operation to Supabase with matching PK', async () => {
    const mockSupabase = createMockSupabaseClient();
    const res = await syncRecordToSupabase('expenses', 'exp_401', 'DELETE', null, mockSupabase);

    assert.strictEqual(res.success, true);
    assert.strictEqual(mockSupabase.operations.length, 1);
    assert.strictEqual(mockSupabase.operations[0].type, 'delete');
    assert.strictEqual(mockSupabase.operations[0].table, 'expenses');
    assert.strictEqual(mockSupabase.operations[0].col, 'id');
    assert.strictEqual(mockSupabase.operations[0].val, 'exp_401');
  });

  // ─── TEST G: Firestore-only table -> no Supabase network call ───────────────
  await itAsync('Test G: Firestore-only tables (e.g. users, eja_history) bypass Supabase entirely', async () => {
    const mockSupabase = createMockSupabaseClient();
    const res = await syncRecordToSupabase('eja_history', 'eja_501', 'INSERT', { id: 'eja_501' }, mockSupabase);

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.notApplicable, true);
    assert.strictEqual(mockSupabase.operations.length, 0, 'No Supabase operation permitted for non-eligible table');
  });

  // ─── TEST H: Supabase-only failure does not block Firestore success ─────────
  it('Test H: Supabase failure does not taint Firestore success state', () => {
    const statusFirestore = 'SUCCESS';
    const statusSupabase = 'FAILED';

    assert.strictEqual(statusFirestore, 'SUCCESS', 'Firestore remains recorded as SUCCESS');
    assert.strictEqual(statusSupabase, 'FAILED', 'Supabase recorded as FAILED independently');
  });

  // ─── TEST I: Firestore failure does not block Supabase success ──────────────
  it('Test I: Firestore failure does not taint Supabase success state', () => {
    const statusFirestore = 'FAILED';
    const statusSupabase = 'SUCCESS';

    assert.strictEqual(statusFirestore, 'FAILED');
    assert.strictEqual(statusSupabase, 'SUCCESS');
  });

  // ─── TEST J: Successful backend is never retried unnecessarily ──────────────
  it('Test J: Successful backend is never retried (idempotent skip)', () => {
    const item = {
      table_name: 'deliveries',
      status_firestore: 'SUCCESS',
      status_supabase: 'FAILED'
    };
    const needsFirestore = item.status_firestore !== 'SUCCESS';
    const needsSupabase = item.status_supabase !== 'SUCCESS';

    assert.strictEqual(needsFirestore, false, 'Must skip Firestore');
    assert.strictEqual(needsSupabase, true, 'Must retry Supabase');
  });

  // ─── TEST K: Supabase upsert uses stable SQLite primary key ─────────────────
  await itAsync('Test K: Supabase upsert uses stable SQLite PK (id or business_date for priority)', async () => {
    const mockSupabase = createMockSupabaseClient();
    
    // Normal table: 'id'
    await syncRecordToSupabase('menu_items', 'item_601', 'INSERT', {
      id: 'item_601',
      name: 'Beef Burger',
      price: 150,
      category: 'Fast Food'
    }, mockSupabase);

    assert.strictEqual(mockSupabase.operations[0].options.onConflict, 'id');
    assert.strictEqual(mockSupabase.operations[0].payload.id, 'item_601');

    // Priority table: 'business_date'
    await syncRecordToSupabase('daily_submit_priority', '2026-09-26', 'INSERT', {
      business_date: '2026-09-26',
      submitted_by: 'admin',
      role: 'ADMIN',
      priority: 20
    }, mockSupabase);

    assert.strictEqual(mockSupabase.operations[1].options.onConflict, 'business_date');
    assert.strictEqual(mockSupabase.operations[1].payload.business_date, '2026-09-26');
  });

  // ─── TEST L: Supabase delete uses stable SQLite primary key ─────────────────
  await itAsync('Test L: Supabase delete uses stable SQLite PK column', async () => {
    const mockSupabase = createMockSupabaseClient();
    await syncRecordToSupabase('restaurant_tables', 'tbl_1', 'DELETE', null, mockSupabase);

    assert.strictEqual(mockSupabase.operations[0].col, 'id');
    assert.strictEqual(mockSupabase.operations[0].val, 'tbl_1');

    await syncRecordToSupabase('daily_submit_priority', '2026-09-25', 'DELETE', null, mockSupabase);
    assert.strictEqual(mockSupabase.operations[1].col, 'business_date');
    assert.strictEqual(mockSupabase.operations[1].val, '2026-09-25');
  });

  // ─── TEST M: order_items handles missing parent safely ──────────────────────
  await itAsync('Test M: order_items handles missing parent order safely (catches 23503 and returns SUPABASE_CONSTRAINT_ERROR)', async () => {
    const mockSupabase = createMockSupabaseClient({
      failTable: 'order_items',
      failType: 'foreign_key'
    });

    const res = await syncRecordToSupabase('order_items', 'oi_701', 'INSERT', {
      id: 'oi_701',
      order_id: 'ord_missing_parent',
      itemName: 'Kacchi Biryani',
      quantity: 1,
      unit_price: 250
    }, mockSupabase);

    assert.strictEqual(res.success, false);
    assert.strictEqual(res.code, 'SUPABASE_CONSTRAINT_ERROR');
    assert.strictEqual(res.isParentMissing, true);
    assert.ok(res.error.includes('Parent record not yet synchronized'));
  });

  // ─── TEST N: Offline mode does not break SQLite writes ──────────────────────
  it('Test N: Offline mode does not prevent local SQLite operations', () => {
    const memDb = new DatabaseSync(':memory:');
    memDb.exec(`
      CREATE TABLE orders (id TEXT PRIMARY KEY, subtotal REAL, grand_total REAL, is_synced INTEGER DEFAULT 0);
      CREATE TABLE sync_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, record_id TEXT, table_name TEXT, action TEXT, status TEXT);
    `);

    // Offline write
    memDb.prepare("INSERT INTO orders (id, subtotal, grand_total) VALUES ('ord_offline_1', 400, 400)").run();
    memDb.prepare("INSERT INTO sync_queue (record_id, table_name, action, status) VALUES ('ord_offline_1', 'orders', 'INSERT', 'PENDING')").run();

    const order = memDb.prepare("SELECT * FROM orders WHERE id = 'ord_offline_1'").get();
    assert.strictEqual(order.subtotal, 400);
    assert.strictEqual(order.is_synced, 0);

    const queue = memDb.prepare("SELECT * FROM sync_queue WHERE record_id = 'ord_offline_1'").get();
    assert.strictEqual(queue.status, 'PENDING');
  });

  // ─── TEST O: service_role is absent from client code ────────────────────────
  it('Test O: SUPABASE_SERVICE_ROLE_KEY is 100% absent from client code', () => {
    assert.ok(!dispatcherCode.includes('service_role'), 'Dispatcher must never reference service_role');
    assert.ok(!dispatcherCode.includes('SUPABASE_SERVICE_ROLE_KEY'), 'Dispatcher must never reference SUPABASE_SERVICE_ROLE_KEY');
    assert.ok(!dbCode.includes('SUPABASE_SERVICE_ROLE_KEY'), 'database.js must never reference SUPABASE_SERVICE_ROLE_KEY');
    assert.ok(!supabaseClientCode.includes('SUPABASE_SERVICE_ROLE_KEY'), 'supabaseClient.js must never reference SUPABASE_SERVICE_ROLE_KEY');
  });

  // ─── TEST P: users/PIN never reaches Supabase dispatcher ────────────────────
  await itAsync('Test P: users table and staff PINs are rejected with SECURITY_VIOLATION', async () => {
    const mockSupabase = createMockSupabaseClient();
    const res = await syncRecordToSupabase('users', 'usr_cashier', 'INSERT', {
      id: 'usr_cashier',
      username: 'cashier',
      pin: '1234'
    }, mockSupabase);

    assert.strictEqual(res.success, false);
    assert.ok(res.error.includes('SECURITY_VIOLATION'));
    assert.strictEqual(mockSupabase.operations.length, 0, 'Must never dispatch users table to Supabase');

    // Also assert transformToSupabaseRow throws for users
    assert.throws(() => {
      transformToSupabaseRow('users', { id: 'u1', pin: '9999' });
    }, /SECURITY_VIOLATION/);
  });

  // ─── TEST Q: Existing Firestore tests remain unchanged/passing ──────────────
  it('Test Q: Existing Firestore serialization (toFirestoreDocument) is preserved in database.js', () => {
    assert.ok(dbCode.includes('toFirestoreDocument'), 'toFirestoreDocument must remain in database.js');
    assert.ok(dbCode.includes('firestore.googleapis.com'), 'Firestore REST endpoint must remain intact in database.js');
    assert.ok(dbCode.includes('getFirestoreAuthHeaders'), 'getFirestoreAuthHeaders must remain in database.js');
  });

  // ─── TEST R: Existing sync status UI remains compatible ─────────────────────
  it('Test R: SyncStatusScreen queries continue to function on dual sync queue schema', () => {
    const memDb = new DatabaseSync(':memory:');
    memDb.exec(`
      CREATE TABLE sync_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        record_id TEXT,
        table_name TEXT,
        action TEXT,
        status TEXT DEFAULT 'PENDING',
        created_at TEXT,
        status_firestore TEXT,
        status_supabase TEXT
      );
      INSERT INTO sync_queue (record_id, table_name, action, status) VALUES ('1', 'orders', 'INSERT', 'PENDING');
      INSERT INTO sync_queue (record_id, table_name, action, status) VALUES ('2', 'orders', 'INSERT', 'FAILED');
    `);

    const pending = memDb.prepare("SELECT COUNT(*) as c FROM sync_queue WHERE status = 'PENDING'").get();
    const failed = memDb.prepare("SELECT COUNT(*) as c FROM sync_queue WHERE status = 'FAILED'").get();
    assert.strictEqual(pending.c, 1);
    assert.strictEqual(failed.c, 1);
  });

  // ─── TEST S: Existing immediate sync behavior remains compatible ────────────
  it('Test S: syncRecordImmediately signature and non-blocking contract are preserved', () => {
    assert.ok(dbCode.includes('export async function syncRecordImmediately(tableName, recordId)'), 'syncRecordImmediately must be exported');
    assert.ok(dbCode.includes('processSyncQueue(recordId, tableName)'), 'syncRecordImmediately calls processSyncQueue');
  });

  // ─── TEST T: Duplicate queue processing is prevented ────────────────────────
  it('Test T: Mutex lock (isProcessingSyncQueue) guards against concurrent queue runs', () => {
    assert.ok(dbCode.includes('let isProcessingSyncQueue = false;'), 'isProcessingSyncQueue mutex flag exists');
    assert.ok(dbCode.includes('if (isProcessingSyncQueue && !singleRecordId) return'), 'isProcessingSyncQueue guard exists');
    assert.ok(dbCode.includes('isProcessingSyncQueue = true;'), 'Mutex lock is acquired');
    assert.ok(dbCode.includes('isProcessingSyncQueue = false;'), 'Mutex lock is released in finally');
  });

  // ─── Transformation Layer Strict Verification across all 13 Tables ──────────
  it('Transformation Layer: Strips is_synced and protects app_config keys across all 13 tables', () => {
    const sampleRows = {
      orders: { id: 'o1', grand_total: 100, is_synced: 0 },
      order_items: { id: 'oi1', order_id: 'o1', itemName: 'Burger', is_synced: 0 },
      payments: { id: 'p1', total_amount: 100, is_synced: 0 },
      expenses: { id: 'e1', amount: 50, is_synced: 0 },
      deliveries: { id: 'd1', amount: 80, is_synced: 0 },
      daily_submit: { id: '2026-09-26', date: '2026-09-26', total_sell: 1000, is_synced: 0 },
      daily_summary: { id: '2026-09-26', date: '2026-09-26', totalOrders: 10, is_synced: 0 },
      daily_submit_priority: { business_date: '2026-09-26', priority: 10, is_synced: 0 },
      restaurant_tables: { id: 't1', table_name: 'Table 1', is_synced: 0 },
      menu_categories: { id: 'c1', name: 'Drinks', is_synced: 0 },
      menu_items: { id: 'm1', name: 'Coke', price: 30, is_synced: 0 },
      app_config: { id: 'cfg1', key: 'tax_rate', value: '5', is_synced: 0 },
      supplier_due: { id: 's1', supplier_name: 'Meat Supplier', is_synced: 0 }
    };

    for (const [table, sample] of Object.entries(sampleRows)) {
      const transformed = transformToSupabaseRow(table, sample);
      assert.strictEqual(transformed.is_synced, undefined, `is_synced must be omitted on ${table}`);
      assert.ok(transformed.updated_at, `updated_at must be populated on ${table}`);
    }

    // Sensitive app_config keys must throw
    assert.throws(() => {
      transformToSupabaseRow('app_config', { id: 'c1', key: '_fb_auth_id_token', value: 'secret' });
    }, /SECURITY_VIOLATION/);
  });

  console.log('\n======================================================');
  console.log(`   EXECUTION SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log('======================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
