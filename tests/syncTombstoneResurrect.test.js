/**
 * R3/R4 "resurrect" fix — locally-deleted records must not be re-inserted by a
 * pull while the cloud still holds the old row.
 * Run with: node tests/syncTombstoneResurrect.test.js
 *
 * Covers:
 *  - tombstoneStore helpers (isTombstoned / clearTombstone)
 *  - Supabase merge (mergeSupabaseRows) honors tombstones for pulled tables
 *  - Firebase merge wiring (source) uses the same shared helper + log
 *  - enqueueSync clears a stale tombstone on a legitimate add/update
 *  - fresh-install safety (rows without tombstones still insert)
 */

'use strict';
const assert = require('assert');
const fs = require('fs');

console.log('======================================================');
console.log('   SYNC TOMBSTONE / RESURRECT REGRESSION VERIFICATION  ');
console.log('======================================================\n');

let passed = 0;
let failed = 0;
const tests = [];
function it(desc, fn) { tests.push({ desc, fn }); }

const tomb = require('../services/tombstoneStore.js');
const sync = require('../services/supabaseSync.js');

// ---------------------------------------------------------------------------
// Fake SQLite db (supports the 2-param tombstone query + generic merge ops)
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
      return (tables[m ? m[1] : ''] || []).slice();
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
      // 2-param tombstone clear (must be checked BEFORE the generic single-param delete)
      if (/DELETE FROM deletions WHERE table_name = \? AND record_id = \?/i.test(sql)) {
        tables.deletions = (tables.deletions || []).filter(
          (r) => !(String(r.table_name) === String(params[0]) && String(r.record_id) === String(params[1]))
        );
        return;
      }
      const ins = sql.match(/INSERT OR REPLACE INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES/i);
      if (ins) {
        const t = ins[1];
        const cols = ins[2].split(',').map((s) => s.trim());
        const nQ = (sql.match(/\?/g) || []).length;
        const row = {};
        cols.forEach((c, i) => { row[c] = i < nQ ? params[i] : 1; });
        if (!tables[t]) tables[t] = [];
        const idx = tables[t].findIndex((r) => String(r.id) === String(row.id));
        if (idx >= 0) tables[t][idx] = { ...tables[t][idx], ...row }; else tables[t].push(row);
        return;
      }
      const del = sql.match(/DELETE FROM\s+(\w+)\s+WHERE\s+(\w+)\s*=\s*\?/i);
      if (del) {
        const t = del[1];
        if (tables[t]) tables[t] = tables[t].filter((r) => String(r[del[2]]) !== String(params[0]));
        return;
      }
    }
  };
}

const SCHEMA = {
  restaurant_tables: ['id', 'table_name', 'status', 'updated_at', 'is_synced'],
  users: ['id', 'role', 'display_name', 'updated_at', 'is_synced'],
  orders: ['id', 'grand_total', 'updated_at', 'is_synced'],
  menu_items: ['id', 'name', 'price', 'category', 'updated_at', 'is_synced'],
  deletions: ['id', 'table_name', 'record_id', 'created_at', 'updated_at', 'is_synced']
};

const has = (db, table, id) => (db.tables[table] || []).some((r) => String(r.id) === String(id));

// ---------------------------------------------------------------------------
// 1. Helpers
// ---------------------------------------------------------------------------
it('isTombstoned/clearTombstone operate on the (table_name, record_id) key', () => {
  const db = makeFakeDb(SCHEMA, { deletions: [{ id: 'x', table_name: 'menu_items', record_id: 'm1' }] });
  assert.strictEqual(tomb.isTombstoned(db, 'menu_items', 'm1'), true);
  assert.strictEqual(tomb.isTombstoned(db, 'menu_items', 'm2'), false);
  assert.strictEqual(tomb.isTombstoned(db, 'orders', 'm1'), false);
  assert.strictEqual(tomb.isTombstoned(null, 'orders', 'x'), false);

  tomb.clearTombstone(db, 'menu_items', 'm1');
  assert.strictEqual(tomb.isTombstoned(db, 'menu_items', 'm1'), false, 'cleared');
  tomb.clearTombstone(db, 'menu_items', 'nope'); // no-op, must not throw
});

