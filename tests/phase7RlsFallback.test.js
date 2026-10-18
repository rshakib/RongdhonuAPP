/**
 * Phase 7 — Device-gated RLS: client-side verification + safety fallback.
 * Run with: node tests/phase7RlsFallback.test.js
 *
 * Covers (Step 2 of the staged rollout):
 *  - isRlsDenialError classifier (42501 / 401-403 / permission messages)
 *  - X-Device-Id is injected via global.headers AND runtime rest.headers
 *  - App.js ordering: registerDeviceIfNeeded → setSupabaseDeviceId → Supabase sync
 *  - RLS-denied Supabase READ error → Firebase fallback (same tick, no throw)
 *  - RLS-denied Supabase RESTORE → Firebase restore fallback
 *  - RLS-denied Supabase WRITE (dual-write) → FAILED + retried, never throws
 *  - supabase_rls.sql completeness: 27 gates, permissive dropped, exclusions kept
 */

'use strict';
const assert = require('assert');
const fs = require('fs');

console.log('======================================================');
console.log('   PHASE 7 — RLS FALLBACK & STAGING VERIFICATION       ');
console.log('======================================================\n');

let passed = 0;
let failed = 0;
const tests = [];
function it(desc, fn) { tests.push({ desc, fn }); }

const sync = require('../services/supabaseSync.js');
const queue = require('../services/supabaseSyncQueue.js');

const RLS_ERROR = { code: '42501', status: 403, message: 'permission denied for table orders' };

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------
function makeFakeDb(schema, initial = {}) {
  const tables = {};
  for (const t of Object.keys(schema)) tables[t] = (initial[t] || []).map((r) => ({ ...r }));
  return {
    tables,
    _cfg: Object.assign({}, initial.app_config || {}),
    getAllSync(sql, params = []) {
      const pragma = sql.match(/PRAGMA table_info\((\w+)\)/i);
      if (pragma) return (schema[pragma[1]] || []).map((name) => ({ name }));
      const m = sql.match(/FROM\s+(\w+)/i);
      let rows = (tables[m ? m[1] : ''] || []).slice();
      if (/status\s*=\s*'PENDING'/.test(sql)) rows = rows.filter((r) => r.status === 'PENDING');
      if (/status\s*=\s*'FAILED'/.test(sql)) rows = rows.filter((r) => r.status === 'FAILED');
      return rows;
    },
    getFirstSync(sql, params = []) {
      if (/PRAGMA table_info/i.test(sql)) return this.getAllSync(sql, params);
      if (/FROM app_config WHERE key/i.test(sql)) {
        const v = this._cfg[params[0]];
        return v === undefined ? null : { value: v };
      }
      const m = sql.match(/FROM\s+(\w+)\s+WHERE\s+(\w+)\s*=\s*\?/i);
      if (m) return (tables[m[1]] || []).find((r) => String(r[m[2]]) === String(params[0])) || null;
      return null;
    },
    runSync(sql, params = []) {
      if (/INSERT OR REPLACE INTO app_config/i.test(sql)) { this._cfg[params[0]] = params[1]; return; }
      const t = tables.sync_queue_supabase;
      if (t) {
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
      }
    }
  };
}

function makeFakeFb() {
  const calls = { restore: [], syncTablesOnly: 0, syncHigh: 0, syncDeletions: 0, syncLow: 0, syncDailyMenu: 0 };
  return {
    calls,
    ACTIVE_APP_PROFILE: 'ADMIN',
    APP_PROFILES: { ADMIN: { recentOnly: ['orders', 'order_items', 'payments', 'deliveries'], lowFreq: ['users', 'expenses'] } },
    getBusinessDate: () => '2026-09-27',
    restoreDatabaseFromCloud: async (opts) => { calls.restore.push(opts || {}); return { success: true, failedCollections: [] }; },
    syncTablesOnly: async () => { calls.syncTablesOnly++; return false; },
    syncHighFrequencyCollections: async () => { calls.syncHigh++; return false; },
    syncDeletionsOnly: async () => { calls.syncDeletions++; return false; },
    syncLowFrequencyCollections: async () => { calls.syncLow++; return false; },
    syncDailyAndMenuFromFirebase: async () => { calls.syncDailyMenu++; return false; }
  };
}

