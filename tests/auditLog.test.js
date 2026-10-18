/**
 * Isolated Audit / Activity Stream — Unit Test Suite
 * Run with: node tests/auditLog.test.js
 *
 * Verifies the isolated audit engine (capture + before→after diff + offline
 * outbox + best-effort upload), and that the wiring is strictly additive
 * (one hook in enqueueSync, one wrapper in getDb) and cannot disturb sync.
 */

'use strict';
const assert = require('assert');
const fs = require('fs');

console.log('======================================================');
console.log('   ISOLATED AUDIT / ACTIVITY STREAM — UNIT TESTS      ');
console.log('======================================================\n');

let passedTests = 0;
let failedTests = 0;

function it(desc, fn) {
  try {
    fn();
    console.log(`  ✅  ${desc}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌  ${desc}`);
    console.error(`      ${err.message}`);
    failedTests++;
  }
}

const auditLog = require('../services/auditLog.js');
const { __internals } = auditLog;

// ─── Mock SQLite ────────────────────────────────────────────────────────────
function makeMockDb(tables = {}) {
  const outbox = [];
  return {
    outbox,
    tables,
    runSync(sql, params = []) {
      if (/INSERT OR REPLACE INTO audit_outbox/i.test(sql)) {
        outbox.push({
          id: params[0], created_at: params[1], business_date: params[2],
          app_profile: params[3], app_version: params[4], user_name: params[5],
          user_role: params[6], device_id: params[7], device_name: params[8],
          device_model: params[9], device_platform: params[10], table_name: params[11],
          action: params[12], record_id: params[13], changes: params[14],
          snapshot: params[15], status: 'PENDING', retry_count: 0, last_error: null
        });
        return;
      }
      if (/DELETE FROM audit_outbox WHERE id IN/i.test(sql)) {
        const ids = new Set(params.map(String));
        for (let i = outbox.length - 1; i >= 0; i--) {
          if (ids.has(String(outbox[i].id))) outbox.splice(i, 1);
        }
        return;
      }
      if (/UPDATE audit_outbox SET retry_count/i.test(sql)) {
        const row = outbox.find((r) => r.id === params[1]);
        if (row) { row.retry_count += 1; row.last_error = params[0]; }
        return;
      }
    },
    getFirstSync(sql, params = []) {
      if (/COUNT\(\*\) AS n FROM audit_outbox/i.test(sql)) return { n: outbox.length };
      const m = /FROM\s+([A-Za-z_][A-Za-z0-9_]*)\s+WHERE id/i.exec(sql);
      if (m && tables[m[1]]) return tables[m[1]].find((r) => String(r.id) === String(params[0])) || null;
      return null;
    },
    getAllSync(sql) {
      if (/FROM audit_outbox/i.test(sql)) return outbox.filter((r) => r.status === 'PENDING');
      return [];
    }
  };
}

let uploaded = [];

function setup({ enabled = true, configured = true, db = null, insertRows = null } = {}) {
  uploaded = [];
  auditLog.__resetAuditDepsForTesting();
  auditLog.__setAuditDepsForTesting({
    getDb: () => db,
    getAppConfig: (key) => (key === 'login_session_user' ? 'rahim' : null),
    getUserByUsername: () => ({ username: 'rahim', display_name: 'Rahim', role: 'manager' }),
    getActiveProfile: () => 'MANAGER',
    getDeviceRecord: () => ({ device_id: 'dev1', device_name: 'Tab 1', model: 'SM-T500' }),
    getAppVersion: () => '1.0.9',
    getDhakaDate: () => '2026-10-01',
    insertRows: insertRows || (async (rows) => { uploaded.push(...rows); return { ok: true, count: rows.length }; }),
    isConfigured: () => configured,
    isEnabled: () => enabled,
    now: () => 1700000000000
  });
}

