/**
 * Phase 3 — Supabase-primary pull sync (services/supabaseSync.js) verification.
 * Run with: node tests/supabaseSync.test.js
 *
 * Covers: PK/cursor helpers, low-freq table selection, merge rules (newer wins,
 * is_synced=0 preserved, Schema Guardian, deletions tombstones, restaurant_tables
 * filter), Firebase fallback on dormant/error/kill-switch, and hybrid restore.
 */

'use strict';
const assert = require('assert');
const fs = require('fs');

console.log('======================================================');
console.log('   PHASE 3 — SUPABASE PULL SYNC VERIFICATION          ');
console.log('======================================================\n');

let passed = 0;
let failed = 0;
const tests = [];
function it(desc, fn) { tests.push({ desc, fn }); }

const sync = require('../services/supabaseSync.js');

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
      const m = sql.match(/FROM\s+(\w+)\s+WHERE\s+(\w+)\s*=\s*\?/i);
      if (m) return (tables[m[1]] || []).filter((r) => String(r[m[2]]) === String(params[0]));
      return [];
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
      const ins = sql.match(/INSERT OR REPLACE INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES/i);
      if (ins) {
        const t = ins[1];
        const cols = ins[2].split(',').map((s) => s.trim());
        const nQ = (sql.match(/\?/g) || []).length;
        const row = {};
        cols.forEach((c, i) => { row[c] = i < nQ ? params[i] : 1; }); // trailing literal (e.g. is_synced=1)
        if (!tables[t]) tables[t] = [];
        const idx = tables[t].findIndex((r) => String(r.id) === String(row.id));
        if (idx >= 0) tables[t][idx] = { ...tables[t][idx], ...row }; else tables[t].push(row);
        return;
      }
      const del = sql.match(/DELETE FROM\s+(\w+)\s+WHERE\s+(\w+)\s*=\s*\?/i);
      if (del) { const t = del[1]; if (tables[t]) tables[t] = tables[t].filter((r) => String(r[del[2]]) !== String(params[0])); return; }
    }
  };
}

function chain(data) {
  const c = {
    select: () => c, gt: () => c, order: () => c, range: () => c, limit: () => c,
    then: (res, rej) => Promise.resolve({ data, error: null }).then(res, rej)
  };
  return c;
}
function makeDataClient(map) { return { from: (t) => chain((map[t] || []).slice()) }; }
function makeErrorClient() {
  const c = {
    select: () => c, gt: () => c, order: () => c, range: () => c, limit: () => c,
    then: (res, rej) => Promise.resolve({ data: null, error: { message: 'boom' } }).then(res, rej)
  };
  return { from: () => c };
}

function makeFakeFb() {
  const calls = { restore: [], syncTablesOnly: 0, syncHigh: 0, syncDeletions: 0, syncLow: 0, syncDailyMenu: 0 };
  return {
    calls,
    ACTIVE_APP_PROFILE: 'ADMIN',
    APP_PROFILES: { ADMIN: { recentOnly: ['orders'], lowFreq: ['users', 'daily_summary', 'daily_submit', 'app_config', 'expenses'] } },
    getBusinessDate: () => '2026-09-27',
    restoreDatabaseFromCloud: async (opts) => { calls.restore.push(opts || {}); return { success: true, failedCollections: [] }; },
    syncTablesOnly: async () => { calls.syncTablesOnly++; return false; },
    syncHighFrequencyCollections: async () => { calls.syncHigh++; return false; },
    syncDeletionsOnly: async () => { calls.syncDeletions++; return false; },
    syncLowFrequencyCollections: async () => { calls.syncLow++; return false; },
    syncDailyAndMenuFromFirebase: async () => { calls.syncDailyMenu++; return false; }
  };
}

const SCHEMA = {
  restaurant_tables: ['id', 'table_name', 'status', 'is_synced'],
  orders: ['id', 'grand_total', 'created_at', 'updated_at', 'is_synced'],
  users: ['id', 'role', 'created_at', 'updated_at', 'is_synced'],
  deletions: ['id', 'table_name', 'record_id', 'created_at', 'updated_at', 'is_synced'],
  menu_items: ['id', 'name', 'category', 'price', 'is_synced']
};

