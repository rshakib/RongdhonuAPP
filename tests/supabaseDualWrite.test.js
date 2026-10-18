/**
 * Phase 2 — Supabase Dual-Write Queue verification suite.
 * Run with: node tests/supabaseDualWrite.test.js
 *
 * Covers:
 *  - pure helpers (backoff curve, per-table conflict key)
 *  - withTimeout behavior
 *  - SUPABASE-DOWN scenario (a): blank/unconfigured -> dual-write no-ops, DB untouched
 *  - SUPABASE-DOWN scenario (b): black-hole host -> queue marks FAILED + backoff, no throw
 *  - Firebase-untouched wiring invariants (source inspection)
 */

'use strict';
const assert = require('assert');
const fs = require('fs');

console.log('======================================================');
console.log('   PHASE 2 — SUPABASE DUAL-WRITE QUEUE VERIFICATION   ');
console.log('======================================================\n');

let passed = 0;
let failed = 0;
const tests = [];

function it(desc, fn) {
  tests.push({ desc, fn });
}

const queue = require('../services/supabaseSyncQueue.js');
const client = require('../services/supabaseClient.js');

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------
function makeFakeDb(seed = {}) {
  const tables = Object.assign({ sync_queue_supabase: [] }, seed);
  let autoId = tables.sync_queue_supabase.reduce((m, r) => Math.max(m, r.id), 0);

  return {
    tables,
    getAllSync(sql, params = []) {
      const m = sql.match(/FROM\s+(\w+)/i);
      let rows = (tables[m ? m[1] : ''] || []).slice();
      if (/status\s*=\s*'PENDING'/.test(sql)) rows = rows.filter((r) => r.status === 'PENDING');
      if (/status\s*=\s*'FAILED'/.test(sql)) rows = rows.filter((r) => r.status === 'FAILED');
      if (/record_id\s*=\s*\?/.test(sql)) rows = rows.filter((r) => String(r.record_id) === String(params[0]));
      return rows;
    },
    getFirstSync(sql, params = []) {
      const m = sql.match(/FROM\s+(\w+)/i);
      const rows = tables[m ? m[1] : ''] || [];
      if (/WHERE\s+id\s*=\s*\?/i.test(sql)) return rows.find((r) => String(r.id) === String(params[0])) || null;
      if (/WHERE\s+business_date\s*=\s*\?/i.test(sql)) return rows.find((r) => String(r.business_date) === String(params[0])) || null;
      if (/WHERE\s+date\s*=\s*\?/i.test(sql)) return rows.find((r) => String(r.date) === String(params[0])) || null;
      return rows[0] || null;
    },
    runSync(sql, params = []) {
      const t = tables.sync_queue_supabase;
      if (/UPDATE\s+sync_queue_supabase\s+SET\s+last_attempt_at/i.test(sql)) {
        const row = t.find((r) => r.id === params[2]);
        if (row) { row.last_attempt_at = params[0]; row.retry_count = params[1]; }
        return;
      }
      if (/UPDATE\s+sync_queue_supabase\s+SET\s+status\s*=\s*'FAILED'/i.test(sql)) {
        const row = t.find((r) => r.id === params[1]);
        if (row) { row.status = 'FAILED'; row.last_error = params[0]; }
        return;
      }
      if (/DELETE\s+FROM\s+sync_queue_supabase\s+WHERE\s+record_id\s*=\s*\?\s+AND\s+table_name\s*=\s*\?\s+AND\s+status\s*=\s*'PENDING'/i.test(sql)) {
        tables.sync_queue_supabase = t.filter((r) => !(String(r.record_id) === String(params[0]) && r.table_name === params[1] && r.status === 'PENDING'));
        return;
      }
      if (/DELETE\s+FROM\s+sync_queue_supabase\s+WHERE\s+id\s*=/i.test(sql)) {
        tables.sync_queue_supabase = t.filter((r) => r.id !== params[0]);
        return;
      }
      if (/INSERT\s+INTO\s+sync_queue_supabase/i.test(sql)) {
        autoId += 1;
        tables.sync_queue_supabase.push({
          id: autoId, record_id: params[0], table_name: params[1], action: params[2],
          status: 'PENDING', created_at: params[3], retry_count: 0, last_error: null, last_attempt_at: null
        });
        return;
      }
    }
  };
}

