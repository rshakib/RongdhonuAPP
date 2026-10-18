/**
 * Phase 4 — Correctness & Conflict Fixes verification suite.
 * Run with: node tests/phase4Correctness.test.js
 *
 * Covers:
 *  - activity_logs Dhaka business_date fix (getDhakaCalendarDate + wiring)
 *  - daily_submit same-role multi-device tie-breaker (shared comparator)
 *  - identical resolution on the Supabase push path (processSupabaseSyncQueue)
 *  - Firebase path wiring + schema/migration invariants
 */

'use strict';
const assert = require('assert');
const fs = require('fs');

console.log('======================================================');
console.log('   PHASE 4 — CORRECTNESS & CONFLICT FIXES VERIFICATION ');
console.log('======================================================\n');

let passed = 0;
let failed = 0;
const tests = [];

function it(desc, fn) {
  tests.push({ desc, fn });
}

const dhaka = require('../services/dhakaTime.js');
const priority = require('../services/dailySubmitPriority.js');
const queue = require('../services/supabaseSyncQueue.js');

// ---------------------------------------------------------------------------
// Test doubles for the Supabase push path
// ---------------------------------------------------------------------------
function makeFakeDb(seed = {}) {
  const tables = Object.assign(
    { sync_queue_supabase: [], daily_submit: [], daily_submit_priority: [] },
    seed
  );
  let autoId = tables.sync_queue_supabase.reduce((m, r) => Math.max(m, r.id || 0), 0);

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
      if (/WHERE\s+business_date\s*=\s*\?/i.test(sql)) return rows.find((r) => String(r.business_date) === String(params[0])) || null;
      if (/WHERE\s+date\s*=\s*\?/i.test(sql)) return rows.find((r) => String(r.date) === String(params[0])) || null;
      if (/WHERE\s+id\s*=\s*\?/i.test(sql)) return rows.find((r) => String(r.id) === String(params[0])) || null;
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
      if (/DELETE\s+FROM\s+sync_queue_supabase\s+WHERE\s+id\s*=/i.test(sql)) {
        tables.sync_queue_supabase = t.filter((r) => r.id !== params[0]);
        return;
      }
      if (/INSERT\s+INTO\s+sync_queue_supabase/i.test(sql)) {
        autoId += 1;
        tables.sync_queue_supabase.push({ id: autoId, record_id: params[0], table_name: params[1], action: params[2], status: 'PENDING', retry_count: 0, last_error: null, last_attempt_at: null });
        return;
      }
    }
  };
}

function makeRecordingClient(remotePriority = null) {
  const calls = [];
  return {
    calls,
    from(table) {
      return {
        upsert(payload) { calls.push({ op: 'upsert', table, payload }); return Promise.resolve({ error: null }); },
        delete() { return { eq: (col, val) => { calls.push({ op: 'delete', table, col, val }); return Promise.resolve({ error: null }); } }; },
        select(/* cols */) {
          return {
            eq: (col, val) => ({
              maybeSingle: () => {
                calls.push({ op: 'select', table, col, val });
                return Promise.resolve({ data: remotePriority, error: null });
              }
            })
          };
        }
      };
    }
  };
}

function resetDeps() { queue.__resetSupabaseSyncDepsForTesting(); }

function pushDailySubmit(fakeDb, client) {
  queue.__setSupabaseSyncDepsForTesting({
    isConfigured: () => true,
    isEnabled: () => true,
    getClient: () => client,
    getDb: () => fakeDb
  });
  return queue.processSupabaseSyncQueue();
}

// ---------------------------------------------------------------------------
// 1. activity_logs — Dhaka calendar date helper
// ---------------------------------------------------------------------------
it('getDhakaCalendarDate: 00:00–05:59 BST yields TODAY (not the UTC yesterday)', () => {
  assert.strictEqual(dhaka.getDhakaCalendarDate('2026-09-28T00:00:00+06:00'), '2026-09-28');
  assert.strictEqual(dhaka.getDhakaCalendarDate('2026-09-28T00:30:00+06:00'), '2026-09-28');
  assert.strictEqual(dhaka.getDhakaCalendarDate('2026-09-28T03:15:00+06:00'), '2026-09-28');
  assert.strictEqual(dhaka.getDhakaCalendarDate('2026-09-28T05:59:59+06:00'), '2026-09-28');
});