function reset() { sync.__resetSupabaseSyncDepsForTesting(); }

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------
it('getSupabasePkColumn: id / date / business_date', () => {
  assert.strictEqual(sync.getSupabasePkColumn('orders'), 'id');
  assert.strictEqual(sync.getSupabasePkColumn('daily_submit'), 'date');
  assert.strictEqual(sync.getSupabasePkColumn('daily_summary'), 'date');
  assert.strictEqual(sync.getSupabasePkColumn('daily_submit_priority'), 'business_date');
});

it('getSupabaseCursorColumn: prefers updated_at, falls back to created_at', () => {
  const db = makeFakeDb({ a: ['id', 'updated_at'], b: ['id', 'created_at'] });
  assert.strictEqual(sync.getSupabaseCursorColumn(db, 'a'), 'updated_at');
  assert.strictEqual(sync.getSupabaseCursorColumn(db, 'b'), 'created_at');
});

it('getSupabaseLowFreqTables: excludes only app_config (daily_* now Supabase-backed)', () => {
  const fb = makeFakeFb();
  const tables = sync.getSupabaseLowFreqTables(fb);
  assert.deepStrictEqual(tables.sort(), ['daily_submit', 'daily_summary', 'expenses', 'users']);
});

// ---------------------------------------------------------------------------
// Merge rules
// ---------------------------------------------------------------------------
it('merge: newer updated_at wins', () => {
  const db = makeFakeDb(SCHEMA, { orders: [{ id: 'o1', grand_total: 100, updated_at: '2026-09-27T10:00:00.000Z', created_at: '2026-09-27T10:00:00.000Z', is_synced: 1 }] });
  const r = sync.mergeSupabaseRows(db, 'orders', [{ id: 'o1', grand_total: 250, updated_at: '2026-09-27T11:00:00.000Z', created_at: '2026-09-27T10:00:00.000Z' }]);
  assert.strictEqual(r.hasChanges, true);
  assert.strictEqual(db.tables.orders[0].grand_total, 250);
});

it('merge: newer cloud row repairs a locally-unsynced row', () => {
  const db = makeFakeDb(SCHEMA, { orders: [{ id: 'o1', grand_total: 100, updated_at: '2026-09-27T10:00:00.000Z', is_synced: 0 }] });
  sync.mergeSupabaseRows(db, 'orders', [{ id: 'o1', grand_total: 250, updated_at: '2026-09-27T11:00:00.000Z' }]);
  assert.strictEqual(db.tables.orders[0].grand_total, 250);
});

it('merge: older cloud row does NOT clobber a pending local edit (is_synced=0)', () => {
  const db = makeFakeDb(SCHEMA, { orders: [{ id: 'o1', grand_total: 100, updated_at: '2026-09-27T10:00:00.000Z', is_synced: 0 }] });
  const r = sync.mergeSupabaseRows(db, 'orders', [{ id: 'o1', grand_total: 999, updated_at: '2026-09-27T09:00:00.000Z' }]);
  assert.strictEqual(r.hasChanges, false);
  assert.strictEqual(db.tables.orders[0].grand_total, 100, 'local pending edit preserved');
});

it('merge: Schema Guardian drops unknown columns without throwing', () => {
  const db = makeFakeDb(SCHEMA, {});
  const r = sync.mergeSupabaseRows(db, 'orders', [{ id: 'o2', grand_total: 50, updated_at: '2026-09-27T10:00:00.000Z', totally_unknown_col: 'x' }]);
  assert.strictEqual(r.hasChanges, true);
  assert.strictEqual(db.tables.orders[0].totalUnknownCol, undefined);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(db.tables.orders[0], 'totally_unknown_col'), false);
  assert.strictEqual(db.tables.orders[0].is_synced, 1, 'is_synced stamped to 1');
});

