/**
 * Phase 15 — Realtime change-signal (Broadcast) + adaptive polling.
 * Run with: node tests/realtimeSignal.test.js
 *
 * Design: ~/.commandcode/plans/realtime-signal-polling.md
 * Verifies: kill switch, sender coalescing (and that it fires ONLY after a confirmed
 * cloud write), receiver validation/own-signal drop/rate limiting/stage gating, the
 * SUBSCRIBED→slow / error→fast mode machine, the per-subscribe catch-up pull, and that
 * nothing here can throw into the push path.
 */

'use strict';
const assert = require('assert');
const fs = require('fs');

console.log('======================================================');
console.log('   PHASE 15 — REALTIME CHANGE-SIGNAL + ADAPTIVE POLL   ');
console.log('======================================================\n');

let passed = 0;
let failed = 0;
const tests = [];
function it(desc, fn) { tests.push({ desc, fn }); }

const RS = require('../services/realtimeSignal.js');
const sync = require('../services/supabaseSync.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeFakeChannel() {
  const ch = {
    topic: `realtime:${RS.SIGNAL_CHANNEL_NAME}`,
    name: null,
    cfg: null,
    state: 'closed',
    sends: [],
    handlers: [],
    subCb: null,
    on(_type, filter, cb) { this.handlers.push({ filter, cb }); return this; },
    subscribe(cb) { this.subCb = cb; this.state = 'joined'; return this; },
    send(msg) { this.sends.push(msg); return Promise.resolve('ok'); },
    unsubscribe() { this.state = 'closed'; },
    __emit(payload) {
      for (const h of this.handlers) {
        if (h.filter && h.filter.event === RS.SIGNAL_EVENT) h.cb({ payload });
      }
    },
    __setStatus(status) { if (this.subCb) this.subCb(status); }
  };
  return ch;
}

function makeFakeClient({ sendImpl } = {}) {
  const channels = [];
  return {
    channels,
    channel(name, cfg) {
      const ch = makeFakeChannel();
      ch.name = name;
      ch.cfg = cfg;
      if (sendImpl) ch.send = (msg) => { ch.sends.push(msg); return sendImpl(msg); };
      channels.push(ch);
      return ch;
    },
    getChannels() { return channels; },
    removeChannel(ch) { ch.state = 'closed'; }
  };
}

/** Fresh module state + started channel; returns handles for assertions. */
function setup({ enabled = true, configured = true, subscribe = true, sendImpl } = {}) {
  RS.__resetRealtimeSignalDepsForTesting();
  const client = makeFakeClient({ sendImpl });
  RS.__setRealtimeSignalDepsForTesting({
    getClient: () => client,
    isConfigured: () => configured,
    isEnabled: () => enabled,
    now: () => Date.now()
  });
  const pulls = [];
  const kicks = [];
  const started = RS.startRealtimeSignal({
    deviceId: 'dev_me',
    onPull: (group) => pulls.push(group),
    onModeChange: () => kicks.push(1)
  });
  const ch = client.channels[0] || null;
  if (subscribe && ch) ch.__setStatus('SUBSCRIBED');
  return { client, ch, pulls, kicks, started };
}

// ---------------------------------------------------------------------------
it('kill switch: default true; false/0/off/no disable it', () => {
  const prev = process.env.EXPO_PUBLIC_REALTIME_SIGNAL_ENABLED;
  try {
    delete process.env.EXPO_PUBLIC_REALTIME_SIGNAL_ENABLED;
    assert.strictEqual(RS.isRealtimeSignalEnabled(), true, 'default is enabled');
    for (const v of ['false', '0', 'off', 'no', 'FALSE', ' Off ']) {
      process.env.EXPO_PUBLIC_REALTIME_SIGNAL_ENABLED = v;
      assert.strictEqual(RS.isRealtimeSignalEnabled(), false, `disabled for "${v}"`);
    }
    for (const v of ['true', '1', 'yes']) {
      process.env.EXPO_PUBLIC_REALTIME_SIGNAL_ENABLED = v;
      assert.strictEqual(RS.isRealtimeSignalEnabled(), true, `enabled for "${v}"`);
    }
  } finally {
    if (prev === undefined) delete process.env.EXPO_PUBLIC_REALTIME_SIGNAL_ENABLED;
    else process.env.EXPO_PUBLIC_REALTIME_SIGNAL_ENABLED = prev;
  }
});

