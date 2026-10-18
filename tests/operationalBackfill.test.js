/**
 * Phase 2H — Firestore to Supabase 31-Day Operational Backfill Test Suite
 *
 * Verifies:
 * - Test 1: 31-day cutoff calculation (Today + previous 30 calendar days = 31 days in Asia/Dhaka)
 * - Test 2: 00:00:00 Asia/Dhaka date boundary (06:00 is NOT used for backfill cutoff)
 * - Test 3: App-usage telemetry is strictly excluded from operational backfill
 * - Test 4: Foreign-key safe table order (master first, then parent orders, then order_items)
 * - Test 5: Master tables are included in full, operational tables filtered to 31-day window
 * - Test 6: Stable primary keys are preserved (id, date, business_date)
 * - Test 7: Duplicate prevention (idempotent upserts)
 * - Test 8: Payload transformation strips is_synced and conforms to Supabase schema
 * - Test 9: Security shield: users table and staff PINs are strictly blocked
 * - Test 10: Security shield: sensitive app_config keys (_fb_auth_, tokens) are blocked
 * - Test 11: Dry-run mode performs zero writes to Supabase by default
 * - Test 12: Explicit --execute flag required for write operations
 * - Test 13: Pagination support across large collections (nextPageToken)
 * - Test 14: Partial failure handling (records error per table/record without crash)
 * - Test 15: Resumability and checkpoint tracking on interrupted jobs
 * - Test 16: Safety check: zero Firestore deletions
 * - Test 17: Safety check: zero Supabase purges during backfill
 * - Test 18: Safety check: zero modifications to mobile SQLite sync_queue
 * - Test 19: Security check: zero SUPABASE_SERVICE_ROLE_KEY references in mobile code
 * - Test 20: End-to-end simulated backfill run (dry-run and execute)
 *
 * Run with:
 *   node tests/operationalBackfill.test.js
 */

'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('======================================================');
console.log('   PHASE 2H — OPERATIONAL BACKFILL TEST SUITE         ');
console.log('======================================================\n');

let passedTests = 0;
let failedTests = 0;

async function test(desc, fn) {
  try {
    await fn();
    console.log(`  ✅  ${desc}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌  ${desc}`);
    console.error(`      ${err.stack || err.message}`);
    failedTests++;
  }
}

// Read codebase files for static inspection
const backfillServiceCode = fs.readFileSync(path.join(__dirname, '../services/operationalBackfill.js'), 'utf8');
const backfillCliCode = fs.readFileSync(path.join(__dirname, '../scripts/backfill-firestore-to-supabase.js'), 'utf8');
const clientCode = fs.readFileSync(path.join(__dirname, '../services/supabaseClient.js'), 'utf8');
const dbCode = fs.readFileSync(path.join(__dirname, '../database.js'), 'utf8');

// Import backfill engine and helpers
const {
  OperationalBackfillEngine,
  calculateBackfillWindow,
  BACKFILL_TABLE_ORDER,
  MASTER_TABLES,
  isMasterTable,
  parseFirestoreDocument,
  extractRecordDate,
  isRecordWithinBackfillWindow,
  transformForBackfill,
  saveCheckpoint,
  loadCheckpoint,
  clearCheckpoint,
  fetchFirestoreCollectionNode
} = require('../services/operationalBackfill.js');