function makeFailingClient(err) {
  const calls = [];
  return {
    calls,
    from(table) {
      return {
        upsert(payload) { calls.push({ op: 'upsert', table, payload }); return Promise.reject(err); },
        delete() { return { eq: (col, val) => { calls.push({ op: 'delete', table, col, val }); return Promise.reject(err); } }; }
      };
    }
  };
}

function resetDeps() {
  queue.__resetSupabaseSyncDepsForTesting();
}

// ---------------------------------------------------------------------------
// 1. Pure helpers
// ---------------------------------------------------------------------------
it('Backoff curve: min(10min, 2^retry * 30s) — 30s/60s/120s/…/capped 10min', () => {
  assert.strictEqual(queue.getSupabaseFailedRetryDelayMs(0), 30000);
  assert.strictEqual(queue.getSupabaseFailedRetryDelayMs(1), 60000);
  assert.strictEqual(queue.getSupabaseFailedRetryDelayMs(2), 120000);
  assert.strictEqual(queue.getSupabaseFailedRetryDelayMs(3), 240000);
  assert.strictEqual(queue.getSupabaseFailedRetryDelayMs(4), 480000);
  assert.strictEqual(queue.getSupabaseFailedRetryDelayMs(5), 600000, 'capped at 10 minutes');
  assert.strictEqual(queue.getSupabaseFailedRetryDelayMs(50), 600000);
});

it('Conflict key special-casing: id vs date vs business_date', () => {
  assert.strictEqual(queue.getSupabaseConflictKey('orders'), 'id');
  assert.strictEqual(queue.getSupabaseConflictKey('menu_items'), 'id');
  assert.strictEqual(queue.getSupabaseConflictKey('daily_submit'), 'date');
  assert.strictEqual(queue.getSupabaseConflictKey('daily_summary'), 'date');
  assert.strictEqual(queue.getSupabaseConflictKey('daily_submit_priority'), 'business_date');
});

it('withTimeout: resolves fast when the promise settles', async () => {
  const v = await client.withTimeout(Promise.resolve('ok'), 1000, 'test');
  assert.strictEqual(v, 'ok');
});

it('withTimeout: rejects with a timeout error when the promise hangs', async () => {
  let rejected = false;
  try {
    await client.withTimeout(new Promise(() => {}), 40, 'hang');
  } catch (e) {
    rejected = true;
    assert.ok(/timed out/.test(e.message), 'error mentions timeout');
  }
  assert.strictEqual(rejected, true, 'must reject on timeout');
});

// ---------------------------------------------------------------------------
// 2. SUPABASE-DOWN scenario (a): blank URL / unconfigured
// ---------------------------------------------------------------------------
it('Scenario A (unconfigured): enqueue is a no-op and NEVER touches the DB', () => {
  resetDeps();
  let dbTouched = false;
  const fakeDb = makeFakeDb();
  queue.__setSupabaseSyncDepsForTesting({
    isConfigured: () => false,
    isEnabled: () => true,
    getDb: () => { dbTouched = true; return fakeDb; }
  });

  const enq = queue.enqueueSupabaseSync('orders', 'order_1', 'INSERT');
  assert.strictEqual(enq, false, 'enqueue returns false when unconfigured');
  assert.strictEqual(dbTouched, false, 'DB must not be touched when unconfigured');
  assert.strictEqual(fakeDb.tables.sync_queue_supabase.length, 0);
  resetDeps();
});

it('Scenario A (unconfigured): processSupabaseSyncQueue is a no-op, no throw', async () => {
  resetDeps();
  queue.__setSupabaseSyncDepsForTesting({
    isConfigured: () => false,
    isEnabled: () => true,
    getDb: () => { throw new Error('DB must not be reached'); }
  });
  const res = await queue.processSupabaseSyncQueue();
  assert.deepStrictEqual(res, { successfulWrites: 0, failedWrites: 0 });
  resetDeps();
});