it('kill switch off ⇒ no channel, no send, mode stays fast (byte-equivalent to old polling)', () => {
  RS.__resetRealtimeSignalDepsForTesting();
  const client = makeFakeClient();
  RS.__setRealtimeSignalDepsForTesting({ getClient: () => client, isConfigured: () => true, isEnabled: () => false });
  const ok = RS.startRealtimeSignal({ deviceId: 'dev_me', onPull: () => {} });
  assert.strictEqual(ok, false, 'start reports not-started');
  assert.strictEqual(client.channels.length, 0, 'no channel created');
  assert.strictEqual(RS.notifyDataChanged('restaurant_tables'), false, 'no signal emitted');
  assert.strictEqual(RS.getSignalMode('tables'), 'fast', 'tables poller stays fast');
  assert.strictEqual(RS.getSignalMode('high'), 'fast', 'high poller stays fast');
});

it('unconfigured / no device id ⇒ no channel, mode fast', () => {
  RS.__resetRealtimeSignalDepsForTesting();
  const client = makeFakeClient();
  RS.__setRealtimeSignalDepsForTesting({ getClient: () => client, isConfigured: () => false, isEnabled: () => true });
  assert.strictEqual(RS.startRealtimeSignal({ deviceId: 'dev_me', onPull: () => {} }), false);
  assert.strictEqual(client.channels.length, 0);
  assert.strictEqual(RS.getSignalMode('tables'), 'fast');

  RS.__resetRealtimeSignalDepsForTesting();
  const client2 = makeFakeClient();
  RS.__setRealtimeSignalDepsForTesting({ getClient: () => client2, isConfigured: () => true, isEnabled: () => true });
  assert.strictEqual(RS.startRealtimeSignal({ deviceId: null, onPull: () => {} }), false, 'no device id → no channel');
  assert.strictEqual(client2.channels.length, 0);
});

it('channel is public with self:false + ack:true, and receives via the data-changed event', () => {
  const { ch } = setup();
  assert.ok(ch, 'channel created');
  assert.strictEqual(ch.name, RS.SIGNAL_CHANNEL_NAME, 'channel name');
  assert.deepStrictEqual(ch.cfg, { config: { broadcast: { self: false, ack: true } } }, 'public channel, no self-echo, ack on');
  assert.strictEqual(ch.handlers.length, 1, 'exactly one broadcast listener');
  assert.strictEqual(ch.handlers[0].filter.event, RS.SIGNAL_EVENT, 'listens on data-changed');
});

it('sender coalesces a burst into ONE data-free signal carrying all tables', async () => {
  const { ch } = setup();
  for (const t of ['orders', 'order_items', 'payments', 'deliveries', 'restaurant_tables']) {
    assert.strictEqual(RS.notifyDataChanged(t), true, `queued ${t}`);
  }
  await sleep(700);
  assert.strictEqual(ch.sends.length, 1, 'one broadcast for the whole burst');
  const sent = ch.sends[0];
  assert.strictEqual(sent.type, 'broadcast');
  assert.strictEqual(sent.event, RS.SIGNAL_EVENT);
  assert.deepStrictEqual(
    sent.payload.tables.slice().sort(),
    ['deliveries', 'order_items', 'orders', 'payments', 'restaurant_tables'],
    'payload lists every changed table'
  );
  assert.strictEqual(sent.payload.sender_device_id, 'dev_me', 'carries our device id');
  assert.ok(typeof sent.payload.ts === 'string' && sent.payload.ts.includes('T'), 'carries a timestamp');
  const keys = Object.keys(sent.payload).sort();
  assert.deepStrictEqual(keys, ['sender_device_id', 'tables', 'ts'], 'NO row data in the payload');

  RS.notifyDataChanged('orders');
  await sleep(700);
  assert.strictEqual(ch.sends.length, 2, 'a later burst sends a second signal');
});