it('getDhakaCalendarDate: late evening stays TODAY and midnight rolls forward', () => {
  assert.strictEqual(dhaka.getDhakaCalendarDate('2026-09-27T23:59:59+06:00'), '2026-09-27');
  assert.strictEqual(dhaka.getDhakaCalendarDate('2026-09-28T00:00:00+06:00'), '2026-09-28');
});

it('getDhakaCalendarDate: is immune to the raw-UTC bug in the early-morning window', () => {
  const instant = '2026-09-28T02:00:00+06:00';
  const buggyUtcDate = new Date(instant).toISOString().split('T')[0];
  assert.strictEqual(buggyUtcDate, '2026-09-27', 'sanity: raw UTC date is yesterday');
  assert.strictEqual(dhaka.getDhakaCalendarDate(instant), '2026-09-28', 'Dhaka date is today');
});

it('getDhakaCalendarDate: accepts Date and epoch inputs', () => {
  const d = new Date('2026-09-28T01:00:00+06:00');
  assert.strictEqual(dhaka.getDhakaCalendarDate(d), '2026-09-28');
  assert.strictEqual(dhaka.getDhakaCalendarDate(d.getTime()), '2026-09-28');
});

it('activityLogger.js uses getDhakaCalendarDate and no longer the raw UTC split', () => {
  const code = fs.readFileSync('services/activityLogger.js', 'utf8');
  assert.ok(code.includes("const resolvedDate = businessDate || getDhakaCalendarDate(now);"), 'default uses Dhaka calendar date');
  assert.ok(!code.includes("now.toISOString().split('T')[0]"), 'raw UTC date must be gone');
  assert.ok(code.includes("from './dhakaTime.js'"), 'imports the shared helper');
});

it('database.js re-exports getDhakaCalendarDate and keeps telemetry helper untouched', () => {
  const code = fs.readFileSync('database.js', 'utf8');
  assert.ok(code.includes("export { getDhakaCalendarDate } from './services/dhakaTime.js';"), 're-exported from database.js');
  // Telemetry 06:00 helper must remain unchanged in appUsageTracker.
  const tracker = fs.readFileSync('services/appUsageTracker.js', 'utf8');
  assert.ok(tracker.includes('export function getDhakaBusinessDate(timestamp = Date.now())'), 'getDhakaBusinessDate still present');
});

// ---------------------------------------------------------------------------
// 2. Shared comparator
// ---------------------------------------------------------------------------
it('priority dominates: higher role priority always wins', () => {
  const owner = { priority: priority.getRolePriority('owner'), submitted_at: '2026-09-28T01:00:00Z' };
  const manager = { priority: priority.getRolePriority('manager'), submitted_at: '2026-09-28T23:00:00Z' };
  assert.strictEqual(priority.compareDailySubmitPriority(owner, manager), 1, 'owner > manager');
  assert.strictEqual(priority.compareDailySubmitPriority(manager, owner), -1, 'manager < owner');
});

it('same priority: the LATER submitted_at wins', () => {
  const later = { priority: 10, submitted_at: '2026-09-28T10:00:00Z', device_id: 'devA' };
  const earlier = { priority: 10, submitted_at: '2026-09-28T09:59:59Z', device_id: 'devB' };
  assert.strictEqual(priority.compareDailySubmitPriority(later, earlier), 1);
  assert.strictEqual(priority.compareDailySubmitPriority(earlier, later), -1);
});

it('exact submitted_at tie: lexicographically greater device_id wins (deterministic)', () => {
  const a = { priority: 10, submitted_at: '2026-09-28T10:00:00Z', device_id: 'devZ' };
  const b = { priority: 10, submitted_at: '2026-09-28T10:00:00Z', device_id: 'devA' };
  assert.strictEqual(priority.compareDailySubmitPriority(a, b), 1);
  assert.strictEqual(priority.compareDailySubmitPriority(b, a), -1);
  assert.strictEqual(priority.compareDailySubmitPriority(a, { ...a }), 0, 'identical -> 0');
});

it('submitted_at fallback to updated_at/created_at, device fallback to sync_source_device', () => {
  const a = { priority: 10, created_at: '2026-09-28T08:00:00Z', sync_source_device: 'devB' };
  const b = { priority: 10, created_at: '2026-09-28T07:00:00Z', sync_source_device: 'devA' };
  assert.strictEqual(priority.compareDailySubmitPriority(a, b), 1, 'later created_at wins');
});

