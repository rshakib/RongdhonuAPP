/**
 * Phase 6 — Version Control migration (Supabase primary + Firebase fallback).
 * Run with: node tests/phase6VersionControl.test.js
 *
 * Covers:
 *  - mapSupabasePolicyRow (canonical policy shape + fallbacks)
 *  - fetchVersionPolicyDualDB read chain (Supabase → Firebase → cache → default)
 *  - setVersionPolicyDualDB sequential write chain (Supabase → Firebase → cache)
 *  - checkAppVersionPolicy contract parity (ADMIN exempt, blocked, allowed, offline)
 *  - Firebase-untouched / call-site invariants (source inspection)
 */

'use strict';

// Shorten the Supabase version-policy timeout BEFORE the module reads it, so the
// hang/timeout test settles fast. Default in production is 3500ms.
process.env.EXPO_PUBLIC_SUPABASE_VERSION_TIMEOUT_MS = '60';

const assert = require('assert');
const fs = require('fs');

console.log('======================================================');
console.log('   PHASE 6 — VERSION CONTROL MIGRATION VERIFICATION    ');
console.log('======================================================\n');

let passed = 0;
let failed = 0;
const tests = [];
function it(desc, fn) { tests.push({ desc, fn }); }

const cfg = require('../services/firebaseAppConfig.js');
const APP_VERSION = cfg.APP_VERSION;

// ---------------------------------------------------------------------------
// Test doubles + dependency injection
// ---------------------------------------------------------------------------
const POLICY = {
  minimum_required_version: APP_VERSION,
  latest_version: APP_VERSION,
  update_url: 'https://github.com/rshakib/RongdhonuAPP/releases',
  force_update_enabled: true,
  update_message: 'default'
};

function baseDeps() {
  return {
    isEnabled: () => true,
    isConfigured: () => true,
    getClient: () => null,
    fetchFirebase: () => Promise.resolve({ success: true, policy: { ...POLICY } }),
    writeFirebase: () => Promise.resolve({ success: true }),
    readCache: () => null,
    writeCache: () => {}
  };
}

function setDeps(overrides = {}) {
  cfg.__setVersionPolicyDepsForTesting({ ...baseDeps(), ...overrides });
}

function makeClient({ row = null, error = null, throwErr = null, hang = false } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle() {
                  calls.push({ op: 'select', table });
                  if (throwErr) return Promise.reject(throwErr);
                  if (hang) return new Promise(() => {});
                  return Promise.resolve({ data: row, error });
                }
              };
            }
          };
        },
        upsert(payload) {
          calls.push({ op: 'upsert', table, payload });
          if (throwErr) return Promise.reject(throwErr);
          if (hang) return new Promise(() => {});
          return Promise.resolve({ error });
        }
      };
    }
  };
}

// ---------------------------------------------------------------------------
// 1. mapSupabasePolicyRow
// ---------------------------------------------------------------------------
it('mapSupabasePolicyRow maps a full row + falls back for missing fields', () => {
  const full = cfg.mapSupabasePolicyRow({
    minimum_required_version: '2.0.0',
    latest_version: '2.1.0',
    update_url: 'https://example.com/app',
    force_update_enabled: false,
    update_message: 'please update'
  });
  assert.deepStrictEqual(full, {
    minimum_required_version: '2.0.0',
    latest_version: '2.1.0',
    update_url: 'https://example.com/app',
    force_update_enabled: false,
    update_message: 'please update'
  });

  const empty = cfg.mapSupabasePolicyRow({});
  assert.strictEqual(empty.minimum_required_version, APP_VERSION, 'falls back to APP_VERSION');
  assert.strictEqual(empty.latest_version, APP_VERSION, 'latest falls back to min/APP_VERSION');
  assert.strictEqual(empty.update_url, cfg.DEFAULT_VERSION_POLICY.update_url, 'url default');
  assert.strictEqual(empty.force_update_enabled, true, 'force defaults true');
  assert.strictEqual(empty.update_message, cfg.DEFAULT_VERSION_POLICY.update_message, 'message default');
});

// ---------------------------------------------------------------------------
// 2. Read chain
// ---------------------------------------------------------------------------
it('read: Supabase healthy → returns Supabase policy, writes cache, no Firebase', async () => {
  const client = makeClient({ row: {
    minimum_required_version: '2.0.0',
    latest_version: '2.1.0',
    update_url: 'https://example.com/app',
    force_update_enabled: false,
    update_message: 'supa'
  } });
  const cacheWrites = [];
  let fbCalled = 0;
  setDeps({
    getClient: () => client,
    writeCache: (p) => cacheWrites.push(p),
    fetchFirebase: () => { fbCalled++; return Promise.resolve({ success: true, policy: { ...POLICY } }); }
  });

  const res = await cfg.fetchVersionPolicyDualDB();
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.source, 'supabase');
  assert.strictEqual(res.policy.minimum_required_version, '2.0.0');
  assert.strictEqual(res.policy.force_update_enabled, false);
  assert.strictEqual(cacheWrites.length, 1, 'cached the Supabase policy');
  assert.strictEqual(cacheWrites[0].minimum_required_version, '2.0.0');
  assert.strictEqual(fbCalled, 0, 'Firebase must NOT be called when Supabase succeeds');
  assert.strictEqual(client.calls.filter((c) => c.op === 'select').length, 1);

  cfg.__resetVersionPolicyDepsForTesting();
});