it('sender ignores excluded/unknown tables and does nothing while unsubscribed', () => {
  const { ch } = setup();
  assert.strictEqual(RS.notifyDataChanged('app_config'), false, 'app_config is never signalled');
  assert.strictEqual(RS.notifyDataChanged('not_a_table'), false, 'unknown table ignored');
  assert.strictEqual(RS.notifyDataChanged(null), false, 'null ignored');
  assert.strictEqual(ch.sends.length, 0, 'nothing sent');

  RS.stopRealtimeSignal();
  assert.strictEqual(RS.notifyDataChanged('restaurant_tables'), false, 'stopped → no signal');
  assert.strictEqual(RS.getSignalMode('tables'), 'fast', 'stopped → fast');
});

it('source: the signal is emitted ONLY from the confirmed-success branch of the Supabase queue', () => {
  const src = fs.readFileSync('services/supabaseSyncQueue.js', 'utf8');
  const okIdx = src.indexOf('if (ok) {');
  const callIdx = src.indexOf('notifyDataChanged(tableName)');
  const elseIdx = src.indexOf('} else {', okIdx);
  assert.ok(okIdx > -1, 'success branch exists');
  assert.ok(callIdx > okIdx, 'notifyDataChanged is called from inside if (ok)');
  assert.ok(callIdx < elseIdx, 'and before the failure branch');
  assert.strictEqual(src.split('notifyDataChanged(').length - 1, 1, 'exactly one call site');
});

it('receiver drops our own signal', async () => {
  const { ch, pulls } = setup();
  await sleep(450);   // let the SUBSCRIBED catch-up pull land first
  pulls.length = 0;
  ch.__emit({ tables: ['restaurant_tables'], ts: new Date().toISOString(), sender_device_id: 'dev_me' });
  await sleep(450);
  assert.deepStrictEqual(pulls, [], 'own signal never triggers a pull');
});

it('receiver drops malformed, empty and unknown-table payloads', async () => {
  const { ch, pulls } = setup();
  await sleep(450);
  pulls.length = 0;
  for (const bad of [
    null, undefined, {}, { tables: [] }, { tables: 'restaurant_tables' },
    { tables: ['foo', 42], sender_device_id: 'other' }, { tables: [null], sender_device_id: 'other' }
  ]) {
    ch.__emit(bad);
  }
  await sleep(450);
  assert.deepStrictEqual(pulls, [], 'no pull for any malformed payload');
});

it('stage gating: the group flag decides — off ⇒ ignored + fast, on ⇒ pulls + slow', async () => {
  const shipped = RS.ENABLED_GROUPS.high;
  assert.strictEqual(RS.ENABLED_GROUPS.tables, true, 'tables is always signal-driven');
  try {
    // --- flag OFF: that group's tables must be ignored entirely -------------
    RS.ENABLED_GROUPS.high = false;
    let s = setup();
    await sleep(450);    // SUBSCRIBED catch-up pull lands here…
    await sleep(1100);   // …so clear its 1s signal rate-limit window before testing signals
    s.pulls.length = 0;
    assert.strictEqual(RS.getSignalMode('high'), 'fast', 'disabled group stays FAST even when subscribed');
    s.ch.__emit({ tables: ['orders'], sender_device_id: 'other' });
    await sleep(450);
    assert.deepStrictEqual(s.pulls, [], 'disabled group ignores its tables');
    s.ch.__emit({ tables: ['restaurant_tables'], sender_device_id: 'other' });
    await sleep(450);
    assert.deepStrictEqual(s.pulls, ['tables'], 'the tables group still pulls');
    RS.stopRealtimeSignal();

    // --- flag ON: the same signal now routes to the high group --------------
    RS.ENABLED_GROUPS.high = true;
    s = setup();
    await sleep(450);
    await sleep(1100);
    s.pulls.length = 0;
    assert.strictEqual(RS.getSignalMode('high'), 'slow', 'enabled group slows while subscribed');
    s.ch.__emit({ tables: ['order_items'], sender_device_id: 'other' });
    await sleep(450);
    assert.deepStrictEqual(s.pulls, ['high'], 'enabled high group pulls');
    RS.stopRealtimeSignal();
  } finally {
    RS.ENABLED_GROUPS.high = shipped;
  }
});

