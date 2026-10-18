/**
 * Phase 11 — Login cloud-reachability check must be SUPABASE-FIRST.
 * Run with: node tests/phase11LoginConnectivity.test.js
 *
 * Regression guard for the production blocker found on 2026-09-28: the login gate
 * (`verifyForceReauthLocally`) used to be a Firebase-only GET, so an exhausted
 * Firebase read quota (HTTP 429) BLOCKED LOGIN even though Supabase was healthy.
 */

'use strict';
const assert = require('assert');
const fs = require('fs');

console.log('======================================================');
console.log('   PHASE 11 — LOGIN CONNECTIVITY (SUPABASE-FIRST)     ');
console.log('======================================================\n');

let passed = 0;
let failed = 0;
const tests = [];
function it(desc, fn) { tests.push({ desc, fn }); }

const appCfg = require('../services/firebaseAppConfig.js');

function fakeClient({ error = null } = {}) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve({ data: error ? null : { id: 'global' }, error })
  };
  return { from: () => chain };
}
function reset() { appCfg.__resetVersionPolicyDepsForTesting(); }

// ---------------------------------------------------------------------------
it('Supabase reachable ⇒ verified WITHOUT any Firebase fetch', async () => {
  reset();
  appCfg.__setVersionPolicyDepsForTesting({
    isEnabled: () => true,
    isConfigured: () => true,
    getClient: () => fakeClient()
  });

  const original = global.fetch;
  const calls = [];
  global.fetch = (...args) => { calls.push(String(args[0])); return Promise.resolve({ ok: true, status: 200, json: async () => ({}) }); };

  try {
    const res = await appCfg.verifyForceReauthLocally('admin', '1234');
    assert.strictEqual(res.verified, true, 'login reachability OK');
    assert.strictEqual(res.source, 'supabase', 'source is supabase');
    assert.strictEqual(calls.length, 0, 'NO Firebase request was made');
  } finally { global.fetch = original; reset(); }
});

it('Supabase query errors ⇒ falls through to the Firebase branch', async () => {
  reset();
  appCfg.__setVersionPolicyDepsForTesting({
    isEnabled: () => true,
    isConfigured: () => true,
    getClient: () => fakeClient({ error: { message: 'boom' } })
  });
  process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID = 'test-proj';
  process.env.EXPO_PUBLIC_FIREBASE_API_KEY = 'test-key';

  const res = await appCfg.verifyForceReauthLocally('admin', '1234');
  // Firebase branch reached (auth helper can't run in Node → its own reason) — the
  // point is that it did NOT short-circuit as "verified" from Supabase.
  assert.strictEqual(res.verified, false, 'not verified when Supabase errored and Firebase path did not succeed');
  assert.ok(/Firebase/i.test(res.reason || ''), `reached the Firebase branch (reason: ${res.reason})`);
  reset();
});

it('source: throttling statuses (429/403) are treated as REACHABLE (quota ≠ offline)', () => {
  const code = fs.readFileSync('services/firebaseAppConfig.js', 'utf8');
  assert.ok(code.includes("res.status === 429 || res.status === 403"), '429/403 tolerated');
  assert.ok(code.includes('throttled: true'), 'reports throttled instead of blocking');
  assert.ok(/if \(res\.ok \|\| res\.status === 404\) return \{ verified: true, source: 'firebase' \};/.test(code), 'ok/404 still verify');
});

it('source: Supabase check comes BEFORE the Firebase config/fetch', () => {
  const code = fs.readFileSync('services/firebaseAppConfig.js', 'utf8');
  const fn = code.slice(code.indexOf('export async function verifyForceReauthLocally'));
  const iSupabase = fn.indexOf("client.from('app_version_policy')");
  const iFirebase = fn.indexOf('getFirebaseConfig()');
  assert.ok(iSupabase > 0, 'Supabase probe present');
  assert.ok(iFirebase > iSupabase, 'Firebase fallback runs only AFTER the Supabase probe');
  assert.ok(fn.includes("client.from('app_version_policy').select('id').eq('id', 'global').maybeSingle()"), 'public-read probe (works pre device-registration)');
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