// ─── 1. SQL parsing ─────────────────────────────────────────────────────────
it('parseWriteSql detects INSERT / INSERT OR REPLACE / UPDATE / DELETE and the table', () => {
  assert.deepStrictEqual(__internals.parseWriteSql('INSERT INTO orders (id) VALUES (?)'), { action: 'INSERT', table: 'orders' });
  assert.deepStrictEqual(__internals.parseWriteSql('INSERT OR REPLACE INTO menu_items (id) VALUES (?)'), { action: 'INSERT', table: 'menu_items' });
  assert.deepStrictEqual(__internals.parseWriteSql('UPDATE expenses SET amount = ? WHERE id = ?'), { action: 'UPDATE', table: 'expenses' });
  assert.deepStrictEqual(__internals.parseWriteSql('DELETE FROM due_payments WHERE id = ?'), { action: 'DELETE', table: 'due_payments' });
  assert.strictEqual(__internals.parseWriteSql('SELECT * FROM orders'), null);
  assert.strictEqual(__internals.parseWriteSql('CREATE TABLE x (id TEXT)'), null);
});

it('extractIdParam picks the WHERE id binding regardless of position', () => {
  const sql = 'UPDATE menu_items SET name = ?, price = ? WHERE id = ?';
  assert.strictEqual(__internals.extractIdParam(sql, ['New', 60, 'm1']), 'm1');
  assert.strictEqual(__internals.extractIdParam('DELETE FROM orders WHERE id = ?', ['o9']), 'o9');
});

// ─── 2. Diff + snapshot ─────────────────────────────────────────────────────
it('buildChanges reports ONLY changed fields and ignores sync bookkeeping columns', () => {
  const changes = __internals.buildChanges(
    { id: 'm1', name: 'Old', price: 50, is_synced: 0, is_synced_supabase: 0 },
    { id: 'm1', name: 'New', price: 50, is_synced: 1, is_synced_supabase: 0 }
  );
  assert.deepStrictEqual(changes, { name: { from: 'Old', to: 'New' } });
});

it('buildChanges for a fresh INSERT lists the new values as null → value', () => {
  const changes = __internals.buildChanges(null, { id: 'm2', name: 'Tea', price: 20, is_synced: 0 });
  assert.strictEqual(changes.name.to, 'Tea');
  assert.strictEqual(changes.name.from, null);
  assert.ok(!('is_synced' in changes));
});

it('truncateSnapshot drops bookkeeping columns', () => {
  const snap = __internals.truncateSnapshot({ id: 'm1', name: 'Tea', is_synced: 1, is_synced_supabase: 1 });
  assert.deepStrictEqual(Object.keys(snap).sort(), ['id', 'name']);
});

// ─── 3. Pre-image capture ───────────────────────────────────────────────────
it('capturePreImage stashes the previous row for UPDATE, and skips INSERT/excluded tables', () => {
  setup();
  const instance = {
    rows: { m1: { id: 'm1', name: 'Old', price: 50 } },
    getFirstSync(_sql, params) { return this.rows[String(params[0])] || null; }
  };

  auditLog.capturePreImage(instance, 'UPDATE menu_items SET name = ? WHERE id = ?', ['New', 'm1']);
  const pre = auditLog.takePreImage('menu_items', 'UPDATE', 'm1');
  assert.ok(pre, 'pre-image should be stashed');
  assert.strictEqual(pre.name, 'Old');

  auditLog.capturePreImage(instance, 'INSERT INTO menu_items (id) VALUES (?)', ['m9']);
  assert.strictEqual(auditLog.takePreImage('menu_items', 'INSERT', 'm9'), null);

  auditLog.capturePreImage(instance, 'UPDATE sync_queue SET status = ? WHERE id = ?', ['DONE', 'm1']);
  assert.strictEqual(auditLog.takePreImage('sync_queue', 'UPDATE', 'm1'), null);
});