it('merge: restaurant_tables accepts only table_1..table_8', () => {
  const db = makeFakeDb(SCHEMA, {});
  sync.mergeSupabaseRows(db, 'restaurant_tables', [
    { id: 'table_1', table_name: 'T-1', status: 'FREE', updated_at: '2026-09-27T10:00:00.000Z' },
    { id: 'table_9', table_name: 'X', status: 'FREE', updated_at: '2026-09-27T10:00:00.000Z' }
  ]);
  assert.strictEqual(db.tables.restaurant_tables.length, 1);
  assert.strictEqual(db.tables.restaurant_tables[0].id, 'table_1');
});

it('merge: deletions tombstone removes the target row and records the tombstone', () => {
  const db = makeFakeDb(SCHEMA, { orders: [{ id: 'o9', grand_total: 5, updated_at: '2026-09-27T10:00:00.000Z', is_synced: 1 }] });
  sync.mergeSupabaseRows(db, 'deletions', [{ id: 'd1', table_name: 'orders', record_id: 'o9', updated_at: '2026-09-27T11:00:00.000Z' }]);
  assert.strictEqual(db.tables.orders.length, 0, 'target row deleted');
  assert.strictEqual(db.tables.deletions.length, 1, 'tombstone recorded');
});

// ---------------------------------------------------------------------------
// §3.6 Supabase-down / fallback behavior
// ---------------------------------------------------------------------------
it('§3.6 kill switch OFF: Supabase pull is a no-op and does NOT call Firebase fallback', async () => {
  reset();
  const fb = makeFakeFb();
  sync.__setSupabaseSyncDepsForTesting({ isEnabled: () => false, isConfigured: () => true, getFirebase: () => fb });
  const r = await sync.syncSupabaseHighFrequencyCollections();
  assert.strictEqual(r, false);
  assert.strictEqual(fb.calls.syncHigh, 0, 'no Firebase fallback when explicitly disabled');
  reset();
});

it('§3.6 blank URL (dormant): Supabase pull fails fast and calls the Firebase fallback in the same tick', async () => {
  reset();
  const fb = makeFakeFb();
  sync.__setSupabaseSyncDepsForTesting({ isEnabled: () => true, isConfigured: () => false, getFirebase: () => fb });
  await sync.syncSupabaseHighFrequencyCollections();
  assert.strictEqual(fb.calls.syncHigh, 1, 'Firebase high-frequency fallback invoked');
  await sync.syncSupabaseTables();
  assert.strictEqual(fb.calls.syncTablesOnly, 1, 'Firebase tables fallback invoked');
  await sync.syncSupabaseDeletions();
  assert.strictEqual(fb.calls.syncDeletions, 1, 'Firebase deletions fallback invoked');
  await sync.syncSupabaseLowFrequencyCollections();
  assert.strictEqual(fb.calls.syncLow, 1, 'Firebase low-frequency fallback invoked');
  reset();
});

it('§3.6 black-hole/timeout (error client): BLOCKS the Firebase fallback by policy, no throw', async () => {
  reset();
  const fb = makeFakeFb();
  sync.__setSupabaseSyncDepsForTesting({
    isEnabled: () => true, isConfigured: () => true,
    getClient: () => makeErrorClient(), getDb: () => makeFakeDb(SCHEMA, {}), getFirebase: () => fb
  });
  const r = await sync.syncSupabaseHighFrequencyCollections();
  assert.strictEqual(r, false);
  // OWNER POLICY (ALLOW_AUTO_FIREBASE_READ = false): a Supabase read failure must NOT trigger
  // an automatic Firebase read. The device keeps its local data until a manual pull.
  assert.strictEqual(fb.calls.syncHigh, 0, 'Firebase fallback BLOCKED by policy');
  reset();
});