// ---------------------------------------------------------------------------
// 3. Supabase push path — identical resolution
// ---------------------------------------------------------------------------
const DATE = '2026-09-26';

it('Supabase path: remote higher-priority daily_submit wins -> local upload skipped', async () => {
  resetDeps();
  const fakeDb = makeFakeDb({
    sync_queue_supabase: [{ id: 1, record_id: DATE, table_name: 'daily_submit', action: 'INSERT', status: 'PENDING' }],
    daily_submit: [{ id: DATE, date: DATE, total_sell: 100, is_synced: 0 }],
    daily_submit_priority: [{ business_date: DATE, priority: 10, submitted_at: '2026-09-26T10:00:00Z', device_id: 'devLocal' }]
  });
  const client = makeRecordingClient({ priority: 50, submitted_at: '2026-09-26T09:00:00Z', device_id: 'devRemote' });

  const res = await pushDailySubmit(fakeDb, client);
  assert.deepStrictEqual(res, { successfulWrites: 1, failedWrites: 0 });
  assert.strictEqual(fakeDb.tables.sync_queue_supabase.length, 0, 'queue item dropped');
  assert.strictEqual(client.calls.filter((c) => c.op === 'upsert').length, 0, 'no upsert performed');
  assert.strictEqual(client.calls.filter((c) => c.op === 'select').length, 1, 'cloud priority read once');
  resetDeps();
});

it('Supabase path: same priority, remote later submitted_at wins -> skipped', async () => {
  resetDeps();
  const fakeDb = makeFakeDb({
    sync_queue_supabase: [{ id: 1, record_id: DATE, table_name: 'daily_submit', action: 'INSERT', status: 'PENDING' }],
    daily_submit: [{ id: DATE, date: DATE, total_sell: 100, is_synced: 0 }],
    daily_submit_priority: [{ business_date: DATE, priority: 10, submitted_at: '2026-09-26T09:00:00Z', device_id: 'devLocal' }]
  });
  const client = makeRecordingClient({ priority: 10, submitted_at: '2026-09-26T10:00:00Z', device_id: 'devRemote' });

  await pushDailySubmit(fakeDb, client);
  assert.strictEqual(client.calls.filter((c) => c.op === 'upsert').length, 0, 'remote (later) wins -> skip');
  resetDeps();
});

it('Supabase path: same priority, LOCAL later submitted_at -> upload proceeds', async () => {
  resetDeps();
  const fakeDb = makeFakeDb({
    sync_queue_supabase: [{ id: 1, record_id: DATE, table_name: 'daily_submit', action: 'INSERT', status: 'PENDING' }],
    daily_submit: [{ id: DATE, date: DATE, total_sell: 100, is_synced: 0 }],
    daily_submit_priority: [{ business_date: DATE, priority: 10, submitted_at: '2026-09-26T10:00:00Z', device_id: 'devLocal' }]
  });
  const client = makeRecordingClient({ priority: 10, submitted_at: '2026-09-26T09:00:00Z', device_id: 'devRemote' });

  const res = await pushDailySubmit(fakeDb, client);
  assert.deepStrictEqual(res, { successfulWrites: 1, failedWrites: 0 });
  const upserts = client.calls.filter((c) => c.op === 'upsert');
  assert.strictEqual(upserts.length, 1, 'local wins -> upsert performed');
  assert.strictEqual(upserts[0].table, 'daily_submit');
  resetDeps();
});

it('Supabase path: exact tie broken by device_id (remote greater -> skip; local greater -> upload)', async () => {
  resetDeps();
  const ts = '2026-09-26T10:00:00Z';

  const dbRemoteWins = makeFakeDb({
    sync_queue_supabase: [{ id: 1, record_id: DATE, table_name: 'daily_submit', action: 'INSERT', status: 'PENDING' }],
    daily_submit: [{ id: DATE, date: DATE, is_synced: 0 }],
    daily_submit_priority: [{ business_date: DATE, priority: 10, submitted_at: ts, device_id: 'devA' }]
  });
  const clientA = makeRecordingClient({ priority: 10, submitted_at: ts, device_id: 'devZ' });
  await pushDailySubmit(dbRemoteWins, clientA);
  assert.strictEqual(clientA.calls.filter((c) => c.op === 'upsert').length, 0, 'devZ > devA -> remote wins');

  resetDeps();
  const dbLocalWins = makeFakeDb({
    sync_queue_supabase: [{ id: 1, record_id: DATE, table_name: 'daily_submit', action: 'INSERT', status: 'PENDING' }],
    daily_submit: [{ id: DATE, date: DATE, is_synced: 0 }],
    daily_submit_priority: [{ business_date: DATE, priority: 10, submitted_at: ts, device_id: 'devZ' }]
  });
  const clientB = makeRecordingClient({ priority: 10, submitted_at: ts, device_id: 'devA' });
  await pushDailySubmit(dbLocalWins, clientB);
  assert.strictEqual(clientB.calls.filter((c) => c.op === 'upsert').length, 1, 'devZ (local) > devA -> upload');

  resetDeps();
});

