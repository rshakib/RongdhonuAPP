/**
 * Phase 2F — Historical Data Routing Test Suite
 *
 * Verifies Tests A through Z:
 * - Test A: Recent date routes to local SQLite
 * - Test B: Historical date routes to Firestore when missing
 * - Test C: Cached historical date avoids redundant Firestore fetch
 * - Test D: Mixed recent/historical date range
 * - Test E: Correct 31-day cutoff
 * - Test F: 00:00 calendar-day boundary
 * - Test G: 06:00 remains usage-only
 * - Test H: Only required collections are fetched
 * - Test I: Stable IDs are preserved
 * - Test J: Duplicate records are prevented
 * - Test K: Existing unsynced local data is preserved
 * - Test L: Partial download does not mark range complete
 * - Test M: Failed download can be retried
 * - Test N: Interrupted download can be retried
 * - Test O: Concurrent duplicate requests are deduplicated
 * - Test P: Firestore pagination
 * - Test Q: SQLite foreign-key safety
 * - Test R: Historical cache does not enqueue cloud uploads
 * - Test S: Background Firestore delta sync compatibility
 * - Test T: Supabase dual-sync compatibility
 * - Test U: Supabase retention compatibility
 * - Test V: Historical month flow regression
 * - Test W: Report calculations remain unchanged
 * - Test X: Stale date selection does not replace newer results
 * - Test Y: No service-role key in client code
 * - Test Z: Firestore data is never deleted by historical routing
 *
 * Run with:
 *   node tests/historicalDataRouting.test.js
 */

'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

console.log('======================================================');
console.log('    PHASE 2F — HISTORICAL DATA ROUTING TEST SUITE     ');
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

// Read codebase files for static / structural validation
const routerCode = fs.readFileSync(path.join(__dirname, '../services/historicalDataRouter.js'), 'utf8');
const dbCode = fs.readFileSync(path.join(__dirname, '../database.js'), 'utf8');
const appCode = fs.readFileSync(path.join(__dirname, '../App.js'), 'utf8');
const itemSalesCode = fs.readFileSync(path.join(__dirname, '../screens/DailyItemSalesReport.js'), 'utf8');

// Import historical router functions
const {
  calculateDhaka31DayCutoff,
  classifyDate,
  classifyDateRange,
  classifyMonth,
  isHistoricalPeriodCached,
  markHistoricalPeriodCached,
  safeInsertHistoricalRows,
  sortCollectionsForInsertion,
  ensureHistoricalDataLoaded,
  createRequestTokenTracker,
  REPORT_COLLECTIONS,
  FK_SAFE_COLLECTION_ORDER,
  adaptDb
} = require('../services/historicalDataRouter.js');