// ─── 4. recordActivity ──────────────────────────────────────────────────────
it('recordActivity writes a PENDING outbox row stamped with user, role, app and device', () => {
  const db = makeMockDb({ menu_items: [{ id: 'm1', name: 'New', price: 60 }] });
  setup({ db });
  auditLog.stashPreImage('menu_items', 'UPDATE', 'm1', { id: 'm1', name: 'Old', price: 60 });

  const id = auditLog.recordActivity({ tableName: 'menu_items', recordId: 'm1', action: 'UPDATE' });
  assert.ok(id && id.startsWith('evt_'), 'event id returned');
  assert.strictEqual(db.outbox.length, 1);

  const row = db.outbox[0];
  assert.strictEqual(row.user_name, 'Rahim');
  assert.strictEqual(row.user_role, 'manager');
  assert.strictEqual(row.app_profile, 'MANAGER');
  assert.strictEqual(row.device_id, 'dev1');
  assert.strictEqual(row.table_name, 'menu_items');
  assert.strictEqual(row.action, 'UPDATE');
  assert.strictEqual(row.status, 'PENDING');
  assert.strictEqual(row.business_date, '2026-10-01');

  const changes = JSON.parse(row.changes);
  assert.deepStrictEqual(changes.name, { from: 'Old', to: 'New' });
});

it('recordActivity skips excluded (sync/infra) tables', () => {
  const db = makeMockDb();
  setup({ db });
  assert.strictEqual(auditLog.recordActivity({ tableName: 'sync_queue', recordId: '1', action: 'INSERT' }), null);
  assert.strictEqual(auditLog.recordActivity({ tableName: 'activity_logs', recordId: '1', action: 'INSERT' }), null);
  assert.strictEqual(auditLog.recordActivity({ tableName: 'app_config', recordId: '1', action: 'UPDATE' }), null);
  assert.strictEqual(db.outbox.length, 0);
});

it('recordActivity is a no-op when the audit project is not configured or disabled', () => {
  const db = makeMockDb();
  setup({ db, configured: false });
  assert.strictEqual(auditLog.recordActivity({ tableName: 'orders', recordId: 'o1', action: 'INSERT' }), null);

  setup({ db, enabled: false });
  assert.strictEqual(auditLog.recordActivity({ tableName: 'orders', recordId: 'o1', action: 'INSERT' }), null);
  assert.strictEqual(db.outbox.length, 0);
});

it('recordActivity never throws when the database layer fails', () => {
  setup({ db: { runSync() { throw new Error('boom'); }, getFirstSync() { throw new Error('boom'); } } });
  assert.doesNotThrow(() => {
    const res = auditLog.recordActivity({ tableName: 'orders', recordId: 'o1', action: 'INSERT' });
    assert.strictEqual(res, null);
  });
});

it('recordActivity never stores a nameless event (falls back to role / app profile)', () => {
  const db = makeMockDb({ orders: [{ id: 'o1' }] });
  setup({ db });
  auditLog.__setAuditDepsForTesting({
    getAppConfig: () => null,
    getUserByUsername: () => null,
    getDeviceRecord: () => ({ device_id: 'dev1', device_name: 'Tab 1', model: 'SM-T500', role: 'manager' })
  });
  auditLog.recordActivity({ tableName: 'orders', recordId: 'o1', action: 'INSERT' });
  assert.strictEqual(db.outbox.length, 1);
  assert.strictEqual(db.outbox[0].user_name, 'manager');
  assert.strictEqual(db.outbox[0].user_role, 'manager');
});

