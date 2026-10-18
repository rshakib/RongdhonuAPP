/**
 * Phase 13 — Sync heartbeat (Firebase/Supabase push+read observability).
 * Run with: node tests/phase13SyncHeartbeat.test.js
 *
 * Verifies the self-reported heartbeat that lets you confirm FROM SUPABASE that both
 * clouds are receiving writes, is throttled, isolated (never throws / never blocks
 * sync) and hooked into all four sync paths.
 */

'use strict';
const assert = require('assert');
const fs = require('fs');

console.log('======================================================');
console.log('   PHASE 13 — SYNC HEARTBEAT (OBSERVABILITY)          ');
console.log('======================================================\n');

let passed = 0;
let failed = 0;
const tests = [];
function it(desc, fn) { tests.push({ desc, fn }); }

const hb = require('../services/supabaseHeartbeat.js');

function fakeClient({ upsertError = null, rows = [] } = {}) {
  const upserts = [];
  return {
    __upserts: upserts,
    from() {
      return {
        upsert: (row, opts) => { upserts.push({ row, opts }); return Promise.resolve({ error: upsertError }); },
        select: () => {
          const c = { order: () => c, limit: () => c, then: (res) => Promise.resolve({ data: rows, error: null }).then(res) };
          return c;
        }
      };
    }
  };
}
function setup({ client = fakeClient(), enabled = true, configured = true, deviceId = 'dev_1' } = {}) {
  hb.__resetHeartbeatDepsForTesting();
  hb.__resetHeartbeatThrottleForTesting();
  hb.__setHeartbeatDepsForTesting({
    isEnabled: () => enabled,
    isConfigured: () => configured,
    getClient: () => client,
    getDeviceId: () => deviceId,
    getProfile: () => 'MANAGER',
    getAppVersion: () => '1.0.7'
  });
  return client;
}
function reset() { hb.__resetHeartbeatDepsForTesting(); hb.__resetHeartbeatThrottleForTesting(); }

// ---------------------------------------------------------------------------
it('push heartbeat: writes device_id/backend/last_push_at/last_push_ok', async () => {
  const client = setup();
  const ok = await hb.recordSyncHeartbeat({ backend: 'firebase', kind: 'push', rows: 3, ok: true, force: true });
  assert.strictEqual(ok, true, 'heartbeat written');
  assert.strictEqual(client.__upserts.length, 1);
  const { row, opts } = client.__upserts[0];
  assert.strictEqual(row.device_id, 'dev_1');
  assert.strictEqual(row.backend, 'firebase');
  assert.ok(row.last_push_at, 'last_push_at set');
  assert.strictEqual(row.last_push_ok, true);
  assert.strictEqual(row.last_read_at, undefined, 'read fields untouched on a push');
  assert.deepStrictEqual(opts, { onConflict: 'device_id,backend' }, 'upsert key');
  reset();
});

it('push failure records last_push_ok=false + last_error', async () => {
  const client = setup();
  await hb.recordSyncHeartbeat({ backend: 'firebase', kind: 'push', rows: 0, ok: false, error: 'HTTP 429', force: true });
  const { row } = client.__upserts[0];
  assert.strictEqual(row.last_push_ok, false);
  assert.strictEqual(row.last_error, 'HTTP 429');
  reset();
});

it('read heartbeat: writes last_read_at + last_rows', async () => {
  const client = setup();
  await hb.recordSyncHeartbeat({ backend: 'supabase', kind: 'read', rows: 12, force: true });
  const { row } = client.__upserts[0];
  assert.strictEqual(row.backend, 'supabase');
  assert.ok(row.last_read_at, 'last_read_at set');
  assert.strictEqual(row.last_rows, 12);
  assert.strictEqual(row.last_push_at, undefined, 'push fields untouched on a read');
  reset();
});

it('throttled: a second event inside the window is skipped; force bypasses', async () => {
  const client = setup();
  assert.strictEqual(await hb.recordSyncHeartbeat({ backend: 'supabase', kind: 'read' }), true, 'first write');
  assert.strictEqual(await hb.recordSyncHeartbeat({ backend: 'supabase', kind: 'read' }), false, 'second skipped');
  assert.strictEqual(client.__upserts.length, 1, 'no second upsert');
  assert.strictEqual(await hb.recordSyncHeartbeat({ backend: 'supabase', kind: 'read', force: true }), true, 'force bypasses');
  assert.strictEqual(client.__upserts.length, 2);
  reset();
});

