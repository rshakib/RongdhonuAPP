/**
 * Phase 7.2 — Per-backend sync flag (`is_synced_supabase`).
 * Run with: node tests/supabaseSyncFlag.test.js
 *
 * Root cause covered: a single shared `is_synced` flag let a FAST Firebase push
 * flip is_synced=1, so the slower Supabase pull wrongly trusted its still-stale
 * copy and overwrote the fresh local edit (the table flicker). The Supabase merge
 * must gate on `is_synced_supabase`, not `is_synced`.
 */

'use strict';
const assert = require('assert');
const fs = require('fs');

console.log('======================================================');
console.log('   PER-BACKEND SYNC FLAG (is_synced_supabase) TESTS   ');
console.log('======================================================\n');

let passed = 0;
let failed = 0;
const tests = [];
function it(desc, fn) { tests.push({ desc, fn }); }

const sync = require('../services/supabaseSync.js');
const queue = require('../services/supabaseSyncQueue.js');

// ---------------------------------------------------------------------------
// Fake SQLite db
// ---------------------------------------------------------------------------
function makeFakeDb(schema, initial = {}) {
  const tables = {};
  for (const t of Object.keys(schema)) tables[t] = (initial[t] || []).map((r) => ({ ...r }));

  return {
    tables,
    getAllSync(sql) {
      const pragma = sql.match(/PRAGMA table_info\((\w+)\)/i);
      if (pragma) return (schema[pragma[1]] || []).map((name) => ({ name }));
      const m = sql.match(/FROM\s+(\w+)/i);
      let rows = (tables[m ? m[1] : ''] || []).slice();
      if (/status\s*=\s*'PENDING'/.test(sql)) rows = rows.filter((r) => r.status === 'PENDING');
      if (/status\s*=\s*'FAILED'/.test(sql)) rows = rows.filter((r) => r.status === 'FAILED');
      return rows;
    },
    getFirstSync(sql, params = []) {
      if (/PRAGMA table_info/i.test(sql)) return this.getAllSync(sql)[0] || null;
      if (/FROM deletions WHERE table_name = \? AND record_id = \?/i.test(sql)) {
        return (tables.deletions || []).find(
          (r) => String(r.table_name) === String(params[0]) && String(r.record_id) === String(params[1])
        ) || null;
      }
      const m = sql.match(/FROM\s+(\w+)\s+WHERE\s+(\w+)\s*=\s*\?/i);
      if (m) return (tables[m[1]] || []).find((r) => String(r[m[2]]) === String(params[0])) || null;
      return null;
    },
    runSync(sql, params = []) {
      // UPDATE <t> SET is_synced_supabase = 1 WHERE <pk> = ?
      let u = sql.match(/UPDATE\s+(\w+)\s+SET\s+is_synced_supabase\s*=\s*1\s+WHERE\s+(\w+)\s*=\s*\?/i);
      if (u) {
        const row = (tables[u[1]] || []).find((r) => String(r[u[2]]) === String(params[0]));
        if (row) row.is_synced_supabase = 1;
        return;
      }
      // queue bookkeeping (ignored for these tests)
      if (/UPDATE\s+sync_queue_supabase/i.test(sql)) return;
      const ins = sql.match(/INSERT OR REPLACE INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES/i);
      if (ins) {
        const t = ins[1];
        const cols = ins[2].split(',').map((s) => s.trim());
        const row = {};
        cols.forEach((c, i) => { row[c] = params[i]; });
        if (!tables[t]) tables[t] = [];
        const idx = tables[t].findIndex((r) => String(r.id) === String(row.id));
        if (idx >= 0) tables[t][idx] = { ...tables[t][idx], ...row }; else tables[t].push(row);
        return;
      }
      const del = sql.match(/DELETE FROM\s+(\w+)\s+WHERE\s+(\w+)(?:\s+IN|\s*=)\s*\??/i);
      if (del) {
        const t = del[1];
        if (t === 'sync_queue_supabase') tables[t] = (tables[t] || []).filter((r) => r.id !== params[0]);
        return;
      }
    }
  };
}

const SCHEMA = {
  orders: ['id', 'grand_total', 'created_at', 'updated_at', 'is_synced', 'is_synced_supabase'],
  sync_queue_supabase: ['id', 'record_id', 'table_name', 'action', 'status', 'retry_count']
};

const T_EQUAL = '2026-01-01T00:00:00Z';
const T_OLDER = '2025-12-31T00:00:00Z';

// ---------------------------------------------------------------------------
// 1. The exact bug: Firebase done (is_synced=1), Supabase pending → no clobber
// ---------------------------------------------------------------------------
it('SB merge: is_synced=1 but is_synced_supabase=0 → stale cloud does NOT overwrite local', () => {
  const db = makeFakeDb(SCHEMA, {
    orders: [{ id: 'o1', grand_total: 100, updated_at: T_EQUAL, is_synced: 1, is_synced_supabase: 0 }]
  });
  sync.mergeSupabaseRows(db, 'orders', [{ id: 'o1', grand_total: 50, updated_at: T_EQUAL }]);
  assert.strictEqual(db.tables.orders[0].grand_total, 100, 'fresh local edit preserved (was the flicker bug)');

  // older cloud too
  sync.mergeSupabaseRows(db, 'orders', [{ id: 'o1', grand_total: 50, updated_at: T_OLDER }]);
  assert.strictEqual(db.tables.orders[0].grand_total, 100, 'older cloud also does not clobber');
});