// ---------------------------------------------------------------------------
// 2. Supabase merge honors tombstones (Supabase-PULLED tables)
// ---------------------------------------------------------------------------
it('Supabase merge: tombstoned restaurant_tables row is NOT resurrected; control row is', () => {
  const db = makeFakeDb(SCHEMA, { deletions: [{ id: 'rt', table_name: 'restaurant_tables', record_id: 'table_1' }] });
  sync.mergeSupabaseRows(db, 'restaurant_tables', [
    { id: 'table_1', table_name: 'T1', status: 'FREE', updated_at: '2026-01-01T00:00:00Z' },
    { id: 'table_2', table_name: 'T2', status: 'FREE', updated_at: '2026-01-01T00:00:00Z' }
  ]);
  assert.strictEqual(has(db, 'restaurant_tables', 'table_1'), false, 'deleted row stays deleted');
  assert.strictEqual(has(db, 'restaurant_tables', 'table_2'), true, 'non-tombstoned row merges normally');
});

it('Supabase merge: tombstoned users row is NOT resurrected (low-freq Supabase-pulled table)', () => {
  const db = makeFakeDb(SCHEMA, { deletions: [{ id: 'u', table_name: 'users', record_id: 'u1' }] });
  sync.mergeSupabaseRows(db, 'users', [
    { id: 'u1', role: 'manager', display_name: 'A', updated_at: '2026-01-01T00:00:00Z' },
    { id: 'u2', role: 'owner', display_name: 'B', updated_at: '2026-01-01T00:00:00Z' }
  ]);
  assert.strictEqual(has(db, 'users', 'u1'), false);
  assert.strictEqual(has(db, 'users', 'u2'), true);
});

it('Supabase merge: the deletions table still applies tombstones (fix does not bypass it)', () => {
  const db = makeFakeDb(SCHEMA, { orders: [{ id: 'o1', grand_total: 5, updated_at: '2026-01-01T00:00:00Z' }] });
  sync.mergeSupabaseRows(db, 'deletions', [
    { id: 'd1', table_name: 'orders', record_id: 'o1', updated_at: '2026-01-02T00:00:00Z' }
  ]);
  assert.strictEqual(has(db, 'orders', 'o1'), false, 'tombstone pulled → target row deleted');
});

it('Supabase merge: after a legitimate re-add clears the tombstone, the row merges again', () => {
  const db = makeFakeDb(SCHEMA, { deletions: [{ id: 'rt', table_name: 'restaurant_tables', record_id: 'table_3' }] });
  sync.mergeSupabaseRows(db, 'restaurant_tables', [
    { id: 'table_3', table_name: 'T3', status: 'FREE', updated_at: '2026-01-01T00:00:00Z' }
  ]);
  assert.strictEqual(has(db, 'restaurant_tables', 'table_3'), false, 'blocked while tombstone exists');

  tomb.clearTombstone(db, 'restaurant_tables', 'table_3'); // enqueueSync does this on a re-add
  sync.mergeSupabaseRows(db, 'restaurant_tables', [
    { id: 'table_3', table_name: 'T3', status: 'FREE', updated_at: '2026-01-02T00:00:00Z' }
  ]);
  assert.strictEqual(has(db, 'restaurant_tables', 'table_3'), true, 're-add works after tombstone cleared');
});

// ---------------------------------------------------------------------------
// 2b. FINAL-RESURRECT-2: a tombstone must not block a LEGITIMATE RE-CREATE
//     (the "owner submitted but my device still says pending" bug)
// ---------------------------------------------------------------------------
it('Supabase merge: a NEWER cloud row overrides a stale tombstone (re-create wins)', () => {
  const db = makeFakeDb(SCHEMA, {
    deletions: [{ id: 'ds', table_name: 'orders', record_id: 'o9', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }]
  });
  sync.mergeSupabaseRows(db, 'orders', [
    { id: 'o9', grand_total: 42, updated_at: '2026-01-05T00:00:00Z' } // re-created AFTER the delete
  ]);
  assert.strictEqual(has(db, 'orders', 'o9'), true, 're-created row is inserted');
  assert.strictEqual(tomb.isTombstoned(db, 'orders', 'o9'), false, 'stale tombstone cleared');
});