it('Scenario A (kill switch off): enqueue is a no-op even when configured', () => {
  resetDeps();
  let dbTouched = false;
  queue.__setSupabaseSyncDepsForTesting({
    isConfigured: () => true,
    isEnabled: () => false,
    getDb: () => { dbTouched = true; return makeFakeDb(); }
  });
  const enq = queue.enqueueSupabaseSync('orders', 'order_1', 'INSERT');
  assert.strictEqual(enq, false, 'enqueue returns false when disabled');
  assert.strictEqual(dbTouched, false, 'DB must not be touched when disabled');
  resetDeps();
});

it('Kill switch parsing: isSupabaseSyncEnabled defaults true, false only for false/0/off/no', () => {
  const original = process.env.EXPO_PUBLIC_SUPABASE_SYNC_ENABLED;
  try {
    delete process.env.EXPO_PUBLIC_SUPABASE_SYNC_ENABLED;
    assert.strictEqual(client.isSupabaseSyncEnabled(), true, 'default true');
    process.env.EXPO_PUBLIC_SUPABASE_SYNC_ENABLED = 'false';
    assert.strictEqual(client.isSupabaseSyncEnabled(), false);
    process.env.EXPO_PUBLIC_SUPABASE_SYNC_ENABLED = '0';
    assert.strictEqual(client.isSupabaseSyncEnabled(), false);
    process.env.EXPO_PUBLIC_SUPABASE_SYNC_ENABLED = 'true';
    assert.strictEqual(client.isSupabaseSyncEnabled(), true);
  } finally {
    if (original === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_SYNC_ENABLED;
    else process.env.EXPO_PUBLIC_SUPABASE_SYNC_ENABLED = original;
  }
});

// ---------------------------------------------------------------------------
// 3. Enqueue behavior when configured
// ---------------------------------------------------------------------------
it('Enqueue (configured): inserts one PENDING row and is idempotent per record', () => {
  resetDeps();
  const fakeDb = makeFakeDb();
  queue.__setSupabaseSyncDepsForTesting({
    isConfigured: () => true,
    isEnabled: () => true,
    getDb: () => fakeDb
  });

  assert.strictEqual(queue.enqueueSupabaseSync('orders', 'order_1', 'INSERT'), true);
  assert.strictEqual(queue.enqueueSupabaseSync('orders', 'order_1', 'UPDATE'), true);
  const rows = fakeDb.tables.sync_queue_supabase;
  assert.strictEqual(rows.length, 1, 'duplicate pending for same record is collapsed');
  assert.strictEqual(rows[0].action, 'UPDATE', 'latest action wins');
  assert.strictEqual(rows[0].status, 'PENDING');

  assert.strictEqual(queue.enqueueSupabaseSync('app_config', 'global', 'INSERT'), false, 'app_config excluded');
  assert.strictEqual(queue.enqueueSupabaseSync('orders', '_fb_auth_id_token', 'INSERT'), false, 'auth credential record excluded');
  resetDeps();
});

// ---------------------------------------------------------------------------
// 4. SUPABASE-DOWN scenario (b): black-hole host
// ---------------------------------------------------------------------------
it('Scenario B (black-hole): marks item FAILED with retry_count=1 + backoff timestamp, no throw', async () => {
  resetDeps();
  const now = new Date().toISOString();
  const fakeDb = makeFakeDb({
    sync_queue_supabase: [
      { id: 1, record_id: 'order_1', table_name: 'orders', action: 'INSERT', status: 'PENDING', created_at: now, retry_count: 0, last_error: null, last_attempt_at: null }
    ],
    orders: [
      { id: 'order_1', table_id: 'table_1', grand_total: 250, is_synced: 0 }
    ]
  });
  const blackHole = makeFailingClient(new Error('connect ECONNREFUSED 127.0.0.1:9'));
  queue.__setSupabaseSyncDepsForTesting({
    isConfigured: () => true,
    isEnabled: () => true,
    getClient: () => blackHole,
    getDb: () => fakeDb
  });

  const res = await queue.processSupabaseSyncQueue();
  assert.deepStrictEqual(res, { successfulWrites: 0, failedWrites: 1 }, 'reports one failure, no throw');

  const row = fakeDb.tables.sync_queue_supabase[0];
  assert.strictEqual(row.status, 'FAILED', 'row marked FAILED');
  assert.strictEqual(row.retry_count, 1, 'retry_count incremented');
  assert.ok(row.last_attempt_at, 'last_attempt_at recorded');
  assert.ok(/ECONNREFUSED/.test(row.last_error || ''), 'error captured');

  // Payload sent to Supabase must have is_synced stripped.
  assert.strictEqual(blackHole.calls.length, 1);
  assert.strictEqual(blackHole.calls[0].op, 'upsert');
  assert.strictEqual(blackHole.calls[0].payload.id, 'order_1');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(blackHole.calls[0].payload, 'is_synced'), false, 'is_synced stripped from payload');
  resetDeps();
});