function makeRlsErrorClient() {
  const c = {};
  c.select = () => c; c.gt = () => c; c.order = () => c; c.range = () => c; c.limit = () => c;
  c.then = (res, rej) => Promise.resolve({ data: null, error: RLS_ERROR }).then(res, rej);
  return { from: () => c };
}

const SCHEMA = {
  restaurant_tables: ['id', 'table_name', 'status', 'updated_at', 'is_synced'],
  orders: ['id', 'grand_total', 'created_at', 'updated_at', 'is_synced'],
  order_items: ['id', 'order_id', 'created_at', 'updated_at', 'is_synced'],
  payments: ['id', 'order_id', 'created_at', 'updated_at', 'is_synced'],
  users: ['id', 'role', 'created_at', 'updated_at', 'is_synced'],
  expenses: ['id', 'category', 'created_at', 'updated_at', 'is_synced']
};

function resetSync() { sync.__resetSupabaseSyncDepsForTesting(); }
function resetQueue() { queue.__resetSupabaseSyncDepsForTesting(); }

// ---------------------------------------------------------------------------
// 1. Classifier
// ---------------------------------------------------------------------------
it('isRlsDenialError: classifies 42501 / 401-403 / permission messages, rejects benign errors', () => {
  assert.strictEqual(sync.isRlsDenialError({ code: '42501', message: 'new row violates row-level security policy for table "orders"' }), true);
  assert.strictEqual(sync.isRlsDenialError({ status: 403, message: 'Forbidden' }), true);
  assert.strictEqual(sync.isRlsDenialError({ status: 401 }), true);
  assert.strictEqual(sync.isRlsDenialError({ message: 'permission denied for table orders' }), true);
  assert.strictEqual(sync.isRlsDenialError({ message: 'new row violates row-level security policy' }), true);
  assert.strictEqual(sync.isRlsDenialError({ code: 'PGRST116', message: 'JSON object requested' }), false);
  assert.strictEqual(sync.isRlsDenialError(new Error('Network request failed')), false);
  assert.strictEqual(sync.isRlsDenialError(null), false);
});

// ---------------------------------------------------------------------------
// 2. Client header injection + App.js ordering (source invariants)
// ---------------------------------------------------------------------------
it('header: X-Device-Id is sent globally (global.headers) and set on the PostgREST Headers at runtime', () => {
  const client = fs.readFileSync('services/supabaseClient.js', 'utf8');
  assert.ok(client.includes("globalHeaders['x-device-id'] = String(deviceId);"), 'constructor global header set');
  assert.ok(client.includes('global: { headers: globalHeaders'), 'global headers wired into createClient');
  // Must use the Headers API — a bracket assignment is a silent no-op on a Headers instance.
  assert.ok(client.includes("setHeaderOn(supabaseInstance.rest.headers, 'x-device-id', nextId)"), 'runtime header set via helper');
  assert.ok(client.includes('headers.set(name, value)'), 'uses Headers.set (not a no-op expando assignment)');
  assert.ok(!client.includes("supabaseInstance.rest.headers['x-device-id'] ="), 'must NOT use the broken bracket assignment');
  assert.ok(client.includes('persistent_device_id'), 're-applies persisted device id on warm start');
});

it('App.js ordering: registerDeviceIfNeeded → setSupabaseDeviceId → Supabase daemon + pull timers', () => {
  const app = fs.readFileSync('App.js', 'utf8');
  const iReg = app.indexOf('await registerDeviceIfNeeded');
  const iSet = app.indexOf('setSupabaseDeviceId(currentDeviceRec.device_id)');
  const iDaemon = app.indexOf('startSupabaseSyncService()');
  const iPull = app.indexOf("registerSyncTimer('supabase-tables-poll'");
  assert.ok(iReg > 0, 'registerDeviceIfNeeded present');
  assert.ok(iSet > iReg, 'setSupabaseDeviceId runs AFTER registerDeviceIfNeeded');
  assert.ok(iDaemon > iSet, 'Supabase dual-write daemon starts AFTER device id is set');
  assert.ok(iPull > iSet, 'Supabase pull timers are wired AFTER device id is set');
  // The only Supabase call before the device id is the UNGATED app_version_policy read.
  const iVersion = app.indexOf('checkAppVersionPolicy(ACTIVE_APP_PROFILE)');
  assert.ok(iVersion > 0 && iVersion < iSet, 'version check precedes device id (app_version_policy is public-read)');
});