it('read: Supabase error → delegates to the existing Firebase fetcher', async () => {
  const client = makeClient({ error: { message: 'boom' } });
  let fbCalled = 0;
  setDeps({
    getClient: () => client,
    fetchFirebase: () => { fbCalled++; return Promise.resolve({ success: true, policy: { ...POLICY, minimum_required_version: '1.0.9' } }); }
  });

  const res = await cfg.fetchVersionPolicyDualDB();
  assert.strictEqual(fbCalled, 1, 'Firebase fallback invoked');
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.source, 'firebase');
  assert.strictEqual(res.policy.minimum_required_version, '1.0.9');

  cfg.__resetVersionPolicyDepsForTesting();
});

it('read: Supabase returns no row → delegates to Firebase', async () => {
  const client = makeClient({ row: null });
  let fbCalled = 0;
  setDeps({
    getClient: () => client,
    fetchFirebase: () => { fbCalled++; return Promise.resolve({ success: true, policy: { ...POLICY } }); }
  });

  const res = await cfg.fetchVersionPolicyDualDB();
  assert.strictEqual(fbCalled, 1);
  assert.strictEqual(res.source, 'firebase');

  cfg.__resetVersionPolicyDepsForTesting();
});

it('read: Supabase unconfigured → Firebase fallback, client never queried', async () => {
  const client = makeClient({ row: { minimum_required_version: '9.9.9' } });
  let fbCalled = 0;
  setDeps({
    isConfigured: () => false,
    getClient: () => client,
    fetchFirebase: () => { fbCalled++; return Promise.resolve({ success: true, policy: { ...POLICY } }); }
  });

  const res = await cfg.fetchVersionPolicyDualDB();
  assert.strictEqual(fbCalled, 1);
  assert.strictEqual(client.calls.length, 0, 'no Supabase call when unconfigured');
  assert.strictEqual(res.source, 'firebase');

  cfg.__resetVersionPolicyDepsForTesting();
});

it('read: kill switch off → Firebase fallback, client never queried', async () => {
  const client = makeClient({ row: { minimum_required_version: '9.9.9' } });
  let fbCalled = 0;
  setDeps({
    isEnabled: () => false,
    getClient: () => client,
    fetchFirebase: () => { fbCalled++; return Promise.resolve({ success: true, policy: { ...POLICY } }); }
  });

  const res = await cfg.fetchVersionPolicyDualDB();
  assert.strictEqual(fbCalled, 1);
  assert.strictEqual(client.calls.length, 0, 'kill switch disables the Supabase read');

  cfg.__resetVersionPolicyDepsForTesting();
});

it('read: Supabase hang → bounded by timeout, Firebase fallback, no throw', async () => {
  const client = makeClient({ hang: true });
  let fbCalled = 0;
  setDeps({
    getClient: () => client,
    fetchFirebase: () => { fbCalled++; return Promise.resolve({ success: true, policy: { ...POLICY } }); }
  });

  const res = await cfg.fetchVersionPolicyDualDB();
  assert.strictEqual(fbCalled, 1, 'timed-out Supabase read falls back to Firebase');
  assert.strictEqual(res.success, true);

  cfg.__resetVersionPolicyDepsForTesting();
});

it('read: Supabase client throws → Firebase fallback, no throw', async () => {
  const client = makeClient({ throwErr: new Error('network down') });
  let fbCalled = 0;
  setDeps({
    getClient: () => client,
    fetchFirebase: () => { fbCalled++; return Promise.resolve({ success: false, policy: { ...POLICY }, error: 'offline' }); }
  });

  const res = await cfg.fetchVersionPolicyDualDB();
  assert.strictEqual(fbCalled, 1);
  assert.strictEqual(res.success, false, 'propagates the Firebase failure state');

  cfg.__resetVersionPolicyDepsForTesting();
});