it('Scenario B (backoff): the just-failed item is NOT retried on the next immediate cycle', async () => {
  resetDeps();
  const fakeDb = makeFakeDb({
    sync_queue_supabase: [
      { id: 1, record_id: 'order_1', table_name: 'orders', action: 'INSERT', status: 'FAILED', created_at: new Date().toISOString(), retry_count: 1, last_error: 'ECONNREFUSED', last_attempt_at: new Date().toISOString() }
    ]
  });
  const blackHole = makeFailingClient(new Error('connect ECONNREFUSED'));
  queue.__setSupabaseSyncDepsForTesting({
    isConfigured: () => true,
    isEnabled: () => true,
    getClient: () => blackHole,
    getDb: () => fakeDb
  });

  const res = await queue.processSupabaseSyncQueue();
  assert.deepStrictEqual(res, { successfulWrites: 0, failedWrites: 0 }, 'backoff skips the not-yet-due failure');
  assert.strictEqual(blackHole.calls.length, 0, 'no Supabase call made during backoff');
  resetDeps();
});

it('Excluded tables are purged from the queue without any Supabase call', async () => {
  resetDeps();
  const fakeDb = makeFakeDb({
    sync_queue_supabase: [
      { id: 1, record_id: 'global', table_name: 'app_config', action: 'INSERT', status: 'PENDING', created_at: new Date().toISOString(), retry_count: 0, last_error: null, last_attempt_at: null }
    ]
  });
  const blackHole = makeFailingClient(new Error('should not be called'));
  queue.__setSupabaseSyncDepsForTesting({
    isConfigured: () => true,
    isEnabled: () => true,
    getClient: () => blackHole,
    getDb: () => fakeDb
  });
  await queue.processSupabaseSyncQueue();
  assert.strictEqual(fakeDb.tables.sync_queue_supabase.length, 0, 'excluded row purged');
  assert.strictEqual(blackHole.calls.length, 0, 'no network call for excluded table');
  resetDeps();
});

// ---------------------------------------------------------------------------
// 5. Firebase-untouched wiring invariants (source inspection)
// ---------------------------------------------------------------------------
it('database.js: Supabase delegation runs AFTER the Firebase INSERT and in its own try/catch', () => {
  const code = fs.readFileSync('database.js', 'utf8');
  const firebaseInsert = code.indexOf('INSERT INTO sync_queue (record_id, table_name, action');
  const delegation = code.indexOf('PHASE 2 DUAL-WRITE');
  assert.ok(firebaseInsert > 0, 'Firebase INSERT present');
  assert.ok(delegation > firebaseInsert, 'Supabase delegation is after the Firebase INSERT');
  assert.ok(code.includes('catch (supaEnqueueErr)'), 'Supabase delegation has its own isolated catch');
  assert.ok(code.includes("require('./services/supabaseSyncQueue.js')"), 'delegates via lazy require');
});