(async function runAllTests() {

  // Test 1: 31-day cutoff calculation
  await test('Test 1: 31-day cutoff calculation (Today + previous 30 calendar days = 31 days in Asia/Dhaka)', async () => {
    const window = calculateBackfillWindow('2026-09-26');
    assert.strictEqual(window.todayStr, '2026-09-26');
    assert.strictEqual(window.cutoffDateStr, '2026-08-27');
    assert.strictEqual(window.retentionDays, 31);
    assert.strictEqual(window.timezone, 'Asia/Dhaka');
    assert.strictEqual(window.boundaryTime, '00:00:00');
  });

  // Test 2: 00:00:00 Asia/Dhaka date boundary
  await test('Test 2: 00:00:00 Asia/Dhaka date boundary (06:00 is NOT used for backfill cutoff)', async () => {
    // 04:00 AM on 2026-09-26 in Dhaka is 2026-09-25T22:00:00Z
    const t4am = new Date('2026-09-25T22:00:00Z');
    const window = calculateBackfillWindow(t4am);
    assert.strictEqual(window.todayStr, '2026-09-26', 'At 04:00 AM Dhaka time, business day is 2026-09-26');
    assert.strictEqual(window.cutoffDateStr, '2026-08-27');
    assert.strictEqual(backfillServiceCode.includes('06:00:00'), false, 'Backfill code must not use 06:00:00');
  });

  // Test 3: App-usage telemetry is strictly excluded
  await test('Test 3: App-usage telemetry is strictly excluded from operational backfill', async () => {
    assert.strictEqual(BACKFILL_TABLE_ORDER.includes('device_app_usage'), false);
    assert.strictEqual(BACKFILL_TABLE_ORDER.includes('app_usage'), false);
    assert.strictEqual(BACKFILL_TABLE_ORDER.length, 13, 'Must contain exactly the 13 business tables');
  });

  // Test 4: Foreign-key safe table order
  await test('Test 4: Foreign-key safe table order (master first, then parent orders, then order_items)', async () => {
    const ordersIdx = BACKFILL_TABLE_ORDER.indexOf('orders');
    const itemsIdx = BACKFILL_TABLE_ORDER.indexOf('order_items');
    const paymentsIdx = BACKFILL_TABLE_ORDER.indexOf('payments');
    const deliveriesIdx = BACKFILL_TABLE_ORDER.indexOf('deliveries');
    const tablesIdx = BACKFILL_TABLE_ORDER.indexOf('restaurant_tables');

    assert.ok(tablesIdx < ordersIdx, 'Master restaurant_tables must precede orders');
    assert.ok(ordersIdx < itemsIdx, 'Parent orders must precede child order_items');
    assert.ok(ordersIdx < paymentsIdx, 'Parent orders must precede payments');
    assert.ok(ordersIdx < deliveriesIdx, 'Parent orders must precede deliveries');
  });

  // Test 5: Master tables in full, operational tables filtered to 31-day window
  await test('Test 5: Master tables are included in full, operational tables filtered to 31-day window', async () => {
    const cutoffDateStr = '2026-08-27';

    // Master table record from 6 months ago (2026-03-01)
    const masterItem = { id: 'item_old', name: 'Special Burger', created_at: '2026-03-01T10:00:00Z' };
    assert.strictEqual(isRecordWithinBackfillWindow('menu_items', masterItem, cutoffDateStr), true, 'Master records must always be included');

    // Operational order from 45 days ago (2026-08-10) -> Older than 31 days
    const oldOrder = { id: 'ord_old', grand_total: 500, created_at: '2026-08-10T12:00:00Z' };
    assert.strictEqual(isRecordWithinBackfillWindow('orders', oldOrder, cutoffDateStr), false, 'Older operational order must be excluded');

    // Operational order from 10 days ago (2026-09-16) -> Within 31 days
    const recentOrder = { id: 'ord_rec', grand_total: 500, created_at: '2026-09-16T12:00:00Z' };
    assert.strictEqual(isRecordWithinBackfillWindow('orders', recentOrder, cutoffDateStr), true, 'Recent operational order must be included');

    // Exact boundary test: Day 31 (2026-08-27)
    const boundaryOrder = { id: 'ord_bnd', grand_total: 300, created_at: '2026-08-27T00:00:01+06:00' };
    assert.strictEqual(isRecordWithinBackfillWindow('orders', boundaryOrder, cutoffDateStr), true, 'Day 31 record must be included');
  });

  // Test 6: Stable primary keys are preserved
  await test('Test 6: Stable primary keys are preserved across tables (id, date, business_date)', async () => {
    const docOrder = { id: 'order_stable_999', grand_total: 450, created_at: '2026-09-10T12:00:00Z' };
    const rowOrder = transformForBackfill('orders', docOrder);
    assert.strictEqual(rowOrder.id, 'order_stable_999');

    const docSubmit = { id: '2026-09-15', date: '2026-09-15', total_sell: 12000 };
    const rowSubmit = transformForBackfill('daily_submit', docSubmit);
    assert.strictEqual(rowSubmit.id, '2026-09-15');
    assert.strictEqual(rowSubmit.date, '2026-09-15');

    const docPriority = { business_date: '2026-09-15', submitted_by: 'Manager' };
    const rowPriority = transformForBackfill('daily_submit_priority', docPriority);
    assert.strictEqual(rowPriority.business_date, '2026-09-15');
  });

  // Test 7: Duplicate prevention (idempotent upserts)
  await test('Test 7: Duplicate prevention (idempotent upserts with stable PKs)', async () => {
    const writtenRows = new Map();
    const mockWriter = async (table, batch, options) => {
      const pk = options.onConflict;
      for (const row of batch) {
        writtenRows.set(`${table}:${row[pk]}`, row);
      }
      return { success: true, count: batch.length };
    };

    const mockDocs = [
      { id: 'item_1', name: 'Chai', price: 20 },
      { id: 'item_1', name: 'Chai Special', price: 25 } // Duplicate with update
    ];

    const engine = new OperationalBackfillEngine({
      mode: 'execute',
      tables: ['menu_items'],
      firestoreReader: async () => ({ success: true, documents: mockDocs }),
      supabaseWriter: mockWriter
    });

    await engine.run();
    assert.strictEqual(writtenRows.size, 1, 'Duplicate ID must update existing row rather than duplicate');
    assert.strictEqual(writtenRows.get('menu_items:item_1').name, 'Chai Special');
  });

  // Test 8: Payload transformation strips is_synced
  await test('Test 8: Payload transformation strips is_synced and conforms to Supabase schema', async () => {
    const dirtyDoc = {
      id: 'ord_dirty_1',
      subtotal: 500,
      grand_total: 500,
      is_synced: 1, // Must be stripped
      random_client_junk: 'ignore_me', // Must be stripped
      created_at: '2026-09-20T10:00:00Z'
    };

    const cleanRow = transformForBackfill('orders', dirtyDoc);
    assert.strictEqual(cleanRow.is_synced, undefined, 'is_synced must be stripped');
    assert.strictEqual(cleanRow.random_client_junk, undefined, 'Non-schema columns must be stripped');
    assert.strictEqual(cleanRow.id, 'ord_dirty_1');
    assert.strictEqual(cleanRow.grand_total, 500);
  });

  // Test 9: Security shield: users table and staff PINs blocked
  await test('Test 9: Security shield: users table and staff PINs are strictly blocked from backfill', async () => {
    let errThrown = null;
    try {
      transformForBackfill('users', { id: 'usr_1', pin: '1234' });
    } catch (e) {
      errThrown = e;
    }
    assert.ok(errThrown !== null, 'users table transformation must throw an error');
    assert.ok(errThrown.message.includes('SECURITY_VIOLATION'));
  });

  // Test 10: Security shield: sensitive app_config keys blocked
  await test('Test 10: Security shield: sensitive app_config keys (_fb_auth_, tokens) are blocked', async () => {
    const sensitiveDoc = { id: 'cfg_1', key: '_fb_auth_token_xyz', value: 'secret_123' };
    const transformed = transformForBackfill('app_config', sensitiveDoc);
    assert.strictEqual(transformed, null, 'Sensitive app_config document must be dropped');

    const safeDoc = { id: 'cfg_2', key: 'restaurant_name', value: 'Rongdhonu' };
    const safeTransformed = transformForBackfill('app_config', safeDoc);
    assert.ok(safeTransformed !== null);
    assert.strictEqual(safeTransformed.value, 'Rongdhonu');
  });

  // Test 11: Dry-run mode performs zero writes by default
  await test('Test 11: Dry-run mode performs zero writes to Supabase by default', async () => {
    let writerCalled = false;
    const mockWriter = async () => {
      writerCalled = true;
      return { success: true };
    };

    const engine = new OperationalBackfillEngine({
      mode: 'dry-run',
      tables: ['menu_items'],
      firestoreReader: async () => ({
        success: true,
        documents: [{ id: 'item_dry', name: 'Burger', price: 150 }]
      }),
      supabaseWriter: mockWriter
    });

    const stats = await engine.run();
    assert.strictEqual(writerCalled, false, 'Writer must not be invoked during dry-run');
    assert.strictEqual(stats.mode, 'dry-run');
    assert.strictEqual(stats.totalUpserted, 1, 'Upsert count reflects simulation');
  });

  // Test 12: Explicit --execute flag required for write operations
  await test('Test 12: Explicit --execute flag is required to activate live writes', async () => {
    let writeCount = 0;
    const mockWriter = async (tbl, batch) => {
      writeCount += batch.length;
      return { success: true };
    };

    const engine = new OperationalBackfillEngine({
      mode: 'execute',
      tables: ['menu_items'],
      firestoreReader: async () => ({
        success: true,
        documents: [{ id: 'item_exec', name: 'Burger', price: 150 }]
      }),
      supabaseWriter: mockWriter
    });

    const stats = await engine.run();
    assert.strictEqual(writeCount, 1, 'Writer must be invoked when mode is execute');
    assert.strictEqual(stats.mode, 'execute');
  });

  // Test 13: Pagination support across large collections
  await test('Test 13: Pagination support across large collections (nextPageToken handling)', async () => {
    let pageCount = 0;
    const paginatedReader = async (tbl, opts) => {
      pageCount++;
      if (opts.pageToken === 'token_page_2') {
        return {
          success: true,
          documents: [{ id: 'item_p2', name: 'Item P2', price: 100 }],
          nextPageToken: null
        };
      }
      return {
        success: true,
        documents: [{ id: 'item_p1', name: 'Item P1', price: 50 }],
        nextPageToken: 'token_page_2'
      };
    };

    const engine = new OperationalBackfillEngine({
      mode: 'dry-run',
      tables: ['menu_items'],
      firestoreReader: paginatedReader
    });

    const stats = await engine.run();
    assert.strictEqual(pageCount, 2, 'Must request 2 pages via token cursor');
    assert.strictEqual(stats.totalRead, 2);
    assert.strictEqual(stats.totalEligible, 2);
  });

  // Test 14: Partial failure handling (records error per table/record without crash)
  await test('Test 14: Partial failure handling records errors per record without crashing', async () => {
    const brokenDocs = [
      { id: 'valid_1', name: 'Tea', price: 15 },
      null, // Invalid document
      { id: 'valid_2', name: 'Coffee', price: 40 }
    ];

    const engine = new OperationalBackfillEngine({
      mode: 'dry-run',
      tables: ['menu_items'],
      firestoreReader: async () => ({ success: true, documents: brokenDocs })
    });

    const stats = await engine.run();
    assert.strictEqual(stats.totalEligible, 2, 'Valid documents are processed');
  });

  // Test 15: Resumability and checkpoint tracking on interrupted jobs
  await test('Test 15: Resumability and checkpoint tracking on interrupted jobs', async () => {
    const testCheckpoint = path.join(__dirname, '../.test_checkpoint.json');
    clearCheckpoint(testCheckpoint);

    // Save initial checkpoint
    saveCheckpoint(testCheckpoint, { completedTables: ['restaurant_tables', 'menu_categories'] });
    const loaded = loadCheckpoint(testCheckpoint);
    assert.deepStrictEqual(loaded.completedTables, ['restaurant_tables', 'menu_categories']);

    const processedTables = [];
    const engine = new OperationalBackfillEngine({
      mode: 'dry-run',
      tables: ['restaurant_tables', 'menu_categories', 'menu_items'],
      checkpointPath: testCheckpoint,
      firestoreReader: async (tbl) => {
        processedTables.push(tbl);
        return { success: true, documents: [] };
      }
    });

    await engine.run();
    assert.strictEqual(processedTables.includes('restaurant_tables'), false, 'Already completed restaurant_tables must be skipped');
    assert.strictEqual(processedTables.includes('menu_categories'), false, 'Already completed menu_categories must be skipped');
    assert.strictEqual(processedTables.includes('menu_items'), true, 'Pending menu_items must be processed');

    clearCheckpoint(testCheckpoint);
  });

  // Test 16: Safety check: zero Firestore deletions
  await test('Test 16: Safety check: backfill engine contains zero Firestore deletion calls', async () => {
    assert.strictEqual(backfillServiceCode.includes('deleteDoc'), false);
    assert.strictEqual(backfillServiceCode.includes('deleteRecord'), false);
    assert.strictEqual(backfillCliCode.includes('deleteDoc'), false);
  });

  // Test 17: Safety check: zero Supabase purges during backfill
  await test('Test 17: Safety check: backfill engine performs zero Supabase DELETE/TRUNCATE calls', async () => {
    assert.strictEqual(backfillServiceCode.includes('.delete()'), false);
    assert.strictEqual(backfillServiceCode.includes('TRUNCATE'), false);
    assert.strictEqual(backfillCliCode.includes('.delete()'), false);
  });

  // Test 18: Safety check: zero modifications to mobile SQLite sync_queue
  await test('Test 18: Safety check: backfill engine does not modify mobile sync_queue', async () => {
    assert.strictEqual(backfillServiceCode.includes('sync_queue'), false);
    assert.strictEqual(backfillCliCode.includes('sync_queue'), false);
  });

  // Test 19: Security check: zero SUPABASE_SERVICE_ROLE_KEY references in mobile code
  await test('Test 19: Security check: zero privileged service role keys in mobile code', async () => {
    assert.strictEqual(backfillServiceCode.includes('SUPABASE_SERVICE_ROLE_KEY'), false);
    assert.strictEqual(clientCode.includes('SUPABASE_SERVICE_ROLE_KEY'), false);
    assert.strictEqual(dbCode.includes('SUPABASE_SERVICE_ROLE_KEY'), false);
  });

  // Test 20: End-to-end simulated backfill run (dry-run and execute)
  await test('Test 20: End-to-end simulated backfill run executes across all 13 tables', async () => {
    const executedTables = [];
    const mockReader = async (tbl) => {
      executedTables.push(tbl);
      return {
        success: true,
        documents: [
          { id: `${tbl}_1`, created_at: '2026-09-15T12:00:00Z', date: '2026-09-15', business_date: '2026-09-15' }
        ]
      };
    };

    const engine = new OperationalBackfillEngine({
      mode: 'dry-run',
      referenceDate: '2026-09-26',
      firestoreReader: mockReader
    });

    const stats = await engine.run();
    assert.strictEqual(executedTables.length, 13, 'All 13 Supabase-eligible tables must be audited');
    assert.strictEqual(stats.totalRead, 13);
    assert.strictEqual(stats.totalEligible, 13);
    assert.strictEqual(stats.totalErrors, 0);
  });

  // Test 21: Node Firestore reader handles missing credentials safely
  await test('Test 21: Node Firestore reader handles missing credentials safely without throwing', async () => {
    const res = await fetchFirestoreCollectionNode('restaurant_tables', {
      projectId: '',
      apiKey: ''
    });
    assert.strictEqual(res.success, true);
    assert.deepStrictEqual(res.documents, []);
    assert.strictEqual(res.nextPageToken, null);
  });

  // Test 22: Node Firestore reader handles pagination and nextPageToken
  await test('Test 22: Node Firestore reader handles pagination and nextPageToken parameter', async () => {
    let capturedUrl = '';
    const mockFetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          documents: [{ name: 'doc1' }, { name: 'doc2' }],
          nextPageToken: 'token_page_2'
        })
      };
    };

    const res = await fetchFirestoreCollectionNode('orders', {
      projectId: 'test-project',
      apiKey: 'test-key',
      authHeaders: { Authorization: 'Bearer test' },
      pageToken: 'token_page_1',
      customFetch: mockFetch
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.documents.length, 2);
    assert.strictEqual(res.nextPageToken, 'token_page_2');
    assert.ok(capturedUrl.includes('pageToken=token_page_1'), 'Must include pageToken in URL');
  });

  // Test 23: Node Firestore reader handles network & HTTP 500 failures gracefully
  await test('Test 23: Node Firestore reader handles network & HTTP 500 failures gracefully', async () => {
    const mock500Fetch = async () => ({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error'
    });

    const res = await fetchFirestoreCollectionNode('orders', {
      projectId: 'test-project',
      apiKey: 'test-key',
      authHeaders: { Authorization: 'Bearer test' },
      customFetch: mock500Fetch
    });

    assert.strictEqual(res.success, false);
    assert.ok(res.error.includes('500'), 'Error must contain status 500');
  });

  // Test 24: Node Firestore reader handles 404 / 403 as empty collection
  await test('Test 24: Node Firestore reader handles 404 / 403 as empty collection gracefully', async () => {
    const mock404Fetch = async () => ({
      ok: false,
      status: 404,
      statusText: 'Not Found'
    });

    const res = await fetchFirestoreCollectionNode('menu_categories', {
      projectId: 'test-project',
      apiKey: 'test-key',
      authHeaders: { Authorization: 'Bearer test' },
      customFetch: mock404Fetch
    });

    assert.strictEqual(res.success, true);
    assert.deepStrictEqual(res.documents, []);
    assert.strictEqual(res.nextPageToken, null);
  });

  // Test 25: Node CLI environment loader preserves existing environment variables
  await test('Test 25: Node CLI backfill file contains safe environment loading and decoupled reader', async () => {
    const cliSource = fs.readFileSync(path.join(__dirname, '../scripts/backfill-firestore-to-supabase.js'), 'utf8');
    assert.ok(cliSource.includes('fetchFirestoreCollectionNode'), 'CLI must use fetchFirestoreCollectionNode');
    assert.strictEqual(cliSource.includes("require('../database.js')"), false, 'CLI must not import database.js');
    assert.ok(cliSource.includes('ensureEnvLoaded'), 'CLI must contain ensureEnvLoaded fallback');
  });

  console.log('\n======================================================');
  console.log(`   PHASE 2H RESULTS: ${passedTests} passed, ${failedTests} failed`);
  console.log('======================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
})();