// ---------------------------------------------------------------------------
// 3. Write chain
// ---------------------------------------------------------------------------
it('write: Supabase FIRST → then Firebase → then cache (sequential order)', async () => {
  const order = [];
  const client = makeClient({ error: null });
  client.from = ((orig) => (table) => {
    const q = orig(table);
    const origUpsert = q.upsert;
    q.upsert = (payload, opts) => { order.push('supabase'); return origUpsert(payload, opts); };
    return q;
  })(client.from);

  let cacheWrites = 0;
  setDeps({
    getClient: () => client,
    writeFirebase: () => { order.push('firebase'); return Promise.resolve({ success: true }); },
    writeCache: () => { order.push('cache'); cacheWrites++; }
  });

  const res = await cfg.setVersionPolicyDualDB({ minimum_required_version: '2.0.0', latest_version: '2.0.0' });
  assert.strictEqual(res.success, true);
  assert.deepStrictEqual(order, ['supabase', 'firebase', 'cache'], 'strict sequential ordering');
  assert.strictEqual(cacheWrites, 1);

  const upsert = client.calls.find((c) => c.op === 'upsert');
  assert.strictEqual(upsert.table, 'app_version_policy');
  assert.strictEqual(upsert.payload.id, 'global');
  assert.strictEqual(upsert.payload.minimum_version, '2.0.0', 'legacy alias mirrored');

  cfg.__resetVersionPolicyDepsForTesting();
});

it('write: Supabase fails but Firebase succeeds → success:true (Firebase still attempted)', async () => {
  const client = makeClient({ error: { message: 'supa down' } });
  let fbCalled = 0;
  setDeps({
    getClient: () => client,
    writeFirebase: () => { fbCalled++; return Promise.resolve({ success: true }); }
  });

  const res = await cfg.setVersionPolicyDualDB({ minimum_required_version: '2.0.0' });
  assert.strictEqual(fbCalled, 1, 'Firebase best-effort must run even after a Supabase failure');
  assert.strictEqual(res.success, true);

  cfg.__resetVersionPolicyDepsForTesting();
});

it('write: both Supabase and Firebase fail → success:false with an error', async () => {
  const client = makeClient({ error: { message: 'supa down' } });
  setDeps({
    getClient: () => client,
    writeFirebase: () => Promise.resolve({ success: false, error: 'fb down' })
  });

  const res = await cfg.setVersionPolicyDualDB({ minimum_required_version: '2.0.0' });
  assert.strictEqual(res.success, false);
  assert.ok(res.error, 'error surfaced');

  cfg.__resetVersionPolicyDepsForTesting();
});

it('write: invalid version is rejected BEFORE any cloud write', async () => {
  const client = makeClient({ error: null });
  let fbCalled = 0;
  setDeps({
    getClient: () => client,
    writeFirebase: () => { fbCalled++; return Promise.resolve({ success: true }); }
  });

  const res = await cfg.setVersionPolicyDualDB({ minimum_required_version: 'not-a-version' });
  assert.strictEqual(res.success, false);
  assert.ok(/Invalid minimum version/.test(res.error));
  assert.strictEqual(client.calls.length, 0, 'no Supabase write attempted');
  assert.strictEqual(fbCalled, 0, 'no Firebase write attempted');

  cfg.__resetVersionPolicyDepsForTesting();
});

it('write: kill switch off → Firebase-only (no Supabase), still success', async () => {
  const client = makeClient({ error: null });
  let fbCalled = 0;
  setDeps({
    isEnabled: () => false,
    getClient: () => client,
    writeFirebase: () => { fbCalled++; return Promise.resolve({ success: true }); }
  });

  const res = await cfg.setVersionPolicyDualDB({ minimum_required_version: '2.0.0' });
  assert.strictEqual(client.calls.length, 0, 'no Supabase write under kill switch');
  assert.strictEqual(fbCalled, 1);
  assert.strictEqual(res.success, true);

  cfg.__resetVersionPolicyDepsForTesting();
});

// ---------------------------------------------------------------------------
// 4. checkAppVersionPolicy contract parity
// ---------------------------------------------------------------------------
function outdatedClient() {
  return makeClient({ row: { minimum_required_version: '99.0.0', latest_version: '99.0.0', force_update_enabled: true, update_message: 'blocked' } });
}

it('checkAppVersionPolicy: ADMIN is exempt even when Supabase reports outdated', async () => {
  setDeps({ getClient: outdatedClient });
  const res = await cfg.checkAppVersionPolicy('ADMIN');
  assert.strictEqual(res.allowed, true);
  assert.strictEqual(res.updateRequired, false);
  assert.strictEqual(res.adminExempt, true);
  assert.strictEqual(res.offline, false);
  cfg.__resetVersionPolicyDepsForTesting();
});

it('checkAppVersionPolicy: outdated non-admin is blocked via the Supabase policy', async () => {
  setDeps({ getClient: outdatedClient });
  const res = await cfg.checkAppVersionPolicy('manager');
  assert.strictEqual(res.allowed, false);
  assert.strictEqual(res.updateRequired, true);
  assert.strictEqual(res.minimumVersion, '99.0.0');
  assert.strictEqual(res.offline, false);
  cfg.__resetVersionPolicyDepsForTesting();
});

