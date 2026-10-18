/**
 * Phase 10 — ADMIN fresh-install RESTORE SCOPE (row-count proof).
 * Run with: node tests/phase10AdminRestoreScope.test.js
 *
 * Proves the ADMIN restore is "last 31 days", NOT full history:
 *   - transactional tables (incl. daily_submit/daily_summary) are date-bounded to 31d
 *   - master tables (restaurant_tables / menu_items / menu_categories) stay unbounded
 *   - rows older than 31 days are EXCLUDED
 *   - the transition fallback (Supabase coverage < 31d) stays running-day-only Firebase
 *
 * Uses the REAL ADMIN profile lists, extracted from database.js (drift-guarded).
 */

'use strict';
const assert = require('assert');
const fs = require('fs');

console.log('======================================================');
console.log('   PHASE 10 — ADMIN RESTORE SCOPE (ROW COUNTS)        ');
console.log('======================================================\n');

let passed = 0;
let failed = 0;
const tests = [];
function it(desc, fn) { tests.push({ desc, fn }); }

const sync = require('../services/supabaseSync.js');
const dbSrc = fs.readFileSync('database.js', 'utf8');

// --- real ADMIN profile (extracted + drift-guarded) --------------------------
function extractArray(block, key) {
  const re = new RegExp(`${key}:\\s*\\[([\\s\\S]*?)\\]`);
  const m = block.match(re);
  if (!m) return null;
  return (m[1].match(/'([^']+)'/g) || []).map((s) => s.replace(/'/g, ''));
}
const adminBlock = dbSrc.slice(dbSrc.indexOf('ADMIN: {'), dbSrc.indexOf('OWNER: {'));
const ADMIN_RECENT = extractArray(adminBlock, 'recentOnly');
const ADMIN_SKIP = extractArray(adminBlock, 'skipRestoreMarkers');

const TODAY = '2026-09-27';
const TODAY_ISO = new Date(`${TODAY}T00:00:00`).toISOString();
const D31_ISO = new Date(Date.now() - 31 * 86400000).toISOString();

// --- realistic busy-shop dataset: 120 days of history ------------------------
// Ages are deliberately GAPPED around the 31-day boundary (in: ≤29d, out: ≥33d)
// so ms-level drift between the test's cutoff and the code's cutoff can't flip a row.
function gen(perDay, { datePrefix = null } = {}) {
  const out = [];
  const totalDays = 120;
  for (let d = 0; d < totalDays; d++) {
    let age = 120 - d;                       // d=119 → 1 day old
    if (age >= 30 && age <= 32) age = 40;    // push boundary rows clearly outside
    const ts = new Date(Date.now() - age * 86400000).toISOString();
    for (let k = 0; k < perDay; k++) {
      const row = { id: `x${d}_${k}`, updated_at: ts, created_at: ts, _age: age };
      if (datePrefix) row.date = `${datePrefix}${String(d).padStart(3, '0')}`;
      out.push(row);
    }
  }
  return out;
}
const MASTER = {
  menu_items: gen(0, {}).length ? [] : Array.from({ length: 300 }, (_, i) => ({ id: `m${i}`, updated_at: TODAY_ISO })),
  menu_categories: Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, updated_at: TODAY_ISO })),
  restaurant_tables: Array.from({ length: 8 }, (_, i) => ({ id: `table_${i + 1}`, updated_at: TODAY_ISO }))
};
const DATA = {
  orders: gen(45),
  order_items: gen(420),
  payments: gen(45),
  deliveries: gen(25),
  expenses: gen(4),
  due_payments: gen(3),
  eja_history: gen(1),
  off_days: gen(1),
  weather_data: gen(1),
  supplier_payment_ledger: gen(2),
  owner_expenses: gen(2),
  daily_submit: gen(1, { datePrefix: '2026' }),
  daily_summary: gen(1, { datePrefix: '2026' }),
  ...MASTER
};
const inWindow = (rows) => rows.filter((r) => r._age <= 29);
const near31d = (iso) => Math.abs(Date.parse(iso) - (Date.now() - 31 * 86400000)) < 60000;