it('configured + healthy: merges Supabase rows and does NOT call the Firebase fallback', async () => {
  reset();
  const fb = makeFakeFb();
  const db = makeFakeDb(SCHEMA, {});
  const client = makeDataClient({ orders: [{ id: 'o1', grand_total: 42, created_at: '2026-09-27T10:00:00.000Z', updated_at: '2026-09-27T10:00:00.000Z' }], order_items: [], payments: [], deliveries: [] });
  sync.__setSupabaseSyncDepsForTesting({ isEnabled: () => true, isConfigured: () => true, getClient: () => client, getDb: () => db, getFirebase: () => fb });
  const changed = await sync.syncSupabaseHighFrequencyCollections();
  assert.strictEqual(changed, true, 'reports change from Supabase');
  assert.strictEqual(fb.calls.syncHigh, 0, 'Firebase NOT used when Supabase is healthy');
  assert.strictEqual(db.tables.orders[0].grand_total, 42);
  assert.ok(String(db._cfg['last_sync_time_supabase_orders'] || '').length > 0, 'cursor advanced');
  reset();
});

// ---------------------------------------------------------------------------
// Hybrid restore (transition decision)
// ---------------------------------------------------------------------------
it('restore: coverage < 31 days → running-day Firebase restore ONLY', async () => {
  reset();
  const fb = makeFakeFb();
  sync.__setSupabaseSyncDepsForTesting({
    isEnabled: () => true, isConfigured: () => true,
    getClient: () => makeDataClient({ orders: [] }), getFirebase: () => fb
  });
  const res = await sync.restoreHybridDatabaseFromCloud({ mode: 'today' });
  assert.strictEqual(res.success, true);
  assert.strictEqual(fb.calls.restore.length, 1, 'Firebase restore called once');
  assert.strictEqual(fb.calls.restore[0].mode, 'today', 'running-day Firebase path');
  reset();
});

it('restore: coverage ≥ 31 days + Supabase has rows → Supabase restore (no Firebase full restore)', async () => {
  reset();
  const fb = makeFakeFb();
  const oldIso = new Date(Date.now() - 40 * 86400000).toISOString();
  const db = makeFakeDb(SCHEMA, {});
  const client = makeDataClient({
    orders: [{ id: 'o1', created_at: oldIso, updated_at: oldIso }],
    restaurant_tables: [{ id: 'table_1', table_name: 'T-1', updated_at: oldIso }]
  });
  sync.__setSupabaseSyncDepsForTesting({ isEnabled: () => true, isConfigured: () => true, getClient: () => client, getDb: () => db, getFirebase: () => fb });
  const res = await sync.restoreHybridDatabaseFromCloud({ mode: 'today' });
  assert.strictEqual(res.success, true);
  assert.strictEqual(fb.calls.syncDailyMenu, 0, 'menu + daily served by Supabase (no Firebase read)');
  assert.strictEqual(fb.calls.restore.length, 0, 'no full Firebase restore when Supabase restore succeeds');
  reset();
});

it('restore: coverage ≥ 31 days but Supabase empty → running-day Firebase fallback', async () => {
  reset();
  const fb = makeFakeFb();
  const oldIso = new Date(Date.now() - 40 * 86400000).toISOString();
  // coverage query returns an old row, but the restore window returns nothing.
  let call = 0;
  const client = {
    from: () => {
      call++;
      return chain(call === 1 ? [{ created_at: oldIso }] : []);
    }
  };
  sync.__setSupabaseSyncDepsForTesting({ isEnabled: () => true, isConfigured: () => true, getClient: () => client, getDb: () => makeFakeDb(SCHEMA, {}), getFirebase: () => fb });
  const res = await sync.restoreHybridDatabaseFromCloud({ mode: 'today' });
  assert.strictEqual(fb.calls.restore.length, 1, 'fell back to Firebase running-day restore');
  assert.strictEqual(fb.calls.restore[0].mode, 'today');
  assert.strictEqual(res.success, true);
  reset();
});