it('Supabase path: no cloud priority row -> upload proceeds (fail-open)', async () => {
  resetDeps();
  const fakeDb = makeFakeDb({
    sync_queue_supabase: [{ id: 1, record_id: DATE, table_name: 'daily_submit', action: 'INSERT', status: 'PENDING' }],
    daily_submit: [{ id: DATE, date: DATE, is_synced: 0 }],
    daily_submit_priority: [{ business_date: DATE, priority: 10, submitted_at: '2026-09-26T10:00:00Z', device_id: 'devLocal' }]
  });
  const client = makeRecordingClient(null);
  await pushDailySubmit(fakeDb, client);
  assert.strictEqual(client.calls.filter((c) => c.op === 'upsert').length, 1, 'no remote -> upload');
  resetDeps();
});

// ---------------------------------------------------------------------------
// 4. Firebase path + schema/migration invariants (source inspection)
// ---------------------------------------------------------------------------
it('Firebase processSyncQueue and Supabase queue share the SAME comparator', () => {
  const dbCode = fs.readFileSync('database.js', 'utf8');
  const queueCode = fs.readFileSync('services/supabaseSyncQueue.js', 'utf8');
  assert.ok(dbCode.includes('remotePriorityWins(localPriorityRecord, remotePriorityRecord)'), 'Firebase path uses shared comparator');
  assert.ok(queueCode.includes('remotePriorityWins('), 'Supabase path uses shared comparator');
  assert.ok(dbCode.includes("from './services/dailySubmitPriority.js'"), 'database imports shared module');
  assert.ok(queueCode.includes("from './dailySubmitPriority.js'"), 'supabase queue imports shared module');
  // Firebase path must still read the remote priority doc (untouched semantics).
  assert.ok(dbCode.includes('documents/daily_submit_priority/'), 'Firebase remote priority read preserved');
});

it('schema/migration: daily_submit_priority gains submitted_at + device_id (local + Supabase)', () => {
  const dbCode = fs.readFileSync('database.js', 'utf8');
  assert.ok(dbCode.includes('export function migrateDailySubmitPriorityTiebreaker()'), 'migration defined');
  const diagCall = dbCode.indexOf('migrateSupabaseSyncQueue();');
  const tieCall = dbCode.indexOf('migrateDailySubmitPriorityTiebreaker();', diagCall + 1);
  assert.ok(diagCall > 0 && tieCall > diagCall, 'migration called in initDatabase');
  assert.ok(dbCode.includes('ADD COLUMN submitted_at TEXT'), 'adds submitted_at');
  assert.ok(dbCode.includes('ADD COLUMN device_id TEXT'), 'adds device_id');

  const sql = fs.readFileSync('supabase_full_setup.sql', 'utf8');
  assert.ok(sql.includes('ALTER TABLE public.daily_submit_priority ADD COLUMN IF NOT EXISTS submitted_at TEXT'), 'supabase submitted_at');
  assert.ok(sql.includes('ALTER TABLE public.daily_submit_priority ADD COLUMN IF NOT EXISTS device_id TEXT'), 'supabase device_id');
});

it('saveDailySubmitPriority persists submitted_at + device_id and writes them via enqueueSync', () => {
  const dbCode = fs.readFileSync('database.js', 'utf8');
  assert.ok(/sync_source_device, device_id, submitted_at, created_at, updated_at, is_synced/.test(dbCode), 'INSERT writes new columns');
  assert.ok(dbCode.includes("const deviceId = getPersistentDeviceId() || syncSourceDevice || Platform.OS;"), 'device id resolved from persistent id');
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
