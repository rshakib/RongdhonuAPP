/**
 * Phase 12 — Fresh-install USERS bootstrap must be Supabase-primary.
 * Run with: node tests/phase12UsersBootstrap.test.js
 *
 * Regression guard for the second Firebase-quota blocker found on 2026-09-28:
 * `restoreUsersOnlyForProfile()` ran BEFORE login and was Firebase-only, so an
 * exhausted Firebase read quota (429) left the device with NO local users ⇒ login
 * impossible — even with Supabase healthy. It is now Supabase-first (Firebase is
 * the pre-approval fallback for PENDING devices, which RLS cannot serve).
 */

'use strict';
const assert = require('assert');
const fs = require('fs');

console.log('======================================================');
console.log('   PHASE 12 — USERS BOOTSTRAP (SUPABASE-FIRST)        ');
console.log('======================================================\n');

let passed = 0;
let failed = 0;
const tests = [];
function it(desc, fn) { tests.push({ desc, fn }); }

const sync = require('../services/supabaseSync.js');
const DB_COLS = ['id', 'username', 'display_name', 'pin', 'role', 'is_synced', 'is_synced_supabase'];

function fakeDb() {
  const inserts = [];
  return {
    inserts,
    getAllSync(sql) { return /PRAGMA table_info/i.test(sql) ? DB_COLS.map((name) => ({ name })) : []; },
    getFirstSync() { return null; },
    runSync(sql, params = []) { inserts.push({ sql, params }); }
  };
}
function clientReturning(rows, { error = null, onQuery = null } = {}) {
  const chain = {
    select: () => chain,
    in: (col, val) => { if (onQuery) onQuery(col, val); return chain; },
    then: (res, rej) => Promise.resolve({ data: rows, error }).then(res, rej)
  };
  return { from: () => chain };
}
function setup({ rows, error = null, enabled = true, configured = true, db = fakeDb() } = {}) {
  const seen = { inCall: null };
  sync.__setSupabaseSyncDepsForTesting({
    isEnabled: () => enabled,
    isConfigured: () => configured,
    getClient: () => clientReturning(rows, { error, onQuery: (c, v) => { seen.inCall = { c, v }; } }),
    getDb: () => db
  });
  return { db, seen };
}
function reset() { sync.__resetSupabaseSyncDepsForTesting(); }

// ---------------------------------------------------------------------------
it('Supabase returns users ⇒ inserted locally, count = rows (role-filtered)', async () => {
  const { db, seen } = setup({ rows: [
    { id: 'u1', username: 'admin', display_name: 'Admin', pin: '1234', role: 'admin' },
    { id: 'u2', username: 'mgr', display_name: 'Manager', pin: '9999', role: 'manager' }
  ] });
  const res = await sync.restoreUsersFromSupabase(['admin', 'manager']);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.count, 2);
  assert.strictEqual(db.inserts.length, 2, 'two INSERT OR REPLACE into users');
  assert.ok(db.inserts[0].sql.includes('INSERT OR REPLACE INTO users'), 'uses the users table');
  assert.ok(db.inserts[0].params.includes(1), 'is_synced / is_synced_supabase stamped');
  assert.deepStrictEqual(seen.inCall, { c: 'role', v: ['admin', 'manager'] }, 'role filter applied');
  reset();
});

it('Supabase returns 0 rows (PENDING device / RLS-filtered) ⇒ not success (caller falls back to Firebase)', async () => {
  const { db } = setup({ rows: [] });
  const res = await sync.restoreUsersFromSupabase(['manager']);
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.count, 0);
  assert.strictEqual(db.inserts.length, 0);
  reset();
});

it('Supabase error / disabled ⇒ not success, never throws', async () => {
  let r = await sync.restoreUsersFromSupabase(['manager']);
  reset();
  const r2 = await (async () => { setup({ rows: null, error: { message: 'boom' } }); const x = await sync.restoreUsersFromSupabase(['manager']); reset(); return x; })();
  r = await (async () => { setup({ rows: [], enabled: false }); const x = await sync.restoreUsersFromSupabase(['manager']); reset(); return x; })();
  assert.strictEqual(r.success, false, 'disabled ⇒ no success');
  assert.strictEqual(r2.success, false, 'error ⇒ no success');
});

it('no roles ⇒ not success (guard)', async () => {
  setup({ rows: [{ id: 'u1', role: 'admin' }] });
  const res = await sync.restoreUsersFromSupabase([]);
  assert.strictEqual(res.success, false);
  reset();
});

// ---------------------------------------------------------------------------
it('source: restoreUsersOnlyForProfile tries SUPABASE before FIREBASE', () => {
  const dbCode = fs.readFileSync('database.js', 'utf8');
  const fn = dbCode.slice(dbCode.indexOf('export async function restoreUsersOnlyForProfile'), dbCode.indexOf('export function getLastSyncError'));
  const iSupabase = fn.indexOf('restoreUsersFromSupabase');
  const iFirebase = fn.indexOf('EXPO_PUBLIC_FIREBASE_PROJECT_ID');
  assert.ok(iSupabase > 0, 'Supabase path present');
  assert.ok(iFirebase > iSupabase, 'Firebase path runs only AFTER the Supabase attempt');
  assert.ok(fn.includes('Firebase fallback'), 'documented fallback');
});

it('source: users bootstrap still runs BEFORE login on a fresh install (App.js)', () => {
  const app = fs.readFileSync('App.js', 'utf8');
  const iBootstrap = app.indexOf('await restoreUsersOnlyForProfile()');
  const iTimers = app.indexOf('startSupabaseSyncService()');
  assert.ok(iBootstrap > 0, 'bootstrap call present');
  assert.ok(iBootstrap < iTimers, 'runs during startup init (pre-login timer start)');
});

(async () => {
  for (const t of tests) {
    try { await t.fn(); passed++; console.log(`  ✅  ${t.desc}`); }
    catch (err) { failed++; console.error(`  ❌  ${t.desc}`); console.error(`      ${err.message}`); }
  }
  console.log('\n------------------------------------------------------');
  console.log(`Tests Passed: ${passed}`);
  console.log(`Tests Failed: ${failed}`);
  console.log('======================================================\n');
  if (failed > 0) process.exit(1);
})();