// ---------------------------------------------------------------------------
// Firebase-untouched wiring invariants (source inspection)
// ---------------------------------------------------------------------------
it('App.js: Supabase timers added alongside untouched Firebase timers', () => {
  const code = fs.readFileSync('App.js', 'utf8');
  // Firebase timers still present & unchanged
  assert.ok(code.includes("registerSyncTimer('auto-high-frequency-pull', 30000"), 'Firebase high-freq timer intact');
  assert.ok(code.includes("registerSyncTimer('auto-tables-pull', 15000"), 'Firebase tables timer intact');
  assert.ok(code.includes("registerSyncTimer('auto-deletions-pull', 90000"), 'Firebase deletions timer intact');
  assert.ok(code.includes("registerSyncTimer('auto-low-frequency-pull', 180000"), 'Firebase low-freq timer intact');
  // New Supabase timers
  assert.ok(code.includes("registerSyncTimer('supabase-tables-poll', 5000"), 'Supabase tables 5s');
  assert.ok(code.includes("registerSyncTimer('supabase-high-frequency-poll', 10000"), 'Supabase high 10s');
  assert.ok(code.includes("registerSyncTimer('supabase-deletions-poll', 15000"), 'Supabase deletions 15s');
  assert.ok(code.includes("registerSyncTimer('supabase-low-frequency-poll', 60000"), 'Supabase low 60s');
  assert.ok(code.includes("registerSyncTimer('supabase-menu-poll', 300000"), 'Supabase menu 300s');
});

it('App.js: fresh-install restore routes through restoreHybridDatabaseFromCloud', () => {
  const code = fs.readFileSync('App.js', 'utf8');
  assert.ok(code.includes('restoreHybridDatabaseFromCloud({ mode: \'today\' })'), 'hybrid restore wired into ensureInitialData');
});

it('supabaseSync.js: exports the required API (menu + health added)', () => {
  const code = fs.readFileSync('services/supabaseSync.js', 'utf8');
  assert.ok(code.includes('export async function syncSupabaseTables'), 'syncSupabaseTables');
  assert.ok(code.includes('export async function syncSupabaseHighFrequencyCollections'), 'high');
  assert.ok(code.includes('export async function syncSupabaseDeletions'), 'deletions');
  assert.ok(code.includes('export async function syncSupabaseLowFrequencyCollections'), 'low');
  assert.ok(code.includes('export async function syncSupabaseMenu'), 'menu');
  assert.ok(code.includes('export async function restoreHybridDatabaseFromCloud'), 'hybrid restore');
  assert.ok(code.includes('export function isSupabasePrimaryHealthy'), 'health signal');
  assert.ok(code.includes('export function getSupabaseHealth'), 'health reason snapshot');
  assert.ok(code.includes('export function setPullListener'), 'pull listener setter');
  assert.ok(code.includes('export function clearPullListener'), 'pull listener clearer');
  assert.ok(code.includes("const LOW_FREQ_EXCLUDED = ['app_config']"), 'only app_config stays Firebase-only');
  assert.ok(code.includes("['orders', 'order_items', 'payments', 'deliveries']"), 'high-freq set');
  assert.ok(code.includes('last_sync_time_supabase_'), 'Supabase cursor key');
});

// ---------------------------------------------------------------------------
// Supabase health gate → Firebase reads skipped while healthy
// ---------------------------------------------------------------------------
it('isSupabasePrimaryHealthy: true on success, false on failure/disabled/dormant', async () => {
  reset();
  sync.__setSupabaseSyncDepsForTesting({
    isEnabled: () => true, isConfigured: () => true,
    getClient: () => makeDataClient({ orders: [], order_items: [], payments: [], deliveries: [] }),
    getDb: () => makeFakeDb(SCHEMA, {}), getFirebase: () => makeFakeFb()
  });
  await sync.syncSupabaseHighFrequencyCollections();
  assert.strictEqual(sync.isSupabasePrimaryHealthy(), true, 'healthy after a successful cycle');

  sync.__setSupabaseSyncDepsForTesting({ getClient: () => makeErrorClient() });
  await sync.syncSupabaseHighFrequencyCollections();
  assert.strictEqual(sync.isSupabasePrimaryHealthy(), false, 'unhealthy after a failure');

  sync.__setSupabaseSyncDepsForTesting({ isEnabled: () => false });
  assert.strictEqual(sync.isSupabasePrimaryHealthy(), false, 'not healthy when kill-switched off');

  sync.__setSupabaseSyncDepsForTesting({ isEnabled: () => true, isConfigured: () => false });
  assert.strictEqual(sync.isSupabasePrimaryHealthy(), false, 'not healthy when unconfigured');
  reset();
});