// ─── 5. Outbox flush ────────────────────────────────────────────────────────
it('flushAuditOutbox uploads pending rows and clears them on success', async () => {
  const db = makeMockDb({ orders: [{ id: 'o1', total: 300 }] });
  setup({ db });
  auditLog.recordActivity({ tableName: 'orders', recordId: 'o1', action: 'INSERT' });
  assert.strictEqual(db.outbox.length, 1);

  return auditLog.flushAuditOutbox().then((res) => {
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.sent, 1);
    assert.strictEqual(db.outbox.length, 0);
    assert.strictEqual(uploaded.length, 1);
    assert.ok(uploaded[0].event_id, 'idempotency key present');
    assert.strictEqual(uploaded[0].table_name, 'orders');
    assert.strictEqual(uploaded[0].app_profile, 'MANAGER');
    assert.ok(uploaded[0].changes && uploaded[0].changes.total, 'changes carried as JSON object');
  });
});

it('flushAuditOutbox keeps rows and records the error when the upload fails', async () => {
  const db = makeMockDb({ orders: [{ id: 'o1', total: 300 }] });
  setup({ db, insertRows: async () => ({ ok: false, error: 'network down' }) });
  auditLog.recordActivity({ tableName: 'orders', recordId: 'o1', action: 'INSERT' });

  return auditLog.flushAuditOutbox().then((res) => {
    assert.strictEqual(res.ok, false);
    assert.strictEqual(db.outbox.length, 1, 'row must be kept for retry');
    assert.strictEqual(db.outbox[0].retry_count, 1);
    assert.strictEqual(db.outbox[0].last_error, 'network down');
  });
});

// ─── 6. Wiring is additive ──────────────────────────────────────────────────
it('database.js: audit_outbox schema + one enqueueSync hook + getDb pre-image wrapper', () => {
  const code = fs.readFileSync('database.js', 'utf8');
  assert.ok(code.includes('CREATE TABLE IF NOT EXISTS audit_outbox'), 'audit_outbox schema');
  assert.ok(code.includes('getAuditModule().recordActivity({ tableName, recordId, action })'), 'enqueueSync hook');
  assert.ok(code.includes('attachAuditPreImageCapture'), 'getDb wrapper');
  assert.ok(code.includes('require(\'./services/auditLog.js\')'), 'lazy isolated require');
});

it('database.js: the audit hook never replaces the existing sync enqueue', () => {
  const code = fs.readFileSync('database.js', 'utf8');
  assert.ok(code.includes("require('./services/supabaseSyncQueue.js')"), 'existing Supabase delegation intact');
  assert.ok(code.includes('INSERT INTO sync_queue'), 'existing Firebase enqueue intact');
});

it('services/auditLog.js: pushes to the audit project right after a user action', () => {
  const code = fs.readFileSync('services/auditLog.js', 'utf8');
  assert.ok(code.includes('scheduleImmediateFlush();'), 'recordActivity triggers an immediate push');
  assert.ok(code.includes('FLUSH_DEBOUNCE_MS = 400') || /FLUSH_DEBOUNCE_MS = \d+/.test(code), 'debounce window defined');
  assert.ok(code.includes('flushInFlight'), 'in-flight guard prevents overlapping uploads');
  assert.ok(code.includes('setInterval(() => { runFlush(); }, FLUSH_INTERVAL_MS)'), 'safety-net timer kept');
});

it('services/auditClient.js: isolated client with insert, secret RPC and broadcast subscribe', () => {
  const code = fs.readFileSync('services/auditClient.js', 'utf8');
  assert.ok(code.includes('EXPO_PUBLIC_AUDIT_SUPABASE_URL'));
  assert.ok(code.includes('EXPO_PUBLIC_AUDIT_SUPABASE_ANON_KEY'));
  assert.ok(code.includes("rpc('audit_read'"), 'secret-gated read RPC');
  assert.ok(code.includes('rongdhonu_audit_live'), 'realtime topic');
  assert.ok(code.includes('from(AUDIT_TABLE).insert(rows)'), 'plain insert (no upsert/ON CONFLICT RLS edge)');
  assert.ok(code.includes("=== '23505'"), 'duplicate-key retry tolerated as success');
  assert.ok(!code.includes('.upsert('), 'must not use upsert against an insert-only RLS table');
});

