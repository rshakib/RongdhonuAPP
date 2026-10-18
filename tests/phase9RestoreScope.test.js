/**
 * Phase 9 — Fresh-install RESTORE SCOPE (row-count proof).
 * Run with: node tests/phase9RestoreScope.test.js
 *
 * Simulates a Supabase fresh-install restore with a client that HONOURS the
 * `.gt(cursor, marker)` filter, so the returned row counts reflect the real scope:
 *   MANAGER       → running business day only
 *   ADMIN / OWNER → last 31 days
 *   unresolved '' → running business day only (fail-conservative)
 * Master data (menu_items / menu_categories / restaurant_tables) stays unbounded.
 */

'use strict';
const assert = require('assert');
const fs = require('fs');

console.log('======================================================');
console.log('   PHASE 9 — FRESH-INSTALL RESTORE SCOPE (ROW COUNTS)  ');
console.log('======================================================\n');

let passed = 0;
let failed = 0;
const tests = [];
function it(desc, fn) { tests.push({ desc, fn }); }

const sync = require('../services/supabaseSync.js');

const TODAY = '2026-09-27';
const TODAY_ISO = new Date(`${TODAY}T00:00:00`).toISOString(); // same formula the code uses
const D31_ISO = new Date(Date.now() - 31 * 86400000).toISOString();

// --- dataset -----------------------------------------------------------------
// Deterministic: all timestamps are derived from TODAY_ISO (the same formula the
// code uses), never from Date.now(), so the test can't drift with the wall clock.
function mk(n, { today = 0, last31 = 0, datePrefix = null } = {}) {
  const base = Date.parse(TODAY_ISO);
  const out = [];
  for (let i = 0; i < n; i++) {
    let ts;
    if (i < today) ts = new Date(base + 3600000 + i * 1000).toISOString();            // inside today
    else if (i < today + last31) ts = new Date(base - 86400000 - i * 1000).toISOString(); // yesterday: in the 31d window, OUT of today
    else ts = new Date(base - 40 * 86400000 - i * 1000).toISOString();                // older than 31 days
    const row = { id: `r${i}`, updated_at: ts, created_at: ts };
    if (datePrefix) row.date = `${datePrefix}-${String(i).padStart(4, '0')}`;
    out.push(row);
  }
  return out;
}

const DATA = {
  orders: mk(500, { today: 7, last31: 100 }),
  order_items: mk(2000, { today: 20, last31: 600 }),
  payments: mk(10, { today: 1, last31: 5 }),
  expenses: mk(10, { today: 1, last31: 5 }),
  deliveries: mk(10, { today: 1, last31: 5 }),
  eja_history: mk(10, { today: 1, last31: 5 }),
  daily_submit: mk(400, { today: 1, last31: 40, datePrefix: '2026' }),
  daily_summary: mk(400, { today: 1, last31: 40, datePrefix: '2026' }),
  menu_items: mk(300, { today: 300 }),
  menu_categories: mk(20, { today: 20 }),
  restaurant_tables: Array.from({ length: 8 }, (_, i) => ({ id: `table_${i + 1}`, updated_at: TODAY_ISO }))
};

function makeFilteringClient() {
  const calls = [];
  const client = {
    __calls: calls,
    from(table) {
      const state = { col: null, marker: null, from: 0, to: 999999 };
      const materialise = () => {
        const all = DATA[table] || [];
        if (!state.marker) return all.slice();
        // lexicographic comparison — correct for ISO-8601 strings
        return all.filter((r) => {
          const v = r[state.col];
          return v != null && String(v) > String(state.marker);
        });
      };
      const c = {
        select: () => c,
        eq: () => c,
        order: () => c,
        gt: (col, marker) => { state.col = col; state.marker = marker; calls.push({ table, col, marker }); return c; },
        range: (from, to) => { state.from = from; state.to = to; return c; },
        maybeSingle: () => Promise.resolve({ data: materialise()[0] || null, error: null }),
        then: (res, rej) => Promise.resolve({ data: materialise().slice(state.from, state.to + 1), error: null }).then(res, rej)
      };
      return c;
    }
  };
  return client;
}

function makeFakeDb() {
  const cfg = {};
  const store = {};
  const schemaCols = ['id', 'date', 'created_at', 'updated_at', 'is_synced', 'is_synced_supabase'];
  return {
    _cfg: cfg, _store: store,
    getAllSync(sql) {
      const pragma = sql.match(/PRAGMA table_info\((\w+)\)/i);
      if (pragma) return schemaCols.map((name) => ({ name }));
      return [];
    },
    getFirstSync(sql, params = []) {
      if (/PRAGMA table_info/i.test(sql)) return this.getAllSync(sql);
      if (/FROM app_config WHERE key/i.test(sql)) { const v = cfg[params[0]]; return v === undefined ? null : { value: v }; }
      return null;
    },
    runSync(sql, params = []) {
      if (/INSERT OR REPLACE INTO app_config/i.test(sql)) { cfg[params[0]] = params[1]; return; }
      const ins = sql.match(/INSERT OR REPLACE INTO\s+(\w+)\s*\(([^)]+)\)/i);
      if (ins) { (store[ins[1]] = store[ins[1]] || []).push(params[0]); return; }
    }
  };
}