it('Supabase merge: an OLDER cloud row is still blocked by the tombstone', () => {
  const db = makeFakeDb(SCHEMA, {
    deletions: [{ id: 'ds', table_name: 'orders', record_id: 'o9', created_at: '2026-01-05T00:00:00Z', updated_at: '2026-01-05T00:00:00Z' }]
  });
  sync.mergeSupabaseRows(db, 'orders', [
    { id: 'o9', grand_total: 42, updated_at: '2026-01-01T00:00:00Z' } // older than the delete
  ]);
  assert.strictEqual(has(db, 'orders', 'o9'), false, 'still not resurrected');
  assert.strictEqual(tomb.isTombstoned(db, 'orders', 'o9'), true, 'tombstone kept');
});

it('Supabase merge: a timestamp-less tombstone keeps blocking (safe default)', () => {
  const db = makeFakeDb(SCHEMA, { deletions: [{ id: 'ds', table_name: 'orders', record_id: 'o9' }] });
  sync.mergeSupabaseRows(db, 'orders', [
    { id: 'o9', grand_total: 42, updated_at: '2026-12-31T00:00:00Z' }
  ]);
  assert.strictEqual(has(db, 'orders', 'o9'), false, 'no timestamp ⇒ block (unchanged behavior)');
});

it('source: BOTH merge engines use the time-aware helper', () => {
  const dbCode = fs.readFileSync('database.js', 'utf8');
  const syncCode = fs.readFileSync('services/supabaseSync.js', 'utf8');
  assert.ok(dbCode.includes('isResurrectBlocked(db, table, docId, row.updated_at || row.created_at)'), 'firebase merge');
  assert.ok(syncCode.includes('isResurrectBlocked(db, table, docId, row.updated_at || row.created_at)'), 'supabase merge');
});

// ---------------------------------------------------------------------------
// 2c. FINAL-RESURRECT-3: a PULLED tombstone must not delete a re-created row
//     (otherwise a fresh install re-deletes the restored row all over again)
// ---------------------------------------------------------------------------
it('deletions pull: a STALE tombstone does NOT delete a newer local row (and is not stored)', () => {
  const db = makeFakeDb(SCHEMA, {
    orders: [{ id: 'o9', grand_total: 42, created_at: '2026-01-05T00:00:00Z', updated_at: '2026-01-05T00:00:00Z' }]
  });
  sync.mergeSupabaseRows(db, 'deletions', [
    { id: 'd9', table_name: 'orders', record_id: 'o9', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }
  ]);
  assert.strictEqual(has(db, 'orders', 'o9'), true, 're-created row survives');
  assert.strictEqual(tomb.isTombstoned(db, 'orders', 'o9'), false, 'stale tombstone not stored locally');
});

it('deletions pull: a NEWER tombstone still deletes the local row (unchanged)', () => {
  const db = makeFakeDb(SCHEMA, {
    orders: [{ id: 'o9', grand_total: 42, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }]
  });
  sync.mergeSupabaseRows(db, 'deletions', [
    { id: 'd9', table_name: 'orders', record_id: 'o9', created_at: '2026-01-05T00:00:00Z', updated_at: '2026-01-05T00:00:00Z' }
  ]);
  assert.strictEqual(has(db, 'orders', 'o9'), false, 'still deleted when the tombstone is newer');
});

it('source: BOTH merge engines ignore a stale tombstone on the DELETE side too', () => {
  const dbCode = fs.readFileSync('database.js', 'utf8');
  const syncCode = fs.readFileSync('services/supabaseSync.js', 'utf8');
  assert.ok(dbCode.includes('isTombstoneStale(db, targetTable, targetId, row.updated_at || row.created_at)'), 'firebase delete-guard');
  assert.ok(syncCode.includes('isTombstoneStale(db, row.table_name, row.record_id, row.updated_at || row.created_at)'), 'supabase delete-guard');
});