it('isolated: disabled / unconfigured / no device id / upsert error ⇒ false, never throws', async () => {
  setup({ enabled: false });
  assert.strictEqual(await hb.recordSyncHeartbeat({ backend: 'firebase', kind: 'push', force: true }), false, 'disabled');
  setup({ configured: false });
  assert.strictEqual(await hb.recordSyncHeartbeat({ backend: 'firebase', kind: 'push', force: true }), false, 'unconfigured');
  setup({ deviceId: '' });
  assert.strictEqual(await hb.recordSyncHeartbeat({ backend: 'firebase', kind: 'push', force: true }), false, 'no device id');
  setup({ client: fakeClient({ upsertError: { message: 'RLS' } }) });
  assert.strictEqual(await hb.recordSyncHeartbeat({ backend: 'firebase', kind: 'push', force: true }), false, 'upsert error swallowed');
  reset();
});

it('fetchSyncHeartbeats: returns rows, never throws', async () => {
  setup({ client: fakeClient({ rows: [{ device_id: 'dev_1', backend: 'firebase' }] }) });
  const res = await hb.fetchSyncHeartbeats();
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.rows.length, 1);
  reset();
});

it('source: all four sync paths record a heartbeat', () => {
  const sSync = fs.readFileSync('services/supabaseSync.js', 'utf8');
  const sQueue = fs.readFileSync('services/supabaseSyncQueue.js', 'utf8');
  const db = fs.readFileSync('database.js', 'utf8');
  const app = fs.readFileSync('App.js', 'utf8');

  assert.ok(sSync.includes("recordSyncHeartbeat({ backend: 'supabase', kind: 'read' })"), 'supabase READ hook');
  assert.ok(sSync.includes("recordSyncHeartbeat({ backend: 'firebase', kind: 'read' })"), 'firebase READ hook (fallback)');
  assert.ok(sQueue.includes("recordSyncHeartbeat({ backend: 'supabase', kind: 'push'"), 'supabase PUSH hook');
  assert.ok(db.includes('recordSyncHeartbeat({') && db.includes("backend: 'firebase'") && db.includes("kind: 'push'"), 'firebase PUSH hook');
  assert.ok(app.includes("recordSyncHeartbeat({ backend: 'firebase', kind: 'read' })"), 'firebase read hook in App.js');
});

it('ui: Sync Health screen + sidebar entry + App wiring present', () => {
  const screen = fs.readFileSync('screens/SyncHealthScreen.js', 'utf8');
  const model = fs.readFileSync('services/syncHealthModel.js', 'utf8');
  const side = fs.readFileSync('components/AdminSideMenu.js', 'utf8');
  const adminDb = fs.readFileSync('screens/AdminDB.js', 'utf8');
  const app = fs.readFileSync('App.js', 'utf8');

  // Redesigned single-Supabase screen: renders the ONE server (SB) + backup (FB) and
  // delegates the "are the servers in step?" logic to the pure model.
  assert.ok(screen.includes("import { fetchSyncHeartbeats } from '../services/supabaseHeartbeat'"), 'screen reads heartbeats');
  assert.ok(screen.includes("from '../services/syncHealthModel'"), 'screen uses the pure health model');
  assert.ok(model.includes('export function buildSyncHealthModel'), 'model exposes buildSyncHealthModel');
  assert.ok(screen.includes('buildSyncHealthModel({'), 'screen calls the model');
  assert.ok(screen.includes('const DUAL_TABLES = ['), 'screen lists the dual-DB tables');
  assert.ok(screen.includes('Servers'), 'renders the Servers section');
  assert.ok(screen.includes('Read') && screen.includes('Written'), 'shows read + write per server');
  assert.ok(screen.includes('formatElapsedEn'), 'relative times come from the model');
  assert.ok(screen.includes('positionVerdict') && screen.includes('positionSummary'), 'headline verdict + ring summary');
  assert.ok(screen.includes('StatusRing'), 'status ring rendered');
  assert.ok(model.includes('SOURCES') && model.includes('SOURCE_SHORT'), 'model defines the sources');
  assert.ok(side.includes('onNavigateToSyncHealth'), 'sidebar prop');
  assert.ok(side.includes('title="ডেটা সেভের অবস্থা"'), 'sidebar row label (Bengali)');
  assert.ok(adminDb.includes('onNavigateToSyncHealth={onNavigateToSyncHealth}'), 'AdminDB passes it through');
  assert.ok(adminDb.includes('onNavigateToSyncHealth,'), 'AdminDB declares the prop');
  assert.ok(app.includes("import SyncHealthScreen from './screens/SyncHealthScreen'"), 'screen imported');
  assert.ok(app.includes("case 'SYNC_HEALTH':"), 'route registered');
  assert.ok(app.includes("onNavigateToSyncHealth={() => setCurrentScreen('SYNC_HEALTH')}"), 'dashboard wiring');
  assert.ok(app.includes("'SYNC_DIAGNOSTICS', 'SYNC_HEALTH',"), 'back-button sub-screen list');
});