it('SB merge: uses ITS OWN flag, not the Firebase flag (is_synced=0 but is_synced_supabase=1 → cloud wins on fallback)', () => {
  const db = makeFakeDb(SCHEMA, {
    orders: [{ id: 'o1', grand_total: 100, updated_at: T_EQUAL, is_synced: 0, is_synced_supabase: 1 }]
  });
  sync.mergeSupabaseRows(db, 'orders', [{ id: 'o1', grand_total: 50, updated_at: T_EQUAL }]);
  assert.strictEqual(db.tables.orders[0].grand_total, 50, 'SB-synced row accepts the (equal-ts) cloud value');
});

it('SB merge: newer cloud still wins regardless of flags', () => {
  const db = makeFakeDb(SCHEMA, {
    orders: [{ id: 'o1', grand_total: 100, updated_at: T_OLDER, is_synced: 1, is_synced_supabase: 0 }]
  });
  sync.mergeSupabaseRows(db, 'orders', [{ id: 'o1', grand_total: 50, updated_at: T_EQUAL }]);
  assert.strictEqual(db.tables.orders[0].grand_total, 50, 'newer cloud data repairs even a pending row');
});

// ---------------------------------------------------------------------------
// 2. Supabase-pulled inserts mark is_synced_supabase=1
// ---------------------------------------------------------------------------
it('SB merge: a Supabase-sourced insert sets is_synced_supabase=1 (and keeps is_synced=1)', () => {
  const db = makeFakeDb(SCHEMA, {});
  sync.mergeSupabaseRows(db, 'orders', [{ id: 'o9', grand_total: 10, updated_at: T_EQUAL }]);
  const r = db.tables.orders[0];
  assert.strictEqual(r.is_synced_supabase, 1, 'pulled FROM Supabase → SB-synced');
  assert.strictEqual(r.is_synced, 1, 'existing behavior preserved');
});

// ---------------------------------------------------------------------------
// 3. After the Supabase push completes, pulls behave normally
// ---------------------------------------------------------------------------
it('after the SB push completes (is_synced_supabase=1), a later pull updates normally', () => {
  const db = makeFakeDb(SCHEMA, {
    orders: [{ id: 'o1', grand_total: 100, updated_at: T_EQUAL, is_synced: 1, is_synced_supabase: 0 }]
  });
  // push completes → service sets the flag
  db.tables.orders[0].is_synced_supabase = 1;
  sync.mergeSupabaseRows(db, 'orders', [{ id: 'o1', grand_total: 77, updated_at: T_EQUAL }]);
  assert.strictEqual(db.tables.orders[0].grand_total, 77, 'normal merge resumes');
});

// ---------------------------------------------------------------------------
// 4. processSupabaseSyncQueue sets is_synced_supabase=1 on success
// ---------------------------------------------------------------------------
it('processSupabaseSyncQueue: successful push marks is_synced_supabase=1 and drains the item', async () => {
  const db = makeFakeDb(SCHEMA, {
    sync_queue_supabase: [{ id: 1, record_id: 'o1', table_name: 'orders', action: 'UPDATE', status: 'PENDING', retry_count: 0 }],
    orders: [{ id: 'o1', grand_total: 100, is_synced: 0, is_synced_supabase: 0 }]
  });
  const client = { rest: { headers: { get: () => 'dev' } }, from: () => ({ upsert: () => Promise.resolve({ error: null }) }) };
  queue.__setSupabaseSyncDepsForTesting({ isConfigured: () => true, isEnabled: () => true, getClient: () => client, getDb: () => db });

  const res = await queue.processSupabaseSyncQueue();
  assert.deepStrictEqual(res, { successfulWrites: 1, failedWrites: 0 });
  assert.strictEqual(db.tables.orders[0].is_synced_supabase, 1, 'flag set on SB success');
  assert.strictEqual(db.tables.sync_queue_supabase.length, 0, 'queue drained');
  queue.__resetSupabaseSyncDepsForTesting();
});

// ---------------------------------------------------------------------------
// 5. Source wiring
// ---------------------------------------------------------------------------
it('wiring: SB merge guards on is_synced_supabase; pushes strip it; enqueue resets it', () => {
  const sb = fs.readFileSync('services/supabaseSync.js', 'utf8');
  assert.ok(sb.includes("Number(localRow.is_synced_supabase || 0) === 0"), 'SB merge guards on its own flag');
  assert.ok(sb.includes("cols.push('is_synced_supabase'); vals.push(1)"), 'SB merge marks pulled rows SB-synced');

  const q = fs.readFileSync('services/supabaseSyncQueue.js', 'utf8');
  assert.ok(q.includes("k === 'is_synced' || k === 'is_synced_supabase'"), 'push payload strips is_synced_supabase');
  assert.ok(q.includes('SET is_synced_supabase = 1 WHERE ${getSupabaseConflictKey(tableName)}'), 'SB success sets the flag');

  const dbcode = fs.readFileSync('database.js', 'utf8');
  assert.ok(dbcode.includes('export function migrateSupabaseSyncFlags()'), 'migration exists');
  assert.ok(dbcode.includes('migrateSupabaseSyncFlags();'), 'migration is called');
  assert.ok(dbcode.includes('SET is_synced_supabase = 0 WHERE ${getLocalRecordPkColumn(tableName)}'), 'enqueueSync resets on edit');
  assert.ok(dbcode.includes("k === 'is_synced' || k === 'is_synced_supabase'"), 'Firestore payload strips the new local-only flag');
  // Firebase guard must remain on is_synced (its own backend).
  assert.ok(dbcode.includes('localRow.is_synced === 0'), 'Firebase merge guard unchanged (is_synced)');
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