// ---------------------------------------------------------------------------
// 3. Firebase-pulled decision uses the SAME helper (menu_items)
// ---------------------------------------------------------------------------
it('Firebase-pulled table decision: menu_items tombstone blocks the resurrect', () => {
  const db = makeFakeDb(SCHEMA, { deletions: [{ id: 'm', table_name: 'menu_items', record_id: 'm_pani' }] });
  // The Firebase merge loop performs exactly this check (isTombstoned) before inserting.
  assert.strictEqual(tomb.isTombstoned(db, 'menu_items', 'm_pani'), true, 'menu item would be skipped');
  assert.strictEqual(tomb.isTombstoned(db, 'menu_items', 'm_other'), false, 'other items still pull');
});

// ---------------------------------------------------------------------------
// 4. Fresh-install safety — rows without tombstones all insert
// ---------------------------------------------------------------------------
it('fresh-install safety: a merge with no tombstones inserts every row', () => {
  const db = makeFakeDb(SCHEMA, {});
  const rows = Array.from({ length: 50 }, (_, i) => ({ id: `m${i}`, name: `item${i}`, price: 10, category: 'main', updated_at: '2026-01-01T00:00:00Z' }));
  sync.mergeSupabaseRows(db, 'menu_items', rows);
  assert.strictEqual(db.tables.menu_items.length, 50, 'no stale tombstone blocked the restore');
});

// ---------------------------------------------------------------------------
// 5. Source wiring (the Firebase merge + enqueueSync live in non-exported code)
// ---------------------------------------------------------------------------
it('database.js: pull merge skips tombstoned rows and clears tombstones on re-add', () => {
  const code = fs.readFileSync('database.js', 'utf8');
  assert.ok(/import \{[^}]*isResurrectBlocked[^}]*\} from '\.\/services\/tombstoneStore\.js'/.test(code), 'imports helper');

  const mergeSkip = code.indexOf("if (table !== 'deletions' && isResurrectBlocked(db, table, docId, row.updated_at || row.created_at))");
  const mergeInsert = code.indexOf('INSERT OR REPLACE INTO ${table}');
  assert.ok(mergeSkip > 0 && mergeSkip < mergeInsert, 'tombstone skip precedes the merge insert');
  assert.ok(code.includes('[Sync] Skipped resurrect: ${table}/${docId}, tombstone present'), 'merge logs the skip');

  assert.ok(code.includes('if (action !== \'DELETE\')') && code.includes('clearTombstone(db, tableName, recordId)'), 'enqueueSync clears stale tombstone on add/update');
});

it('services/supabaseSync.js: merge applies the identical tombstone skip + log', () => {
  const code = fs.readFileSync('services/supabaseSync.js', 'utf8');
  assert.ok(/import \{[^}]*isResurrectBlocked[^}]*\} from '\.\/tombstoneStore\.js'/.test(code), 'imports helper');
  const skip = code.indexOf("if (table !== 'deletions' && isResurrectBlocked(db, table, docId, row.updated_at || row.created_at))");
  const ins = code.indexOf('INSERT OR REPLACE INTO ${table}');
  assert.ok(skip > 0 && skip < ins, 'tombstone skip precedes the Supabase merge insert');
  assert.ok(code.includes('[Sync] Skipped resurrect: ${table}/${docId}, tombstone present'), 'logs the skip');
});

it('database.js: updateCompletedOrder tombstones wiped order_items (no duplicate-on-edit)', () => {
  const code = fs.readFileSync('database.js', 'utf8');
  const idx = code.indexOf('export function updateCompletedOrder');
  assert.ok(idx > 0, 'updateCompletedOrder present');
  const seg = code.slice(idx, idx + 2500);
  const tomb = seg.indexOf(`recordDeletion('order_items'`);
  const del = seg.indexOf('DELETE FROM order_items');
  assert.ok(tomb > 0, 'records tombstones for wiped order_items');
  assert.ok(del > 0 && tomb < del, 'tombstone recorded BEFORE the wipe');
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