it('syncSupabaseMenu: merges from Supabase; BLOCKS the Firebase fallback on error (policy)', async () => {
  reset();
  const fb = makeFakeFb();
  fb.calls.syncMenuOnly = 0;
  fb.syncMenuOnly = async () => { fb.calls.syncMenuOnly++; return false; };
  const db = makeFakeDb({
    menu_items: ['id', 'name', 'category', 'price', 'is_synced'],
    menu_categories: ['id', 'name', 'is_synced']
  }, {});
  sync.__setSupabaseSyncDepsForTesting({
    isEnabled: () => true, isConfigured: () => true,
    getClient: () => makeDataClient({ menu_items: [{ id: 'm1', name: 'Tea', category: 'Drink', price: 10, updated_at: '2026-09-27T10:00:00.000Z' }], menu_categories: [] }),
    getDb: () => db, getFirebase: () => fb
  });
  await sync.syncSupabaseMenu();
  assert.strictEqual(db.tables.menu_items.length, 1, 'menu pulled from Supabase');
  assert.strictEqual(fb.calls.syncMenuOnly, 0, 'no Firebase read while healthy');

  sync.__setSupabaseSyncDepsForTesting({ getClient: () => makeErrorClient() });
  await sync.syncSupabaseMenu();
  assert.strictEqual(fb.calls.syncMenuOnly, 0, 'Firebase fallback BLOCKED by policy on failure');
  reset();
});

it('isSupabasePrimaryHealthy: false while a Supabase WRITE is FAILED (stale-read guard)', () => {
  reset();
  sync.__setSupabaseSyncDepsForTesting({
    isEnabled: () => true, isConfigured: () => true,
    getDb: () => ({ getAllSync: () => [], runSync: () => {}, getFirstSync: (sql) => (/sync_queue_supabase/.test(sql) ? { n: 1 } : null) })
  });
  assert.strictEqual(sync.isSupabasePrimaryHealthy(), false, 'failed Supabase write → Firebase preferred (Supabase copy is stale)');

  sync.__setSupabaseSyncDepsForTesting({
    getDb: () => ({ getAllSync: () => [], runSync: () => {}, getFirstSync: () => ({ n: 0 }) })
  });
  assert.strictEqual(sync.isSupabasePrimaryHealthy(), true, 'clean write queue → Supabase preferred');
  reset();
});

it('pull listener: reports source=supabase on success; NO fallback event while the policy blocks Firebase', async () => {
  reset();
  const events = [];
  sync.setPullListener((e) => events.push(e));

  const fb = makeFakeFb();
  const db = makeFakeDb(SCHEMA, {});
  sync.__setSupabaseSyncDepsForTesting({
    isEnabled: () => true, isConfigured: () => true,
    getClient: () => makeDataClient({ orders: [{ id: 'o1', grand_total: 7, created_at: '2026-09-27T10:00:00.000Z', updated_at: '2026-09-27T10:00:00.000Z' }], order_items: [], payments: [], deliveries: [] }),
    getDb: () => db, getFirebase: () => fb
  });
  await sync.syncSupabaseHighFrequencyCollections();
  assert.strictEqual(events.length, 1, 'one pull event on the healthy path');
  assert.strictEqual(events[0].source, 'supabase', 'reports Supabase as the read source');
  assert.strictEqual(events[0].hasChanges, true);

  sync.__setSupabaseSyncDepsForTesting({ getClient: () => makeErrorClient() });
  await sync.syncSupabaseHighFrequencyCollections();
  assert.strictEqual(events.length, 1, 'no fallback event — automatic Firebase reads are disabled by policy');

  sync.clearPullListener();
  reset();
});