it('receiver rate-limits signal-triggered pulls (anti-amplification)', async () => {
  const { ch, pulls } = setup();
  await sleep(450);    // catch-up pull…
  await sleep(1100);   // …rate window cleared
  pulls.length = 0;
  for (let i = 0; i < 5; i++) {
    ch.__emit({ tables: ['restaurant_tables'], sender_device_id: 'other' });
    await sleep(60);
  }
  await sleep(500);
  assert.strictEqual(pulls.length, 1, 'a burst of signals collapses to one pull');
});

it('mode machine: SUBSCRIBED→slow, error/timeout/close→fast, and each change kicks the pollers', () => {
  RS.__resetRealtimeSignalDepsForTesting();
  const client = makeFakeClient();
  RS.__setRealtimeSignalDepsForTesting({ getClient: () => client, isConfigured: () => true, isEnabled: () => true });
  const kicks = [];
  RS.startRealtimeSignal({ deviceId: 'd1', onPull: () => {}, onModeChange: () => kicks.push(1) });
  const ch = client.channels[0];

  assert.strictEqual(RS.getSignalMode('tables'), 'fast', 'fast before subscribe');
  assert.strictEqual(RS.isSignalSubscribed(), false);

  ch.__setStatus('SUBSCRIBED');
  assert.strictEqual(RS.getSignalMode('tables'), 'slow', 'slow while subscribed');
  assert.strictEqual(RS.isSignalSubscribed(), true);
  assert.ok(kicks.length >= 1, 'pollers kicked on subscribe');

  for (const bad of ['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED']) {
    ch.__setStatus(bad);
    assert.strictEqual(RS.getSignalMode('tables'), 'fast', `fast after ${bad}`);
    assert.strictEqual(RS.isSignalSubscribed(), false);
  }
  assert.ok(kicks.length > 1, 'pollers kicked on failure too');
  RS.stopRealtimeSignal();
});

it('every SUBSCRIBED triggers exactly one catch-up pull per enabled group', async () => {
  const expected = Object.keys(RS.ENABLED_GROUPS).filter((g) => RS.ENABLED_GROUPS[g]).sort();
  const { ch, pulls } = setup();
  await sleep(450);
  assert.deepStrictEqual(pulls.slice().sort(), expected, 'catch-up covers every enabled group');

  pulls.length = 0;
  ch.__setStatus('TIMED_OUT');
  ch.__setStatus('SUBSCRIBED');
  await sleep(450);
  assert.deepStrictEqual(pulls.slice().sort(), expected, 'catch-up again after resubscribe');
  RS.stopRealtimeSignal();
});

it('notifyDataChanged never throws — no channel, bad input, or a rejecting send', async () => {
  RS.__resetRealtimeSignalDepsForTesting();
  assert.doesNotThrow(() => RS.notifyDataChanged('restaurant_tables'), 'no channel');
  assert.doesNotThrow(() => RS.notifyDataChanged(undefined), 'undefined');

  const { ch } = setup({ sendImpl: () => Promise.reject(new Error('boom')) });
  assert.doesNotThrow(() => RS.notifyDataChanged('orders'));
  await sleep(700);
  assert.strictEqual(ch.sends.length, 1, 'the send was attempted');
  RS.stopRealtimeSignal();
});

it('mapping is shared with the pull functions (single source of truth)', () => {
  const src = fs.readFileSync('services/supabaseSync.js', 'utf8');
  assert.deepStrictEqual(sync.SIGNAL_GROUPS.tables, ['restaurant_tables'], 'tables group');
  assert.deepStrictEqual(sync.SIGNAL_GROUPS.high, ['orders', 'order_items', 'payments', 'deliveries'], 'high group');
  assert.deepStrictEqual(sync.SIGNAL_GROUPS.deletions, ['deletions'], 'deletions group');
  assert.ok(src.includes('runSupabaseGroup(SIGNAL_GROUPS.tables'), 'tables pull fn uses the shared constant');
  assert.ok(src.includes('runSupabaseGroup(SIGNAL_GROUPS.high'), 'high pull fn uses the shared constant');
  assert.ok(src.includes('runSupabaseGroup(SIGNAL_GROUPS.deletions'), 'deletions pull fn uses the shared constant');
});