// ---------------------------------------------------------------------------
// 3. Read path — RLS denial behaves exactly like a network failure
// ---------------------------------------------------------------------------
it('read: RLS-denied SELECT error → BLOCKED by policy (no automatic Firebase read)', async () => {
  resetSync();
  const fb = makeFakeFb();
  sync.__setSupabaseSyncDepsForTesting({
    isEnabled: () => true,
    isConfigured: () => true,
    getClient: () => makeRlsErrorClient(),
    getDb: () => makeFakeDb(SCHEMA, {}),
    getFirebase: () => fb
  });

  const r1 = await sync.syncSupabaseTables();
  const r2 = await sync.syncSupabaseHighFrequencyCollections();
  const r3 = await sync.syncSupabaseDeletions();
  const r4 = await sync.syncSupabaseLowFrequencyCollections();

  assert.strictEqual(r1, false); assert.strictEqual(r2, false); assert.strictEqual(r3, false); assert.strictEqual(r4, false);
  // OWNER POLICY (ALLOW_AUTO_FIREBASE_READ = false): a denied/failed Supabase read must NOT
  // trigger an automatic Firebase read — the device keeps its local data until a manual pull.
  assert.strictEqual(fb.calls.syncTablesOnly, 0, 'tables: Firebase NOT read');
  assert.strictEqual(fb.calls.syncHigh, 0, 'high-frequency: Firebase NOT read');
  assert.strictEqual(fb.calls.syncDeletions, 0, 'deletions: Firebase NOT read');
  assert.strictEqual(fb.calls.syncLow, 0, 'low-frequency: Firebase NOT read');
  resetSync();
});

it('read: pullSupabaseTable preserves PostgREST code/status on the thrown error', async () => {
  resetSync();
  sync.__setSupabaseSyncDepsForTesting({
    isEnabled: () => true,
    isConfigured: () => true,
    getClient: () => makeRlsErrorClient(),
    getDb: () => makeFakeDb(SCHEMA, {}),
    getFirebase: () => makeFakeFb()
  });
  await assert.rejects(
    () => sync.pullSupabaseTable(makeFakeDb(SCHEMA, {}), 'orders'),
    (err) => {
      assert.strictEqual(err.code, '42501', 'SQLSTATE preserved');
      assert.strictEqual(err.status, 403, 'HTTP status preserved');
      assert.strictEqual(sync.isRlsDenialError(err), true, 'classifier matches the preserved error');
      return true;
    }
  );
  resetSync();
});

// ---------------------------------------------------------------------------
// 4. Restore path — RLS denial falls back to Firebase restore
// ---------------------------------------------------------------------------
function makeRestoreClient(coverageIso) {
  function chain() {
    const c = {};
    let isCoverage = false;
    c.select = (cols) => { isCoverage = cols === 'created_at'; return c; };
    c.order = () => c; c.gt = () => c; c.range = () => c;
    c.limit = () => Promise.resolve({ data: [{ created_at: coverageIso }], error: null });
    c.then = (res, rej) => Promise.resolve(
      isCoverage
        ? { data: [{ created_at: coverageIso }], error: null }
        : { data: null, error: RLS_ERROR }
    ).then(res, rej);
    return c;
  }
  return { from: () => chain() };
}

it('restore: coverage ≥31d + RLS-denied window → Firebase restore fallback', async () => {
  resetSync();
  const fb = makeFakeFb();
  const coverageIso = new Date(Date.now() - 40 * 86400000).toISOString();
  sync.__setSupabaseSyncDepsForTesting({
    isEnabled: () => true,
    isConfigured: () => true,
    getClient: () => makeRestoreClient(coverageIso),
    getDb: () => makeFakeDb(SCHEMA, {}),
    getFirebase: () => fb
  });

  const res = await sync.restoreHybridDatabaseFromCloud({ mode: 'today' });
  assert.strictEqual(fb.calls.restore.length, 1, 'Firebase restore fallback invoked exactly once');
  assert.deepStrictEqual(fb.calls.restore[0], { mode: 'today' });
  // The old special-case (Firebase-only menu/daily top-up inside the Supabase pass)
  // is gone: menu/daily are now covered by the Supabase master/windowed passes, and
  // any Supabase failure falls through to the WHOLE-scope Firebase restore above.
  assert.strictEqual(fb.calls.syncDailyMenu, 0, 'no separate Firebase-only top-up inside restoreSupabaseWindow');
  assert.strictEqual(res.success, true, 'returns the Firebase fallback result');
  resetSync();
});