it('database.js: migrateSupabaseSyncQueue is defined and called from initDatabase', () => {
  const code = fs.readFileSync('database.js', 'utf8');
  assert.ok(code.includes('export function migrateSupabaseSyncQueue()'), 'migration function defined');
  assert.ok(code.includes('CREATE TABLE IF NOT EXISTS sync_queue_supabase'), 'creates sync_queue_supabase');
  const diagCall = code.indexOf('migrateSyncQueueDiagnostics();');
  const supaCall = code.indexOf('migrateSupabaseSyncQueue();', diagCall + 1);
  assert.ok(diagCall > 0 && supaCall > diagCall, 'called in initDatabase after the Firebase diagnostics migration');
});

it('supabaseClient.js: exports device-id + timeout API and preserves dormant-safe auth settings', () => {
  const code = fs.readFileSync('services/supabaseClient.js', 'utf8');
  assert.ok(code.includes('export function setSupabaseDeviceId'), 'setSupabaseDeviceId exported');
  assert.ok(code.includes('export function withTimeout'), 'withTimeout exported');
  assert.ok(code.includes('export function isSupabaseSyncEnabled'), 'isSupabaseSyncEnabled exported');
  assert.ok(code.includes('export const SUPABASE_TIMEOUT_MS'), 'SUPABASE_TIMEOUT_MS exported');
  assert.ok(code.includes('export async function safeSupabaseCallWithTimeout'), 'safeSupabaseCallWithTimeout exported');
  assert.ok(code.includes('persistSession: false'), 'no Supabase auth session');
  assert.ok(code.includes("return Number.isFinite(n) && n > 0 ? n : 4000;"), 'default timeout is 4000ms');
});

it('App.js: setSupabaseDeviceId runs after registerDeviceIfNeeded and the Supabase daemon starts after startSyncService', () => {
  const code = fs.readFileSync('App.js', 'utf8');
  const register = code.indexOf('await registerDeviceIfNeeded({ eventId: coldStartEventId');
  const setDevice = code.indexOf('setSupabaseDeviceId(currentDeviceRec.device_id)');
  assert.ok(register > 0 && setDevice > register, 'setSupabaseDeviceId is after registerDeviceIfNeeded');

  const firebaseDaemon = code.indexOf('startSyncService();');
  const supabaseDaemon = code.indexOf('startSupabaseSyncService();');
  assert.ok(firebaseDaemon > 0 && supabaseDaemon > firebaseDaemon, 'startSupabaseSyncService is after startSyncService');
});

it('supabaseSyncQueue.js: exposes the required API surface', () => {
  const code = fs.readFileSync('services/supabaseSyncQueue.js', 'utf8');
  assert.ok(code.includes('export function enqueueSupabaseSync'), 'enqueueSupabaseSync exported');
  assert.ok(code.includes('export async function processSupabaseSyncQueue'), 'processSupabaseSyncQueue exported');
  assert.ok(code.includes('export function startSupabaseSyncService'), 'startSupabaseSyncService exported');
  assert.ok(code.includes('export async function syncSupabaseRecordImmediately'), 'syncSupabaseRecordImmediately exported');
  assert.ok(code.includes('getSupabaseConflictKey'), 'PK special-casing present');
  assert.ok(code.includes('Math.min(MAX_FAILED_RETRY_DELAY_MS, Math.pow(2, n) * 30000)'), 'exponential backoff present');
  assert.ok(code.includes('withTimeout('), 'uses timeout-bounded Supabase calls');
});

(async () => {
  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log(`  ✅  ${t.desc}`);
    } catch (err) {
      failed++;
      console.error(`  ❌  ${t.desc}`);
      console.error(`      ${err.message}`);
    }
  }

  console.log(`\n------------------------------------------------------`);
  console.log(`Tests Passed: ${passed}`);
  console.log(`Tests Failed: ${failed}`);
  console.log('======================================================\n');

  if (failed > 0) process.exit(1);
})();