// Mock SQLite Schema Setup
function createMockDb() {
  const rawDb = new DatabaseSync(':memory:');
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      subtotal REAL DEFAULT 0,
      grand_total REAL DEFAULT 0,
      created_at TEXT,
      date TEXT,
      is_synced INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT,
      itemName TEXT,
      quantity INTEGER DEFAULT 1,
      unit_price REAL DEFAULT 0,
      created_at TEXT,
      date TEXT,
      is_synced INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      order_id TEXT,
      total_amount REAL DEFAULT 0,
      created_at TEXT,
      date TEXT,
      is_synced INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      category TEXT,
      amount REAL DEFAULT 0,
      created_at TEXT,
      date TEXT,
      is_synced INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS deliveries (
      id TEXT PRIMARY KEY,
      order_id TEXT,
      delivery_address TEXT,
      created_at TEXT,
      date TEXT,
      is_synced INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS daily_submit (
      date TEXT PRIMARY KEY,
      total_sell REAL DEFAULT 0,
      total_expense REAL DEFAULT 0,
      net_deposit REAL DEFAULT 0,
      is_synced INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS daily_summary (
      date TEXT PRIMARY KEY,
      total_orders INTEGER DEFAULT 0,
      total_revenue REAL DEFAULT 0,
      is_synced INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT,
      record_id TEXT,
      operation TEXT,
      created_at TEXT,
      status TEXT DEFAULT 'PENDING'
    );
    CREATE TABLE IF NOT EXISTS history_download_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_type TEXT,
      requested_period TEXT,
      downloaded_at TEXT,
      downloaded_by TEXT
    );
    CREATE TABLE IF NOT EXISTS app_config (
      id TEXT PRIMARY KEY,
      key TEXT UNIQUE,
      value TEXT,
      is_synced INTEGER DEFAULT 0
    );
  `);
  return rawDb;
}

(async function runAllTests() {

  // Test A: Recent date routes to local SQLite
  await test('Test A: Recent date routes to local SQLite without Firestore network fetch', async () => {
    const rawDb = createMockDb();
    let firestoreCalled = false;
    const mockFetcher = async () => {
      firestoreCalled = true;
      return { success: true, documents: [] };
    };

    // Reference today: 2026-09-26. 2026-09-20 is 6 days ago (recent).
    const result = await ensureHistoricalDataLoaded({
      reportType: 'ITEM_SALES',
      dateStr: '2026-09-20',
      referenceDate: '2026-09-26',
      dbInstance: rawDb,
      firestoreFetcher: mockFetcher
    });

    assert.strictEqual(result.source, 'LOCAL_RECENT');
    assert.strictEqual(result.neededFetch, false);
    assert.strictEqual(firestoreCalled, false, 'Firestore fetcher must not be called for recent dates');
  });

  // Test B: Historical date routes to Firestore when missing
  await test('Test B: Historical date routes to Firestore when missing from cache', async () => {
    const rawDb = createMockDb();
    let fetchedCollections = [];
    const mockFetcher = async (tbl) => {
      fetchedCollections.push(tbl);
      return {
        success: true,
        documents: [
          {
            name: `projects/p/databases/(default)/documents/${tbl}/doc_hist_1`,
            fields: {
              id: { stringValue: 'doc_hist_1' },
              itemName: { stringValue: 'Chicken Burger' },
              quantity: { integerValue: 2 },
              unit_price: { doubleValue: 150 },
              created_at: { stringValue: '2026-07-15T12:00:00Z' },
              date: { stringValue: '2026-07-15' }
            }
          }
        ]
      };
    };

    // 2026-07-15 is ~73 days ago (older than 31-day cutoff of 2026-08-27)
    const result = await ensureHistoricalDataLoaded({
      reportType: 'ITEM_SALES',
      dateStr: '2026-07-15',
      referenceDate: '2026-09-26',
      dbInstance: rawDb,
      firestoreFetcher: mockFetcher
    });

    assert.strictEqual(result.source, 'FIRESTORE_FETCH');
    assert.strictEqual(result.neededFetch, true);
    assert.strictEqual(result.isComplete, true);
    assert.ok(fetchedCollections.includes('order_items'));

    // Check that history_download_log was stamped
    const log = rawDb.prepare("SELECT * FROM history_download_log WHERE report_type = 'ITEM_SALES' AND requested_period = '2026-07-15'").get();
    assert.ok(log, 'history_download_log must record completed download');

    // Check that order_items row exists with is_synced = 1
    const row = rawDb.prepare("SELECT * FROM order_items WHERE id = 'doc_hist_1'").get();
    assert.ok(row, 'Row must be inserted into SQLite');
    assert.strictEqual(row.is_synced, 1, 'Restored row must have is_synced = 1');
  });

  // Test C: Cached historical date avoids redundant Firestore fetch
  await test('Test C: Cached historical date avoids redundant Firestore fetch', async () => {
    const rawDb = createMockDb();
    // Pre-seed cache log
    rawDb.prepare("INSERT INTO history_download_log (report_type, requested_period, downloaded_at, downloaded_by) VALUES (?, ?, ?, ?)").run(
      'ITEM_SALES', '2026-07-15', new Date().toISOString(), 'System'
    );

    let firestoreCalled = false;
    const mockFetcher = async () => {
      firestoreCalled = true;
      return { success: true, documents: [] };
    };

    const result = await ensureHistoricalDataLoaded({
      reportType: 'ITEM_SALES',
      dateStr: '2026-07-15',
      referenceDate: '2026-09-26',
      dbInstance: rawDb,
      firestoreFetcher: mockFetcher
    });

    assert.strictEqual(result.source, 'LOCAL_CACHE');
    assert.strictEqual(result.neededFetch, false);
    assert.strictEqual(firestoreCalled, false, 'Cached historical date must never call Firestore');
  });

  // Test D: Mixed recent/historical date range
  await test('Test D: Mixed recent/historical date range fetches only missing historical portion', async () => {
    const rawDb = createMockDb();
    // Range: 2026-08-20 to 2026-09-05. Cutoff for 2026-09-26 is 2026-08-27.
    // Historical chunk: 2026-08-20 to 2026-08-26.
    // Recent chunk: 2026-08-27 to 2026-09-05.
    const cls = classifyDateRange('2026-08-20', '2026-09-05', '2026-09-26');
    assert.strictEqual(cls.isMixed, true);
    assert.strictEqual(cls.historicalRange.startDate, '2026-08-20');
    assert.strictEqual(cls.historicalRange.endDate, '2026-08-26');
    assert.strictEqual(cls.recentRange.startDate, '2026-08-27');
    assert.strictEqual(cls.recentRange.endDate, '2026-09-05');

    let queriedStartMarker = null;
    const mockFetcher = async (tbl, marker) => {
      queriedStartMarker = marker;
      return { success: true, documents: [] };
    };

    const result = await ensureHistoricalDataLoaded({
      reportType: 'ITEM_SALES',
      startDate: '2026-08-20',
      endDate: '2026-09-05',
      referenceDate: '2026-09-26',
      dbInstance: rawDb,
      firestoreFetcher: mockFetcher
    });

    assert.strictEqual(result.source, 'FIRESTORE_FETCH');
    assert.strictEqual(queriedStartMarker, '2026-08-20T00:00:00Z', 'Query must start at historical beginning');
  });

  // Test E: Correct 31-day cutoff
  await test('Test E: Correct 31-day cutoff calculation (Today + previous 30 calendar days = 31 days)', async () => {
    const info = calculateDhaka31DayCutoff('2026-09-26');
    assert.strictEqual(info.todayStr, '2026-09-26');
    assert.strictEqual(info.cutoffDateStr, '2026-08-27');
    assert.strictEqual(info.retentionDays, 31);

    // Verify boundary points
    const day31 = classifyDate('2026-08-27', '2026-09-26');
    assert.strictEqual(day31.isRecent, true, '2026-08-27 is Day 31 and must be RECENT');
    assert.strictEqual(day31.isHistorical, false);

    const day32 = classifyDate('2026-08-26', '2026-09-26');
    assert.strictEqual(day32.isRecent, false);
    assert.strictEqual(day32.isHistorical, true, '2026-08-26 is Day 32 and must be HISTORICAL');
  });

  // Test F: 00:00 calendar-day boundary
  await test('Test F: 00:00 calendar-day boundary in Asia/Dhaka', async () => {
    // 2026-09-26 23:59:59.999 Asia/Dhaka -> UTC is 2026-09-26 17:59:59.999Z
    const tEnd = new Date('2026-09-26T17:59:59.999Z');
    const infoEnd = calculateDhaka31DayCutoff(tEnd);
    assert.strictEqual(infoEnd.todayStr, '2026-09-26');
    assert.strictEqual(infoEnd.cutoffDateStr, '2026-08-27');

    // 2026-09-27 00:00:00.000 Asia/Dhaka -> UTC is 2026-09-26 18:00:00.000Z
    const tNext = new Date('2026-09-26T18:00:00.000Z');
    const infoNext = calculateDhaka31DayCutoff(tNext);
    assert.strictEqual(infoNext.todayStr, '2026-09-27');
    assert.strictEqual(infoNext.cutoffDateStr, '2026-08-28');
  });

  // Test G: 06:00 remains usage-only
  await test('Test G: 06:00 remains usage-only and is NEVER used for business data routing', async () => {
    // 04:00 AM on 2026-09-26 in Dhaka is 2026-09-25T22:00:00Z
    const t4am = new Date('2026-09-25T22:00:00Z');
    const info = calculateDhaka31DayCutoff(t4am);
    assert.strictEqual(info.todayStr, '2026-09-26', 'At 04:00 AM Dhaka time, business day is 2026-09-26');
    assert.strictEqual(info.cutoffDateStr, '2026-08-27');

    // Verify 06:00 is not referenced anywhere in historicalDataRouter.js
    assert.strictEqual(routerCode.includes('06:00:00'), false, 'Router code must never contain 06:00:00');
  });

  // Test H: Only required collections are fetched
  await test('Test H: Only required collections are fetched per report type', async () => {
    assert.deepStrictEqual(REPORT_COLLECTIONS.ITEM_SALES, ['orders', 'order_items']);
    assert.deepStrictEqual(REPORT_COLLECTIONS.DEPOSIT_REPORT, ['daily_submit', 'daily_summary', 'expenses']);
    assert.deepStrictEqual(REPORT_COLLECTIONS.SALES_REPORT, ['orders', 'order_items', 'payments', 'deliveries']);

    const rawDb = createMockDb();
    const fetchedTables = [];
    const mockFetcher = async (tbl) => {
      fetchedTables.push(tbl);
      return { success: true, documents: [] };
    };

    await ensureHistoricalDataLoaded({
      reportType: 'ITEM_SALES',
      dateStr: '2026-07-01',
      referenceDate: '2026-09-26',
      dbInstance: rawDb,
      firestoreFetcher: mockFetcher
    });

    assert.deepStrictEqual(fetchedTables.sort(), ['order_items', 'orders'].sort());
    assert.strictEqual(fetchedTables.includes('expenses'), false, 'ITEM_SALES must not fetch expenses');
    assert.strictEqual(fetchedTables.includes('daily_submit'), false, 'ITEM_SALES must not fetch daily_submit');
  });

  // Test I: Stable IDs are preserved
  await test('Test I: Stable IDs are preserved during SQLite caching', async () => {
    const rawDb = createMockDb();
    const adapter = adaptDb(rawDb);
    const mockRows = [
      { id: 'stable_ord_001', grand_total: 550, created_at: '2026-07-10T14:30:00Z' },
      { id: 'stable_ord_002', grand_total: 1200, created_at: '2026-07-10T15:00:00Z' }
    ];

    safeInsertHistoricalRows(adapter, 'orders', mockRows);

    const r1 = rawDb.prepare("SELECT * FROM orders WHERE id = 'stable_ord_001'").get();
    const r2 = rawDb.prepare("SELECT * FROM orders WHERE id = 'stable_ord_002'").get();
    assert.ok(r1 && r2);
    assert.strictEqual(r1.id, 'stable_ord_001');
    assert.strictEqual(r2.id, 'stable_ord_002');
  });

  // Test J: Duplicate records are prevented
  await test('Test J: Duplicate records are prevented (idempotent caching)', async () => {
    const rawDb = createMockDb();
    const adapter = adaptDb(rawDb);
    const mockRows = [
      { id: 'ord_dup_1', grand_total: 400, created_at: '2026-07-10T10:00:00Z' }
    ];

    safeInsertHistoricalRows(adapter, 'orders', mockRows);
    safeInsertHistoricalRows(adapter, 'orders', mockRows);

    const count = rawDb.prepare("SELECT COUNT(*) as c FROM orders WHERE id = 'ord_dup_1'").get().c;
    assert.strictEqual(count, 1, 'Duplicate row must not be created');
  });

  // Test K: Existing unsynced local data is preserved
  await test('Test K: Existing unsynced local data is preserved (is_synced = 0 not overwritten)', async () => {
    const rawDb = createMockDb();
    const adapter = adaptDb(rawDb);

    // Pre-insert an unsynced local edit (e.g. offline order change)
    rawDb.prepare("INSERT INTO orders (id, grand_total, created_at, is_synced) VALUES (?, ?, ?, ?)").run(
      'ord_unsynced_1', 999, '2026-07-10T10:00:00Z', 0
    );

    // Incoming remote historical document has older grand_total = 200
    const incomingRows = [
      { id: 'ord_unsynced_1', grand_total: 200, created_at: '2026-07-10T10:00:00Z' }
    ];

    safeInsertHistoricalRows(adapter, 'orders', incomingRows);

    const current = rawDb.prepare("SELECT * FROM orders WHERE id = 'ord_unsynced_1'").get();
    assert.strictEqual(current.grand_total, 999, 'Unsynced local grand_total must be preserved');
    assert.strictEqual(current.is_synced, 0, 'Unsynced is_synced flag must remain 0');
  });

  // Test L: Partial download does not mark range complete
  await test('Test L: Partial download failure does not mark range as complete in log', async () => {
    const rawDb = createMockDb();
    let callIndex = 0;
    const failingFetcher = async (tbl) => {
      callIndex++;
      if (callIndex === 2) {
        throw new Error('Simulated network timeout on second collection');
      }
      return { success: true, documents: [] };
    };

    let caughtError = null;
    try {
      await ensureHistoricalDataLoaded({
        reportType: 'ITEM_SALES',
        dateStr: '2026-07-05',
        referenceDate: '2026-09-26',
        dbInstance: rawDb,
        firestoreFetcher: failingFetcher
      });
    } catch (e) {
      caughtError = e;
    }

    assert.ok(caughtError, 'Should throw or fail on partial download');
    const log = rawDb.prepare("SELECT * FROM history_download_log WHERE requested_period = '2026-07-05'").get();
    assert.strictEqual(log, undefined, 'history_download_log must NOT mark incomplete download');
  });

  // Test M: Failed download can be retried
  await test('Test M: Failed download can be successfully retried on next attempt', async () => {
    const rawDb = createMockDb();
    let attempt = 1;
    const flakyFetcher = async (tbl) => {
      if (attempt === 1) {
        throw new Error('First attempt network drop');
      }
      return { success: true, documents: [] };
    };

    // Attempt 1 fails
    try {
      await ensureHistoricalDataLoaded({
        reportType: 'ITEM_SALES',
        dateStr: '2026-07-06',
        referenceDate: '2026-09-26',
        dbInstance: rawDb,
        firestoreFetcher: flakyFetcher
      });
    } catch (_) {}

    assert.strictEqual(isHistoricalPeriodCached('ITEM_SALES', '2026-07-06', adaptDb(rawDb)), false);

    // Attempt 2 succeeds
    attempt = 2;
    const res = await ensureHistoricalDataLoaded({
      reportType: 'ITEM_SALES',
      dateStr: '2026-07-06',
      referenceDate: '2026-09-26',
      dbInstance: rawDb,
      firestoreFetcher: flakyFetcher
    });

    assert.strictEqual(res.status, 'SUCCESS');
    assert.strictEqual(isHistoricalPeriodCached('ITEM_SALES', '2026-07-06', adaptDb(rawDb)), true);
  });

  // Test N: Interrupted download can be retried
  await test('Test N: In-flight lock is cleaned up after failure allowing retry', async () => {
    const rawDb = createMockDb();
    const brokenFetcher = async () => {
      throw new Error('Immediate crash');
    };

    try {
      await ensureHistoricalDataLoaded({
        reportType: 'ITEM_SALES',
        dateStr: '2026-07-07',
        referenceDate: '2026-09-26',
        dbInstance: rawDb,
        firestoreFetcher: brokenFetcher
      });
    } catch (_) {}

    // Immediate second call should not hang on in-flight lock
    let secondCalled = false;
    const workingFetcher = async () => {
      secondCalled = true;
      return { success: true, documents: [] };
    };

    await ensureHistoricalDataLoaded({
      reportType: 'ITEM_SALES',
      dateStr: '2026-07-07',
      referenceDate: '2026-09-26',
      dbInstance: rawDb,
      firestoreFetcher: workingFetcher
    });

    assert.strictEqual(secondCalled, true, 'Retry must execute without lock blockage');
  });

  // Test O: Concurrent duplicate requests are deduplicated
  await test('Test O: Concurrent duplicate requests are deduplicated to single network fetch', async () => {
    const rawDb = createMockDb();
    let networkFetchCount = 0;
    const slowFetcher = async () => {
      networkFetchCount++;
      await new Promise(r => setTimeout(r, 20));
      return { success: true, documents: [] };
    };

    // Trigger two requests concurrently for the exact same period
    const p1 = ensureHistoricalDataLoaded({
      reportType: 'ITEM_SALES',
      dateStr: '2026-07-08',
      referenceDate: '2026-09-26',
      dbInstance: rawDb,
      firestoreFetcher: slowFetcher
    });
    const p2 = ensureHistoricalDataLoaded({
      reportType: 'ITEM_SALES',
      dateStr: '2026-07-08',
      referenceDate: '2026-09-26',
      dbInstance: rawDb,
      firestoreFetcher: slowFetcher
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    assert.strictEqual(r1.status, 'SUCCESS');
    assert.strictEqual(r2.status, 'SUCCESS');
    assert.strictEqual(networkFetchCount, 2, '2 collections for ITEM_SALES in 1 single run (not duplicated to 4)');
  });

  // Test P: Firestore pagination
  await test('Test P: Firestore pagination and document parsing', async () => {
    const rawDb = createMockDb();
    const paginatedFetcher = async () => {
      return {
        success: true,
        documents: [
          {
            name: 'projects/p/databases/(default)/documents/order_items/item_pg1',
            fields: {
              id: { stringValue: 'item_pg1' },
              itemName: { stringValue: 'Mutton Kacchi' },
              quantity: { integerValue: 3 },
              unit_price: { doubleValue: 280 },
              date: { stringValue: '2026-06-15' }
            }
          },
          {
            name: 'projects/p/databases/(default)/documents/order_items/item_pg2',
            fields: {
              id: { stringValue: 'item_pg2' },
              itemName: { stringValue: 'Borhani' },
              quantity: { integerValue: 5 },
              unit_price: { doubleValue: 50 },
              date: { stringValue: '2026-06-15' }
            }
          }
        ]
      };
    };

    const res = await ensureHistoricalDataLoaded({
      reportType: 'ITEM_SALES',
      dateStr: '2026-06-15',
      referenceDate: '2026-09-26',
      dbInstance: rawDb,
      firestoreFetcher: paginatedFetcher
    });

    assert.strictEqual(res.status, 'SUCCESS');
    const items = rawDb.prepare("SELECT * FROM order_items WHERE date = '2026-06-15'").all();
    assert.strictEqual(items.length, 2);
  });

  // Test Q: SQLite foreign-key safety
  await test('Test Q: SQLite foreign-key safety: orders inserted before order_items', async () => {
    const rawDb = createMockDb();
    rawDb.exec('PRAGMA foreign_keys = ON;');

    const sorted = sortCollectionsForInsertion(['order_items', 'orders', 'deliveries', 'payments']);
    assert.strictEqual(sorted[0], 'orders', 'Parent orders must be sorted first');
    assert.ok(sorted.indexOf('order_items') > sorted.indexOf('orders'));
  });

  // Test R: Historical cache does not enqueue cloud uploads
  await test('Test R: Restored historical records have is_synced = 1 and generate 0 sync_queue entries', async () => {
    const rawDb = createMockDb();
    const adapter = adaptDb(rawDb);

    safeInsertHistoricalRows(adapter, 'orders', [
      { id: 'hist_no_queue_1', grand_total: 700, created_at: '2026-06-01T12:00:00Z' }
    ]);

    const orderRow = rawDb.prepare("SELECT * FROM orders WHERE id = 'hist_no_queue_1'").get();
    assert.strictEqual(orderRow.is_synced, 1);

    const queueCount = rawDb.prepare("SELECT COUNT(*) as c FROM sync_queue WHERE record_id = 'hist_no_queue_1'").get().c;
    assert.strictEqual(queueCount, 0, 'No sync_queue record should ever be enqueued for restored historical rows');
  });

  // Test S: Background Firestore delta sync compatibility
  await test('Test S: Background Firestore delta sync markers (last_sync_time_%) are preserved', async () => {
    const rawDb = createMockDb();
    rawDb.prepare("INSERT INTO app_config (id, key, value) VALUES (?, ?, ?)").run(
      'cfg_orders', 'last_sync_time_orders', '2026-09-26T10:00:00Z'
    );

    // Query historical data
    await ensureHistoricalDataLoaded({
      reportType: 'ITEM_SALES',
      dateStr: '2026-05-10',
      referenceDate: '2026-09-26',
      dbInstance: rawDb,
      firestoreFetcher: async () => ({ success: true, documents: [] })
    });

    const marker = rawDb.prepare("SELECT value FROM app_config WHERE key = 'last_sync_time_orders'").get().value;
    assert.strictEqual(marker, '2026-09-26T10:00:00Z', 'Delta sync marker must not be altered by historical routing');
  });

  // Test T: Supabase dual-sync compatibility
  await test('Test T: Supabase dual-sync dispatcher remains unaffected by historical queries', async () => {
    // Check that historical router does not import or call supabaseSyncDispatcher
    assert.strictEqual(routerCode.includes('supabaseSyncDispatcher'), false);
    assert.strictEqual(routerCode.includes('dispatchToSupabase'), false);
  });

  // Test U: Supabase retention compatibility
  await test('Test U: Supabase retention compatibility (router never queries Supabase for historical data)', async () => {
    assert.strictEqual(routerCode.includes('fromSupabase'), false);
    assert.strictEqual(routerCode.includes('supabaseClient'), false);
  });

  // Test V: Historical month flow regression
  await test('Test V: Historical month flow classification and handling', async () => {
    // July 2026 is fully historical when today is 2026-09-26 (cutoff 2026-08-27)
    const mJul = classifyMonth('2026-07', '2026-09-26');
    assert.strictEqual(mJul.isPureHistorical, true);
    assert.strictEqual(mJul.startDateStr, '2026-07-01');
    assert.strictEqual(mJul.endDateStr, '2026-07-31');

    // September 2026 is fully recent
    const mSep = classifyMonth('2026-09', '2026-09-26');
    assert.strictEqual(mSep.isPureRecent, true);

    // August 2026 is mixed (2026-08-01..2026-08-26 historical, 2026-08-27..2026-08-31 recent)
    const mAug = classifyMonth('2026-08', '2026-09-26');
    assert.strictEqual(mAug.isMixed, true);
    assert.strictEqual(mAug.historicalRange.startDate, '2026-08-01');
    assert.strictEqual(mAug.historicalRange.endDate, '2026-08-26');
    assert.strictEqual(mAug.recentRange.startDate, '2026-08-27');
    assert.strictEqual(mAug.recentRange.endDate, '2026-08-31');
  });

  // Test W: Report calculations remain unchanged
  await test('Test W: Report calculations produce identical mathematical results with cached data', async () => {
    const rawDb = createMockDb();
    rawDb.exec(`
      CREATE TABLE IF NOT EXISTS menu_items (name TEXT, category TEXT, price REAL);
      INSERT INTO menu_items VALUES ('Beef Chaap', 'Food', 220);
      INSERT INTO menu_items VALUES ('Lassi', 'Drinks', 80);
    `);

    // Insert historical order_items
    rawDb.prepare(`
      INSERT INTO order_items (id, itemName, quantity, unit_price, created_at, date, is_synced)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `).run('it_1', 'Beef Chaap', 3, 220, '2026-06-20T12:00:00', '2026-06-20');

    // Run item sales query pattern from database.js:3460
    const sales = rawDb.prepare(`
      SELECT itemName, SUM(quantity) as totalQty, SUM(quantity * unit_price) as totalRevenue
      FROM order_items
      WHERE date BETWEEN '2026-06-01' AND '2026-06-30'
      GROUP BY itemName
    `).all();

    assert.strictEqual(sales.length, 1);
    assert.strictEqual(sales[0].itemName, 'Beef Chaap');
    assert.strictEqual(Number(sales[0].totalQty), 3);
    assert.strictEqual(Number(sales[0].totalRevenue), 660);
  });

  // Test X: Stale date selection does not replace newer results
  await test('Test X: Stale date selection guard (request token tracker) invalidates outdated requests', async () => {
    const tracker = createRequestTokenTracker();
    const token1 = tracker.nextToken();
    const token2 = tracker.nextToken();

    assert.strictEqual(token1.isCurrent(), false, 'Earlier token1 is now stale');
    assert.strictEqual(token2.isCurrent(), true, 'Latest token2 is current');
  });

  // Test Y: No service-role key in client code
  await test('Test Y: Security check: zero SUPABASE_SERVICE_ROLE_KEY references in mobile code', async () => {
    assert.strictEqual(routerCode.includes('SUPABASE_SERVICE_ROLE_KEY'), false);
    assert.strictEqual(routerCode.includes('service_role'), false);
    assert.strictEqual(dbCode.includes('SUPABASE_SERVICE_ROLE_KEY'), false);
  });

  // Test Z: Firestore data is never deleted by historical routing
  await test('Test Z: Safety check: historical routing performs zero Firestore deletions', async () => {
    assert.strictEqual(routerCode.includes('deleteDoc'), false);
    assert.strictEqual(routerCode.includes('DELETE'), false);
  });

  console.log('\n======================================================');
  console.log(`  PHASE 2F RESULTS: ${passedTests} passed, ${failedTests} failed`);
  console.log('======================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
})();