it('restore: coverage <31d (transition) → Firebase restore directly, no Supabase restore attempted', async () => {
  resetSync();
  const fb = makeFakeFb();
  sync.__setSupabaseSyncDepsForTesting({
    isEnabled: () => true,
    isConfigured: () => true,
    getClient: () => makeRestoreClient(''), // empty → coverage 0
    getDb: () => makeFakeDb(SCHEMA, {}),
    getFirebase: () => fb
  });

  await sync.restoreHybridDatabaseFromCloud({ mode: 'today' });
  assert.strictEqual(fb.calls.restore.length, 1);
  assert.deepStrictEqual(fb.calls.restore[0], { mode: 'today' });
  resetSync();
});

// ---------------------------------------------------------------------------
// 5. Dual-write path — RLS-denied write is FAILED + retried, never throws
// ---------------------------------------------------------------------------
function queueDb() {
  return makeFakeDb(
    { orders: ['id', 'grand_total'], sync_queue_supabase: ['id', 'record_id', 'table_name', 'action', 'status', 'retry_count'] },
    {
      sync_queue_supabase: [{ id: 1, record_id: 'o1', table_name: 'orders', action: 'INSERT', status: 'PENDING', retry_count: 0 }],
      orders: [{ id: 'o1', grand_total: 100 }]
    }
  );
}

it('dual-write: RLS-denied upsert → item marked FAILED, {0,1}, no throw', async () => {
  resetQueue();
  const db = queueDb();
  const client = { from: () => ({ upsert: () => Promise.resolve({ error: RLS_ERROR }) }) };
  queue.__setSupabaseSyncDepsForTesting({ isConfigured: () => true, isEnabled: () => true, getClient: () => client, getDb: () => db });

  const res = await queue.processSupabaseSyncQueue();
  assert.deepStrictEqual(res, { successfulWrites: 0, failedWrites: 1 });
  const item = db.tables.sync_queue_supabase[0];
  assert.strictEqual(item.status, 'FAILED', 'queue row marked FAILED for retry');
  assert.strictEqual(item.retry_count, 1, 'retry counted');
  resetQueue();
});

it('dual-write: recovery — next healthy cycle drains the queue (no permanent loss)', async () => {
  resetQueue();
  const db = queueDb();
  db.tables.sync_queue_supabase[0].status = 'FAILED';
  db.tables.sync_queue_supabase[0].last_attempt_at = null; // retry due immediately
  const client = { from: () => ({ upsert: () => Promise.resolve({ error: null }) }) };
  queue.__setSupabaseSyncDepsForTesting({ isConfigured: () => true, isEnabled: () => true, getClient: () => client, getDb: () => db });

  const res = await queue.processSupabaseSyncQueue();
  assert.deepStrictEqual(res, { successfulWrites: 1, failedWrites: 0 });
  assert.strictEqual(db.tables.sync_queue_supabase.length, 0, 'queue drained on success');
  resetQueue();
});

// ---------------------------------------------------------------------------
// 6. supabase_rls.sql completeness / staged structure
// ---------------------------------------------------------------------------
const POS_TABLES = [
  'users', 'restaurant_tables', 'orders', 'order_items', 'payments', 'expenses', 'deliveries',
  'menu_categories', 'menu_items', 'daily_submit', 'daily_summary', 'daily_submit_priority',
  'due_payments', 'eja_history', 'off_days', 'weather_data', 'supplier_due', 'supplier_due_history',
  'supplier_payment_ledger', 'owner_employees', 'owner_salary_ledger', 'owner_expenses',
  'owner_deposits', 'owner_home_deposits', 'activity_logs', 'deletions', 'delete_history'
];