it('getSupabaseHealth: reports the reason (killswitch/unconfigured/failed-writes/read-failed/healthy)', async () => {
  reset();
  const cleanDb = () => ({ getAllSync: () => [], runSync: () => {}, getFirstSync: () => ({ n: 0 }) });

  sync.__setSupabaseSyncDepsForTesting({ isEnabled: () => false, isConfigured: () => true });
  assert.deepStrictEqual(sync.getSupabaseHealth(), { healthy: false, reason: 'killswitch' });

  sync.__setSupabaseSyncDepsForTesting({ isEnabled: () => true, isConfigured: () => false });
  assert.deepStrictEqual(sync.getSupabaseHealth(), { healthy: false, reason: 'unconfigured' });

  sync.__setSupabaseSyncDepsForTesting({ isEnabled: () => true, isConfigured: () => true, getDb: () => ({ getAllSync: () => [], runSync: () => {}, getFirstSync: () => ({ n: 2 }) }) });
  assert.deepStrictEqual(sync.getSupabaseHealth(), { healthy: false, reason: 'failed-writes:2' });

  sync.__setSupabaseSyncDepsForTesting({ getDb: cleanDb });
  assert.deepStrictEqual(sync.getSupabaseHealth(), { healthy: true, reason: 'healthy' });

  // read-failed: a failing pull cycle flips the read flag
  sync.__setSupabaseSyncDepsForTesting({ getClient: () => makeErrorClient(), getDb: cleanDb, getFirebase: () => makeFakeFb() });
  await sync.syncSupabaseHighFrequencyCollections();
  assert.deepStrictEqual(sync.getSupabaseHealth(), { healthy: false, reason: 'read-failed' });
  reset();
});

it('diagnostics: [Firebase-Read] log lines exist for the health gate + every ungated path', () => {
  const app = fs.readFileSync('App.js', 'utf8');
  assert.ok(app.includes('[Firebase-Read]'), 'App.js pull-helper log');
  assert.ok(app.includes('getSupabaseHealth'), 'health reason used in the helper');
  assert.ok(app.includes('SKIPPED — Supabase route'), 'lifecycle pulls tagged when they use Supabase');
  assert.ok(app.includes('RUNNING Firebase fallback pull'), 'lifecycle pulls tagged when they fall back');
  const db = fs.readFileSync('database.js', 'utf8');
  for (const fn of ['executeManualPull', 'resyncSameDayFromCloud', 'fetchHistoricalDateData', 'fetchHistoricalMonthData', 'recoverMenuFromCloud', 'restoreFirebaseFromCloud', 'syncDailyAndMenuFromFirebase']) {
    assert.ok(db.includes(`[Firebase-Read] ${fn} triggered`), `${fn} log line`);
  }
  assert.ok(db.includes('daily_submit priority GET (processSyncQueue)'), 'daily_submit priority GET log');
});

it('App.js: pull toast has Supabase/Firebase wording (all apps)', () => {
  const code = fs.readFileSync('App.js', 'utf8');
  assert.ok(code.includes('setPullListener'), 'subscribes to the pull listener');
  assert.ok(code.includes('Supabase থেকে ডাটা pull হয়েছে'), 'supabase pull wording');
  assert.ok(code.includes('Firebase থেকে ডাটা pull হয়েছে'), 'firebase pull wording');
  assert.ok(!code.includes('ADMIN-only pull toast'), 'pull toast is NOT ADMIN-gated anymore');
});

it('App.js: every non-exempt Firebase pull is gated on Supabase health', () => {
  const code = fs.readFileSync('App.js', 'utf8');
  assert.ok(code.includes('runFirebasePullIfSupabaseDown'), 'gating helper present');
  assert.ok(code.includes("runFirebasePullIfSupabaseDown('auto-high-frequency-pull'"), 'high-freq timer gated');
  assert.ok(code.includes("runFirebasePullIfSupabaseDown('auto-tables-pull'"), 'tables timer gated');
  assert.ok(code.includes("runFirebasePullIfSupabaseDown('auto-deletions-pull'"), 'deletions timer gated');
  assert.ok(code.includes("runFirebasePullIfSupabaseDown('auto-low-frequency-pull'"), 'low-freq timer gated');
  assert.ok(code.includes('runPullPreferSupabase'), 'lifecycle pulls prefer Supabase');
  assert.ok(code.includes('refreshMenuFromCloud'), 'menu edits refresh via Supabase-first');
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