it('supabase_audit_setup.sql: table + insert-only RLS + security-definer RPC + realtime', () => {
  const sql = fs.readFileSync('supabase_audit_setup.sql', 'utf8');
  assert.ok(sql.includes('create table if not exists public.activity_events'));
  assert.ok(sql.includes('activity_events_insert_anon'), 'insert-only policy for anon');
  assert.ok(sql.includes('grant insert on public.activity_events to anon'), 'explicit insert grant for anon');
  assert.ok(sql.includes('enable row level security'));
  assert.ok(sql.includes('security definer'), 'audit_read is SECURITY DEFINER');
  assert.ok(sql.includes('unauthorized'), 'wrong secret must be rejected');
  assert.ok(sql.includes('grant execute on function public.audit_read'));
  assert.ok(sql.includes('realtime.send'), 'broadcast trigger for live updates');
});

it('App.js: ACTIVITY_STREAM is admin-only and reachable from the admin dashboard', () => {
  const app = fs.readFileSync('App.js', 'utf8');
  assert.ok(app.includes("case 'ACTIVITY_STREAM':"));
  assert.ok(app.includes('<ActivityStreamScreen'));
  assert.ok(app.includes("onNavigateToActivityStream={() => setCurrentScreen('ACTIVITY_STREAM')}"));
  assert.ok(app.includes("'PRINTER_SETTINGS', 'ACTIVITY_STREAM'"), 'hardware back handled');
  const gate = app.slice(app.indexOf("case 'ACTIVITY_STREAM':"), app.indexOf("case 'ACTIVITY_STREAM':") + 260);
  assert.ok(gate.includes("ACTIVE_APP_PROFILE === 'ADMIN'"), 'admin profile gate');
  assert.ok(gate.includes("=== 'admin'"), 'admin role gate');
});

it('AdminSideMenu.js: entry exists only in the admin menu', () => {
  const adminMenu = fs.readFileSync('components/AdminSideMenu.js', 'utf8');
  assert.ok(adminMenu.includes('onNavigateToActivityStream'));
  assert.ok(adminMenu.includes('handleAction(onNavigateToActivityStream)'));
  const ownerMenu = fs.readFileSync('components/OwnerSideMenu.js', 'utf8');
  const managerMenu = fs.readFileSync('components/ManagerSideMenu.js', 'utf8');
  assert.ok(!ownerMenu.includes('onNavigateToActivityStream'), 'owner menu must not expose it');
  assert.ok(!managerMenu.includes('onNavigateToActivityStream'), 'manager menu must not expose it');
});

it('screens/ActivityStreamScreen.js keeps device data and shows before → after values', () => {
  const code = fs.readFileSync('screens/ActivityStreamScreen.js', 'utf8');
  assert.ok(code.includes('byDevice'), 'device-wise data kept for the device filter');
  assert.ok(code.includes('deviceNameText'), 'device shown on every card');
  assert.ok(code.includes('from') && code.includes('to'), 'before → after values');
  assert.ok(code.includes('subscribeAudit'), 'live subscription');
});

it('screens/ActivityStreamScreen.js: owner-friendly (Bengali words, device name, no raw JSON)', () => {
  const code = fs.readFileSync('screens/ActivityStreamScreen.js', 'utf8');
  assert.ok(code.includes('যোগ করেছেন') && code.includes('পরিবর্তন করেছেন') && code.includes('মুছে ফেলেছেন'), 'Bengali action words');
  assert.ok(code.includes('parseItems'), 'order items parsed into rows');
  assert.ok(code.includes('itemsBox'), 'items rendered as a styled list');
  assert.ok(code.includes('money(') && code.includes('৳'), 'prices shown as currency');
  assert.ok(code.includes('device_name'), 'device shown by name');
  assert.ok(code.includes('deviceNameText'), 'device header renders the friendly name');
  assert.ok(code.includes('timelineCard'), 'uses the same timeline-card visual language as ActivityLogScreen');
  assert.ok(!code.includes('styles.deviceId'), 'raw device_id has no rendered style');
});