// --- fakes (client honours .gt) ----------------------------------------------
function makeClient() {
  const calls = [];
  return {
    __calls: calls,
    from(table) {
      const st = { col: null, marker: null, from: 0, to: 999999 };
      const rows = () => {
        const all = DATA[table] || [];
        if (!st.marker) return all.slice();
        return all.filter((r) => r[st.col] != null && String(r[st.col]) > String(st.marker));
      };
      const c = {
        select: () => c, eq: () => c, order: () => c,
        gt: (col, marker) => { st.col = col; st.marker = marker; calls.push({ table, col, marker }); return c; },
        range: (from, to) => { st.from = from; st.to = to; return c; },
        limit: (n) => { st.to = n - 1; return c; },
        maybeSingle: () => Promise.resolve({ data: rows()[0] || null, error: null }),
        then: (res, rej) => Promise.resolve({ data: rows().slice(st.from, st.to + 1), error: null }).then(res, rej)
      };
      return c;
    }
  };
}
function makeDb() {
  const cfg = {};
  const cols = ['id', 'date', 'created_at', 'updated_at', 'is_synced', 'is_synced_supabase'];
  return {
    _cfg: cfg,
    getAllSync(sql) { return /PRAGMA table_info/i.test(sql) ? cols.map((name) => ({ name })) : []; },
    getFirstSync(sql, params = []) {
      if (/PRAGMA table_info/i.test(sql)) return this.getAllSync(sql);
      if (/FROM app_config WHERE key/i.test(sql)) { const v = cfg[params[0]]; return v === undefined ? null : { value: v }; }
      return null;
    },
    runSync(sql, params = []) {
      if (/INSERT OR REPLACE INTO app_config/i.test(sql)) { cfg[params[0]] = params[1]; return; }
      return;
    }
  };
}
function makeFb({ profile = 'ADMIN', resolved = true } = {}) {
  const PROFILES = {
    ADMIN: { recentOnly: ADMIN_RECENT, skipRestoreMarkers: ADMIN_SKIP },
    MANAGER: { recentOnly: ['orders', 'order_items', 'payments', 'expenses', 'deliveries', 'daily_submit', 'daily_summary', 'eja_history'] }
  };
  const getRestoreMode = (p) => {
    const s = String(p || '').toUpperCase().trim();
    if (s === 'MANAGER') return 'today';
    if (s === 'ADMIN' || s === 'OWNER') return '31d';
    return 'today';
  };
  const fb = {
    APP_PROFILES: PROFILES,
    ACTIVE_APP_PROFILE: profile,
    APP_PROFILE_RESOLVED: resolved,
    getBusinessDate: () => TODAY,
    getRestoreMode,
    calls: { restore: [], syncDailyMenu: 0 },
    syncDailyAndMenuFromFirebase: async () => { fb.calls.syncDailyMenu++; return { success: true }; },
    syncMenuOnly: async () => ({ success: true })
  };
  fb.restoreDatabaseFromCloud = async (opts) => {
    fb.calls.restore.push(opts);
    return { success: true, failedCollections: [] };
  };
  return fb;
}
function reset() { sync.__resetSupabaseSyncDepsForTesting(); }

// ---------------------------------------------------------------------------
it('ADMIN profile config (real, drift-guarded) — no supplier_due_history / activity_logs', () => {
  assert.deepStrictEqual(ADMIN_RECENT, ['orders', 'order_items', 'payments', 'expenses', 'deliveries', 'daily_submit', 'daily_summary', 'due_payments', 'eja_history', 'off_days', 'weather_data', 'supplier_payment_ledger', 'owner_expenses'], 'ADMIN.recentOnly');
  assert.deepStrictEqual(ADMIN_SKIP, ['deletions', 'delete_history', 'supplier_due_history'], 'ADMIN.skipRestoreMarkers');
  assert.ok(!ADMIN_RECENT.includes('supplier_due_history'), 'supplier_due_history is NOT restored on fresh install');
  assert.ok(!ADMIN_RECENT.includes('activity_logs'), 'activity_logs is NOT part of the fresh-install restore');
  assert.ok(!ADMIN_RECENT.includes('users'), 'users are restored separately (restoreUsersOnlyForProfile), not by the Supabase window');
});