function makeFb(profileName) {
  const PROFILES = {
    ADMIN: { recentOnly: ['orders', 'order_items', 'payments', 'expenses', 'deliveries', 'daily_submit', 'daily_summary', 'due_payments', 'eja_history', 'off_days', 'weather_data', 'supplier_payment_ledger', 'owner_expenses'] },
    MANAGER: { recentOnly: ['orders', 'order_items', 'payments', 'expenses', 'deliveries', 'daily_submit', 'daily_summary', 'eja_history'] }
  };
  // Mirror of database.js getRestoreMode (fail-conservative on unresolved).
  const getRestoreMode = (p) => {
    const s = String(p || '').toUpperCase().trim();
    if (s === 'MANAGER') return 'today';
    if (s === 'ADMIN' || s === 'OWNER') return '31d';
    return 'today';
  };
  return {
    APP_PROFILES: PROFILES,
    ACTIVE_APP_PROFILE: profileName,
    APP_PROFILE_RESOLVED: !!profileName,
    getBusinessDate: () => TODAY,
    getRestoreMode,
    restoreDatabaseFromCloud: async () => ({ success: true, failedCollections: [] }),
    syncDailyAndMenuFromFirebase: async () => ({ success: true }),
    syncMenuOnly: async () => ({ success: true })
  };
}

function setup(profileName) {
  const client = makeFilteringClient();
  sync.__setSupabaseSyncDepsForTesting({
    isEnabled: () => true,
    isConfigured: () => true,
    getClient: () => client,
    getDb: () => makeFakeDb(),
    getFirebase: () => makeFb(profileName)
  });
  return client;
}
function reset() { sync.__resetSupabaseSyncDepsForTesting(); }

// ---------------------------------------------------------------------------
it('getRestoreMode semantics (via the db module source)', () => {
  const dbCode = fs.readFileSync('database.js', 'utf8');
  assert.ok(dbCode.includes("if (p === 'MANAGER') return 'today';"), 'MANAGER → today');
  assert.ok(dbCode.includes("if (p === 'ADMIN' || p === 'OWNER') return '31d';"), 'ADMIN/OWNER → 31d');
  assert.ok(/return 'today';\r?\n\}/.test(dbCode), 'unresolved → today (fail-conservative)');
  assert.ok(dbCode.includes('export const APP_PROFILE_RESOLVED'), 'profile-resolution flag exported');
});

it('MANAGER: only running-day transactional rows (+ full master data)', async () => {
  const client = setup('MANAGER');
  const res = await sync.restoreSupabaseWindow({ profileName: 'MANAGER' }); // NO mode → must resolve to today
  assert.strictEqual(res.success, true, `no failed collections (${res.failedCollections})`);

  // master data must be FULL (no date filter recorded)
  const menuCalls = client.__calls.filter((c) => c.table === 'menu_items');
  assert.strictEqual(menuCalls.length, 0, 'menu_items fetched with NO .gt filter (master)');

  // transactional must be date-bounded to today
  const orderItems = client.__calls.find((c) => c.table === 'order_items');
  assert.ok(orderItems && orderItems.marker === TODAY_ISO, 'order_items bounded to today');
  const ds = client.__calls.find((c) => c.table === 'daily_submit');
  assert.ok(ds && ds.marker === TODAY_ISO, 'daily_submit IS date-bounded now (was unbounded)');

  // row counts (data: order_items 2000 total / 20 today; daily_submit 400 total / 1 today)
  assert.strictEqual(res.rowsWritten, 328 + 33, `MANAGER total = master 328 + today 33, got ${res.rowsWritten}`);
  reset();
});

it('ADMIN/OWNER: last-31-days transactional rows', async () => {
  const client = setup('ADMIN');
  const res = await sync.restoreSupabaseWindow({ profileName: 'ADMIN' });
  assert.strictEqual(res.success, true);
  const oi = client.__calls.find((c) => c.table === 'order_items');
  assert.ok(oi && oi.marker !== TODAY_ISO, 'order_items bounded to 31d, not today');
  assert.strictEqual(res.rowsWritten, 328 + 833, `ADMIN total = master 328 + last31 833, got ${res.rowsWritten}`);
  reset();
});

it('unresolved profile fails CONSERVATIVE (today, never 31d)', async () => {
  const fb = makeFb('');
  fb.APP_PROFILE_RESOLVED = false;
  fb.ACTIVE_APP_PROFILE = 'ADMIN'; // the legacy silent default
  const client = makeFilteringClient();
  sync.__setSupabaseSyncDepsForTesting({ isEnabled: () => true, isConfigured: () => true, getClient: () => client, getDb: () => makeFakeDb(), getFirebase: () => fb });

  const res = await sync.restoreSupabaseWindow({ profileName: 'ADMIN' }); // caller still says ADMIN
  const oi = client.__calls.find((c) => c.table === 'order_items');
  assert.ok(oi && oi.marker === TODAY_ISO, 'unresolved build ⇒ today-only scope');
  assert.strictEqual(res.rowsWritten, 328 + 33, 'unresolved ⇒ running-day row counts');
  reset();
});

it('no "31d" default left in restoreSupabaseWindow', () => {
  const code = fs.readFileSync('services/supabaseSync.js', 'utf8');
  assert.ok(!/restoreSupabaseWindow\(\{ profileName, mode = '31d' \}/.test(code), 'default mode removed');
  assert.ok(code.includes('export async function restoreSupabaseWindow({ profileName, mode } = {})'), 'mode is explicit');
  assert.ok(code.includes("const windowedTables = [...txTables, 'daily_submit', 'daily_summary'];"), 'daily_* are windowed');
  assert.ok(code.includes("const masterTables = ['restaurant_tables', 'menu_items', 'menu_categories'];"), 'master set is unbounded');
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