it('SQL: is_device_active() gate uses all four ACTIVE conditions', () => {
  const sql = fs.readFileSync('supabase_rls.sql', 'utf8');
  assert.ok(sql.includes('CREATE OR REPLACE FUNCTION public.is_device_active(p_device_id TEXT)'), 'function defined');
  assert.ok(sql.includes('SECURITY DEFINER'), 'SECURITY DEFINER');
  assert.ok(sql.includes("status = 'ACTIVE'"), 'status ACTIVE');
  assert.ok(sql.includes('allow_login = true'), 'allow_login true');
  assert.ok(sql.includes('admin_lock = false'), 'admin_lock false');
  assert.ok(sql.includes('is_deleted = false'), 'is_deleted false');
  assert.ok(sql.includes('GRANT EXECUTE ON FUNCTION public.is_device_active(TEXT) TO anon, authenticated'), 'granted to anon');
});

it('SQL: all 27 POS tables are gated AND drop the Phase-1 permissive policy', () => {
  const sql = fs.readFileSync('supabase_rls.sql', 'utf8');
  assert.strictEqual(POS_TABLES.length, 27, 'sanity: 27 POS tables');
  for (const t of POS_TABLES) {
    assert.ok(
      new RegExp(`CREATE POLICY "Device active gate" ON public\\.${t}\\b`).test(sql),
      `${t}: gate policy present`
    );
    assert.ok(
      new RegExp(`DROP POLICY IF EXISTS "Permissive anon access \\(Phase 1\\)" ON public\\.${t};`).test(sql),
      `${t}: drops the Phase-1 permissive policy (or RLS would be ineffective)`
    );
  }
});

it('SQL: devices / device_app_usage / app_version_policy are NEVER device-gated', () => {
  const sql = fs.readFileSync('supabase_rls.sql', 'utf8');
  assert.ok(!/Device active gate" ON public\.devices\b/.test(sql), 'devices not gated');
  assert.ok(!/Device active gate" ON public\.device_app_usage\b/.test(sql), 'device_app_usage not gated');
  assert.ok(!/Device active gate" ON public\.app_version_policy\b/.test(sql), 'app_version_policy not gated');
  // Excluded tables keep permissive policies.
  assert.ok(sql.includes('CREATE POLICY "Allow device tracking and control"'), 'devices permissive policy retained');
  assert.ok(sql.includes('CREATE POLICY "Allow device app usage tracking"'), 'device_app_usage permissive policy retained');
});

it('SQL: app_version_policy keeps public read + permissive upsert (INSERT+UPDATE), no DELETE', () => {
  const sql = fs.readFileSync('supabase_rls.sql', 'utf8');
  assert.ok(sql.includes('CREATE POLICY "Public read version policy"'), 'public read');
  assert.ok(/ON public\.app_version_policy FOR SELECT TO anon, authenticated USING \(true\)/.test(sql), 'SELECT permissive');
  assert.ok(/ON public\.app_version_policy FOR INSERT TO anon, authenticated WITH CHECK \(true\)/.test(sql), 'INSERT permissive (upsert needs it)');
  assert.ok(/ON public\.app_version_policy FOR UPDATE TO anon, authenticated USING \(true\) WITH CHECK \(true\)/.test(sql), 'UPDATE permissive');
  assert.ok(!/ON public\.app_version_policy FOR DELETE/.test(sql), 'DELETE intentionally not granted');
});

it('SQL: staged structure — STAGE 1 first block is a low-risk table; Section 5 rollback helper present', () => {
  const sql = fs.readFileSync('supabase_rls.sql', 'utf8');
  const stage1 = sql.indexOf('STAGE 1 · off_days');
  const gateOffDays = sql.indexOf('CREATE POLICY "Device active gate" ON public.off_days');
  assert.ok(stage1 > 0 && gateOffDays > stage1, 'STAGE 1 starts with off_days');
  assert.ok(sql.includes('CREATE OR REPLACE FUNCTION public.revoke_device_gate(p_table TEXT)'), 'rollback helper present');
  assert.ok(sql.includes("SELECT public.revoke_device_gate('off_days');"), 'single-table rollback example present');
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