it('sql: sync_heartbeat table + permissive policies present', () => {
  const sql = fs.readFileSync('supabase_full_setup.sql', 'utf8');
  const rls = fs.readFileSync('supabase_rls.sql', 'utf8');
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS public.sync_heartbeat'), 'table created');
  assert.ok(sql.includes('PRIMARY KEY (device_id, backend)'), 'composite PK for upsert');
  assert.ok(rls.includes('"Public read sync heartbeat"'), 'public read policy');
  assert.ok(rls.includes('"Permissive heartbeat insert"'), 'insert policy (upsert)');
  assert.ok(rls.includes('"Permissive heartbeat update"'), 'update policy (upsert conflict path)');
});

it('ui: SQLite write console (Database Explorer) + local push state (Sync Health)', () => {
  const dbCode = fs.readFileSync('database.js', 'utf8');
  const explorer = fs.readFileSync('screens/DatabaseExplorerScreen.js', 'utf8');
  const health = fs.readFileSync('screens/SyncHealthScreen.js', 'utf8');
  const model = fs.readFileSync('services/syncHealthModel.js', 'utf8');

  assert.ok(dbCode.includes('export function executeInspectorWrite'), 'write helper exported');
  assert.ok(dbCode.includes("normalized.startsWith('DELETE')") && dbCode.includes("normalized.startsWith('UPDATE')") && dbCode.includes("normalized.startsWith('INSERT')"), 'write helper allows only DELETE/UPDATE/INSERT');
  assert.ok(explorer.includes('executeInspectorWrite'), 'explorer uses the write helper');
  assert.ok(explorer.includes('চালান (DELETE / UPDATE / INSERT)'), 'run button present');
  assert.ok(explorer.includes('chipRow'), 'example chips for common fixes');
  assert.ok(explorer.includes("Alert.alert("), 'destructive confirm before running');

  // Performance: Sync Health must not run one query per table.
  assert.ok(health.includes('GROUP BY table_name, status'), 'queues aggregated in one query each');
  assert.ok(health.includes("key LIKE 'last_sync_time%'"), 'all cursors read in one query');
  assert.ok(!/for \(const t of DUAL_TABLES\)[\s\S]{0,400}safeQ\(/.test(health), 'no per-table query loop remains');

  // Fleet-wide per-table aggregation now lives in the pure model.
  assert.ok(model.includes('pendingTables'), 'aggregates per-table counts across ALL devices');
  assert.ok(model.includes('hasFleet'), 'model flags a fleet-wide backlog');
  assert.ok(fs.readFileSync('supabase_full_setup.sql', 'utf8').includes('pending_tables JSONB'), 'SQL has the fleet column');
  assert.ok(fs.readFileSync('supabase_full_setup.sql', 'utf8').includes('ADD COLUMN IF NOT EXISTS pending_tables'), 'SQL migrates an existing table');
  assert.ok(fs.readFileSync('services/supabaseHeartbeat.js', 'utf8').includes('includeTables'), 'heartbeat accepts a queue to publish');
  assert.ok(fs.readFileSync('services/supabaseHeartbeat.js', 'utf8').includes('readQueueCounts'), 'heartbeat reads per-table counts');
  assert.ok(fs.readFileSync('database.js', 'utf8').includes("includeTables: 'sync_queue'"), 'firebase hook publishes its queue');
  assert.ok(fs.readFileSync('services/supabaseSyncQueue.js', 'utf8').includes("includeTables: 'sync_queue_supabase'"), 'supabase hook publishes its queue');
  assert.ok(health.includes("FROM sync_queue_supabase"), 'sync health reads the supabase queue');
  assert.ok(health.includes("last_sync_time_supabase_"), 'sync health shows supabase cursors');
  assert.ok(health.includes('const DUAL_TABLES = ['), 'technical view lists only dual-DB tables');
  assert.ok(health.includes('deviceViews'), 'renders the per-phone view');
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