it('ADMIN: mode resolves to 31d; transactional tables bounded to 31 days', async () => {
  const client = makeClient();
  const fb = makeFb({ profile: 'ADMIN' });
  sync.__setSupabaseSyncDepsForTesting({ isEnabled: () => true, isConfigured: () => true, getClient: () => client, getDb: () => makeDb(), getFirebase: () => fb });

  const res = await sync.restoreSupabaseWindow({ profileName: 'ADMIN' });
  assert.strictEqual(res.success, true, `failed: ${res.failedCollections}`);

  for (const t of ['orders', 'order_items', 'payments', 'deliveries', 'daily_submit', 'daily_summary']) {
    const call = client.__calls.find((c) => c.table === t);
    assert.ok(call, `${t} was queried`);
    assert.ok(near31d(call.marker), `${t} bounded to the 31-day window (marker=${call.marker})`);
    assert.notStrictEqual(call.marker, TODAY_ISO, `${t} is NOT today-only`);
    assert.ok(call.marker, `${t} is NOT unbounded`);
  }
  for (const t of ['menu_items', 'menu_categories', 'restaurant_tables']) {
    assert.strictEqual(client.__calls.filter((c) => c.table === t).length, 0, `${t} fetched with NO date filter (master)`);
  }
  reset();
});

it('ADMIN: >31-day-OLD rows are EXCLUDED (Admin ≠ full history)', async () => {
  const client = makeClient();
  const fb = makeFb({ profile: 'ADMIN' });
  sync.__setSupabaseSyncDepsForTesting({ isEnabled: () => true, isConfigured: () => true, getClient: () => client, getDb: () => makeDb(), getFirebase: () => fb });

  const res = await sync.restoreSupabaseWindow({ profileName: 'ADMIN' });

  const masterRows = 300 + 20 + 8;
  const windowed = [
    'orders', 'order_items', 'payments', 'expenses', 'deliveries', 'due_payments',
    'eja_history', 'off_days', 'weather_data', 'supplier_payment_ledger', 'owner_expenses',
    'daily_submit', 'daily_summary'
  ].reduce((s, t) => s + inWindow(DATA[t]).length, 0);
  const allHistoryTx = [
    'orders', 'order_items', 'payments', 'expenses', 'deliveries', 'due_payments',
    'eja_history', 'off_days', 'weather_data', 'supplier_payment_ledger', 'owner_expenses',
    'daily_submit', 'daily_summary'
  ].reduce((s, t) => s + DATA[t].length, 0);

  assert.strictEqual(res.rowsWritten, masterRows + windowed, `ADMIN rows = master ${masterRows} + window ${windowed}`);
  assert.ok(res.rowsWritten < masterRows + allHistoryTx, 'strictly less than full history ⇒ old rows excluded');
  console.log(`      ADMIN rowsWritten=${res.rowsWritten} (last-31d window=${windowed}); full-history would be ${masterRows + allHistoryTx}`);
  reset();
});

it('ADMIN: daily_submit/daily_summary are 31-day bounded, NOT full history', async () => {
  const client = makeClient();
  const fb = makeFb({ profile: 'ADMIN' });
  sync.__setSupabaseSyncDepsForTesting({ isEnabled: () => true, isConfigured: () => true, getClient: () => client, getDb: () => makeDb(), getFirebase: () => fb });

  await sync.restoreSupabaseWindow({ profileName: 'ADMIN' });
  const ds = client.__calls.find((c) => c.table === 'daily_submit');
  assert.ok(near31d(ds.marker), 'daily_submit bounded to 31d (was unbounded before the fix)');
  assert.ok(inWindow(DATA.daily_submit).length < DATA.daily_submit.length, 'dataset really contains out-of-window daily rows');
  reset();
});

it('ADMIN: transition (Supabase coverage <31d) → running-day-only Firebase, no Supabase window', async () => {
  const client = makeClient();
  const fb = makeFb({ profile: 'ADMIN' });
  // oldest order only ~10 days old → coverage < 31
  DATA.orders = gen(45).slice(-10 * 45);
  sync.__setSupabaseSyncDepsForTesting({ isEnabled: () => true, isConfigured: () => true, getClient: () => client, getDb: () => makeDb(), getFirebase: () => fb });

  const res = await sync.restoreHybridDatabaseFromCloud({ mode: 'today' });
  assert.strictEqual(fb.calls.restore.length, 1, 'Firebase restore invoked once');
  assert.deepStrictEqual(fb.calls.restore[0], { mode: 'today' }, 'transition fallback is running-day only');
  assert.strictEqual(res.success, true);
  reset();
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