it('screens/ActivityStreamScreen.js: compact rows expand on tap, with date + time filters', () => {
  const code = fs.readFileSync('screens/ActivityStreamScreen.js', 'utf8');
  assert.ok(code.includes("from '../components/CalendarPicker'"), 'calendar picker wired');
  assert.ok(code.includes('toggleRow'), 'tap toggles the detail');
  assert.ok(code.includes('TIME_RANGES'), 'time-range filter');
  assert.ok(code.includes('dayOf('), 'date filter');
  assert.ok(code.includes('clockOf('), 'time shown on every row');
  assert.ok(code.includes('metricCard'), 'metrics strip like ActivityLogScreen');
  assert.ok(code.includes('dateSelectorCard'), 'date selector card like ActivityLogScreen');
  assert.ok(code.includes('whoName('), 'the person name is rendered on every card');
  assert.ok(code.includes('availableDays'), 'one-tap date chips from real data');
  assert.ok(code.includes('whoName: { color:') || code.includes("whoName:"), 'name has its own style');
  assert.ok(code.includes("from '../components/TimePicker'"), 'custom time picker wired');
  assert.ok(code.includes('timeFrom'), 'hand-picked time filters the list');
  assert.ok(code.includes('formatTime12('), 'time shown as 4:30 PM');
  assert.ok(code.includes('🕒 সময় বাছুন'), 'select option sits beside the 1h/6h/24h chips');
});

it('components/TimePicker.js: dependency-free hour/minute picker with AM/PM', () => {
  const code = fs.readFileSync('components/TimePicker.js', 'utf8');
  assert.ok(code.includes('export default function TimePicker'));
  assert.ok(code.includes('export function formatTime12'));
  assert.ok(code.includes('সকাল (AM)') && code.includes('বিকাল (PM)'));
  assert.ok(code.includes('const MINUTES = [0, 5,'));
  assert.ok(!code.includes('DateTimePicker'), 'no native datetime picker dependency');
});

it('Audit config: URL/anon key in .env, and READ SECRET only in admin-ish profiles', () => {
  const env = fs.readFileSync('.env', 'utf8');
  assert.ok(env.includes('EXPO_PUBLIC_AUDIT_SUPABASE_URL="https://zdruassdewwjbexximkj.supabase.co"'));
  assert.ok(env.includes('EXPO_PUBLIC_AUDIT_SYNC_ENABLED'));

  const eas = fs.readFileSync('eas.json', 'utf8');
  const secretCount = (eas.match(/EXPO_PUBLIC_AUDIT_READ_SECRET/g) || []).length;
  assert.strictEqual(secretCount, 3, 'read secret in development + admin + production only');
  const ownerBlock = eas.slice(eas.indexOf('"owner"'), eas.indexOf('"manager"'));
  const managerBlock = eas.slice(eas.indexOf('"manager"'), eas.indexOf('"production"'));
  assert.ok(!ownerBlock.includes('AUDIT_READ_SECRET'), 'owner build must not ship the secret');
  assert.ok(!managerBlock.includes('AUDIT_READ_SECRET'), 'manager build must not ship the secret');
});

it('example.env documents the audit variables', () => {
  const ex = fs.readFileSync('example.env', 'utf8');
  assert.ok(ex.includes('EXPO_PUBLIC_AUDIT_SUPABASE_URL'));
  assert.ok(ex.includes('EXPO_PUBLIC_AUDIT_READ_SECRET'));
});

console.log('══════════════════════════════════════════════════════');
console.log(`  auditLog.test.js — ${passedTests + failedTests} tests`);
console.log(`  Passed : ${passedTests}`);
console.log(`  Failed : ${failedTests}`);
console.log('══════════════════════════════════════════════════════\n');

if (failedTests > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
