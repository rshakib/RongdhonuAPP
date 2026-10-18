/**
 * Phase 7 — X-Device-Id header injection (EMPIRICAL, real @supabase/supabase-js).
 * Run with: node tests/phase7HeaderInjection.test.js
 *
 * Regression guard for the Stage-2 field bug: `@supabase/postgrest-js` keeps its
 * headers in a `Headers` instance, so `rest.headers['x-device-id'] = id` was a
 * no-op and RLS-denied every gated write. This test intercepts fetch and asserts
 * the header is ACTUALLY present on the outgoing request.
 */

'use strict';

// Must be set BEFORE requiring the client module (it reads env at import time).
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon-key-for-header-test';
process.env.EXPO_PUBLIC_SUPABASE_SYNC_ENABLED = 'true';

const assert = require('assert');

// Intercept fetch BEFORE supabaseClient builds its client.
const seen = [];
globalThis.fetch = async (input, init = {}) => {
  const h = init.headers;
  const headers = {};
  if (h) {
    if (typeof h.forEach === 'function' && typeof h.get === 'function') h.forEach((v, k) => { headers[k] = v; });
    else if (Array.isArray(h)) h.forEach(([k, v]) => { headers[k] = v; });
    else Object.assign(headers, h);
  }
  seen.push({ url: String(input), method: init.method || 'GET', headers });
  return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
};

console.log('======================================================');
console.log('   PHASE 7 — X-DEVICE-ID HEADER INJECTION (EMPIRICAL) ');
console.log('======================================================\n');

let passed = 0;
let failed = 0;
const tests = [];
function it(desc, fn) { tests.push({ desc, fn }); }

const sc = require('../services/supabaseClient.js');

it('BEFORE setSupabaseDeviceId: no x-device-id is sent (the Stage-2 bug signature)', async () => {
  seen.length = 0;
  const client = sc.getSupabaseClient();
  assert.ok(client && client.rest, 'real supabase client built');
  await client.from('supplier_payment_ledger').upsert({ id: 'x' });
  const req = seen.find((r) => r.method === 'POST');
  assert.ok(req, 'upsert issued a POST');
  assert.strictEqual(req.headers['x-device-id'], undefined, 'no x-device-id before device id is configured');
});

it('AFTER setSupabaseDeviceId: x-device-id present on upsert (POST) AND select (GET)', async () => {
  sc.setSupabaseDeviceId('dev_test_42');
  const client = sc.getSupabaseClient();

  assert.strictEqual(sc.readHeaderFrom(client.rest.headers, 'x-device-id'), 'dev_test_42', 'attached to the PostgREST Headers instance');

  seen.length = 0;
  await client.from('supplier_payment_ledger').upsert({ id: 'x' });
  await client.from('orders').select('*');

  const post = seen.find((r) => r.method === 'POST');
  const get = seen.find((r) => r.method === 'GET');
  assert.strictEqual(post.headers['x-device-id'], 'dev_test_42', 'upsert carries the device header');
  assert.strictEqual(get.headers['x-device-id'], 'dev_test_42', 'select carries the device header');
});

it('readHeaderFrom handles Headers instances, plain objects, and null', () => {
  const h = new Headers();
  h.set('x-device-id', 'a');
  assert.strictEqual(sc.readHeaderFrom(h, 'x-device-id'), 'a');
  assert.strictEqual(sc.readHeaderFrom({ 'x-device-id': 'b' }, 'x-device-id'), 'b');
  assert.strictEqual(sc.readHeaderFrom(null, 'x-device-id'), null);
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