it('checkAppVersionPolicy: fresh version is allowed', async () => {
  setDeps({ getClient: () => makeClient({ row: { minimum_required_version: '1.0.0', latest_version: '1.0.0', force_update_enabled: true } }) });
  const res = await cfg.checkAppVersionPolicy('manager');
  assert.strictEqual(res.allowed, true);
  assert.strictEqual(res.updateRequired, false);
  assert.strictEqual(res.offline, false);
  assert.strictEqual(res.error, null);
  cfg.__resetVersionPolicyDepsForTesting();
});

it('checkAppVersionPolicy: Supabase-down still gets policy from Firebase and blocks outdated non-admin', async () => {
  setDeps({
    isConfigured: () => false,
    fetchFirebase: () => Promise.resolve({
      success: false,
      policy: { ...POLICY, minimum_required_version: '99.0.0', force_update_enabled: true },
      error: 'offline'
    })
  });

  const blocked = await cfg.checkAppVersionPolicy('manager');
  assert.strictEqual(blocked.allowed, false);
  assert.strictEqual(blocked.updateRequired, true);
  assert.strictEqual(blocked.offline, true, 'marked offline (Firebase unreachable, cache/default used)');
  assert.ok(/offline/i.test(blocked.error), 'offline enforcement surfaced');

  const admin = await cfg.checkAppVersionPolicy('admin');
  assert.strictEqual(admin.allowed, true);
  assert.strictEqual(admin.adminExempt, true);

  cfg.__resetVersionPolicyDepsForTesting();
});

// ---------------------------------------------------------------------------
// 5. Firebase-untouched / call-site invariants (source inspection)
// ---------------------------------------------------------------------------
it('invariants: dual wrapper wired in; Firebase fetchers unchanged; AdminDB routed to dual', () => {
  const cfgCode = fs.readFileSync('services/firebaseAppConfig.js', 'utf8');

  // checkAppVersionPolicy must route through the dual reader.
  assert.ok(cfgCode.includes('const fetchRes = await fetchVersionPolicyDualDB();'), 'checkAppVersionPolicy uses the dual reader');

  // The untouched Firebase fetchers/writers are still present with their core logic.
  assert.ok(cfgCode.includes('export async function fetchVersionPolicy() {'), 'fetchVersionPolicy export retained');
  assert.ok(cfgCode.includes('await fetch(url, { method: \'GET\', headers: { ...auth.headers } });'), 'Firebase GET body unchanged');
  assert.ok(cfgCode.includes('export async function setVersionPolicy('), 'setVersionPolicy export retained');
  assert.ok(cfgCode.includes('updateMask.fieldPaths='), 'Firebase PATCH updateMask unchanged');

  // New exports exist.
  assert.ok(cfgCode.includes('export async function fetchVersionPolicyDualDB()'), 'fetchVersionPolicyDualDB exported');
  assert.ok(cfgCode.includes('export async function setVersionPolicyDualDB('), 'setVersionPolicyDualDB exported');
  assert.ok(cfgCode.includes('export async function setMinimumVersionDualDB('), 'setMinimumVersionDualDB exported');

  // AdminDB routes the save call to the dual writer; no legacy direct save call remains.
  const adminCode = fs.readFileSync('screens/AdminDB.js', 'utf8');
  assert.ok(adminCode.includes('setMinimumVersionDualDB'), 'AdminDB imports/uses the dual writer');
  assert.ok(adminCode.includes('const result = await setMinimumVersionDualDB(cleanVer);'), 'save call routed to dual writer');
  assert.ok(!/await\s+setMinimumVersion\(/.test(adminCode), 'no legacy Firebase-only save call remains');

  // Biometric + PIN gate left intact.
  assert.ok(adminCode.includes('LocalAuthentication.authenticateAsync'), 'biometric gate intact');
  assert.ok(adminCode.includes("verifyPinCode(versionPinInput.trim())"), 'PIN gate intact');

  // AdminDB's READ path must be dual too: it used to be an unconditional Firestore
  // read on every dashboard mount (the only Firebase read left in an Admin-only screen).
  assert.ok(cfgCode.includes('const res = await fetchVersionPolicyDualDB();'), 'fetchMinimumVersion uses the dual reader');
  assert.ok(
    !/export async function fetchMinimumVersion\(\) \{\s*const res = await fetchVersionPolicy\(\);/.test(cfgCode),
    'legacy Firebase-only read removed from fetchMinimumVersion'
  );
  assert.ok(adminCode.includes('সার্ভারে নিউনতম'), 'AdminDB label no longer claims Firebase');
  assert.ok(!adminCode.includes('Firebase নিউনতম'), 'misleading Firebase label removed');
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