it('every table of every group is a known signal table (group list is never hardcoded)', () => {
  const src = fs.readFileSync('services/realtimeSignal.js', 'utf8');
  assert.ok(/Object\.keys\(SIGNAL_GROUPS\)\.reduce/.test(src), 'KNOWN_TABLES is derived from all groups');
  assert.ok(!/SIGNAL_GROUPS\.tables \|\| \[\]/.test(src), 'no hardcoded tables/high pair for KNOWN_TABLES');
  // behavioural: a deletions signal (a table introduced in a LATER stage) is accepted + routed
  const s = setup();
  return (async () => {
    await sleep(450);
    await sleep(1100);
    s.pulls.length = 0;
    s.ch.__emit({ tables: ['deletions'], sender_device_id: 'other' });
    await sleep(450);
    assert.deepStrictEqual(s.pulls, ['deletions'], 'deletions signal routes to the deletions group');
    RS.stopRealtimeSignal();
  })();
});

it('App.js: adaptive pollers + signal lifecycle are wired; fast baseline preserved', () => {
  const app = fs.readFileSync('App.js', 'utf8');
  assert.ok(app.includes('const createAdaptivePoller ='), 'adaptive poller helper present');
  assert.ok(app.includes('startRealtimeSignal('), 'signal started');
  assert.ok(app.includes('stopRealtimeSignal('), 'signal stopped');
  assert.ok(app.includes('adaptiveTables.stop()'), 'tables poller stopped on cleanup');
  assert.ok(app.includes('adaptiveHigh.stop()'), 'high poller stopped on cleanup');
  assert.ok(app.includes('registerSyncTimer(\'supabase-tables-poll\', 5000'), 'fallback baseline (5s) registered');
  assert.ok(app.includes('registerSyncTimer(\'supabase-high-frequency-poll\', 10000'), 'fallback baseline (10s) registered');
  assert.ok(!app.includes("SIGNAL_FAST_TABLES_MS = 1000"), 'no 1s tables poll remains');
  assert.ok(!app.includes("SIGNAL_FAST_HIGH_MS = 5000"), 'no 5s high poll remains');
  assert.ok(!/setInterval\(async \(\) => \{\s*await runAutoPull\('supabase-tables-poll'/.test(app), 'tables is no longer a flat setInterval');
  assert.ok(!/setInterval\(async \(\) => \{\s*await runAutoPull\('supabase-high-frequency-poll'/.test(app), 'high is no longer a flat setInterval');
  assert.ok(app.includes('adaptiveDeletions.stop()'), 'deletions poller stopped on cleanup');
  assert.ok(app.includes("registerSyncTimer('supabase-deletions-poll', 15000"), 'deletions fast baseline (15s) still registered');
  assert.ok(!/setInterval\(async \(\) => \{\s*await runAutoPull\('supabase-deletions-poll'/.test(app), 'deletions is no longer a flat setInterval');
  assert.ok(app.includes("setInterval(async () => {"), 'pollers still use setInterval where untouched');
  assert.ok(/const supabaseLowPoll = setInterval\(/.test(app), 'low-freq poll untouched');
  assert.ok(/const supabaseMenuPoll = setInterval\(/.test(app), 'menu poll untouched');
  assert.ok(app.includes('adaptiveDeletions.kick()'), 'deletions poller is kicked on mode change');
});

(async () => {
  for (const t of tests) {
    try { await t.fn(); passed++; console.log(`  ✅  ${t.desc}`); }
    catch (err) { failed++; console.error(`  ❌  ${t.desc}`); console.error(`      ${err.message}`); }
    finally { try { RS.__resetRealtimeSignalDepsForTesting(); } catch (_) {} }
  }
  console.log('\n------------------------------------------------------');
  console.log(`Tests Passed: ${passed}`);
  console.log(`Tests Failed: ${failed}`);
  console.log('======================================================\n');
  if (failed > 0) process.exit(1);
})();
