/**
 * Phase 14 — Push-on-write (Firebase + Supabase pushed in the same call).
 * Run with: node tests/pushOnWrite.test.js
 *
 * Before this, `syncRecordImmediately()` pushed Firebase only, so the Supabase copy
 * (the primary read source) waited for its own 5s daemon — the "table update / order
 * item push is late" symptom. Checkout had no immediate push at all.
 */

'use strict';
const assert = require('assert');
const fs = require('fs');

console.log('======================================================');
console.log('   PHASE 14 — PUSH-ON-WRITE (BOTH CLOUDS)             ');
console.log('======================================================\n');

let passed = 0;
let failed = 0;
const tests = [];
function it(desc, fn) { tests.push({ desc, fn }); }

const dbSrc = fs.readFileSync('database.js', 'utf8');
const appSrc = fs.readFileSync('App.js', 'utf8');
const queueSrc = fs.readFileSync('services/supabaseSyncQueue.js', 'utf8');

// Extract one function body (from `function name(` to the next top-level declaration).
function fnBody(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start > -1, `function ${name} exists`);
  const rest = src.slice(start);
  const next = rest.slice(1).search(/\n(?:export )?(?:async )?function |\n\/(?:\*\*| )/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

it('syncRecordImmediately pushes Firebase AND Supabase in the same call', () => {
  const body = fnBody(dbSrc, 'syncRecordImmediately');
  assert.ok(body.includes('processSyncQueue(recordId, tableName)'), 'pushes Firebase');
  assert.ok(body.includes('syncSupabaseRecordImmediately'), 'pushes Supabase too');
  assert.ok(body.includes('Promise.all'), 'both clouds run in parallel (not sequentially awaited)');
});

it('the two pushes are isolated — one failing cannot stop the other', () => {
  const body = fnBody(dbSrc, 'syncRecordImmediately');
  assert.ok(/const pushFirebase[\s\S]*?catch/.test(body), 'firebase push is try/caught');
  assert.ok(/const pushSupabase[\s\S]*?catch/.test(body), 'supabase push is try/caught');
  assert.ok(body.includes('return firebaseOk || supabaseOk'), 'reports online if EITHER cloud saved');
});

it('supabase immediate push never throws', () => {
  const start = queueSrc.indexOf('export async function syncSupabaseRecordImmediately');
  assert.ok(start > -1, 'syncSupabaseRecordImmediately is exported');
  const body = queueSrc.slice(start, start + 400);
  assert.ok(body.includes('processSupabaseSyncQueue(recordId, tableName)'), 'pushes the single record');
  assert.ok(body.includes('catch'), 'never throws');
});

it('checkout (addCompletedOrder) flushes immediately instead of waiting for the 5s daemon', () => {
  const body = fnBody(dbSrc, 'addCompletedOrder');
  assert.ok(body.includes('processSyncQueue()'), 'flushes the Firebase queue on checkout');
  assert.ok(body.includes('processSupabaseSyncQueue()'), 'flushes the Supabase queue on checkout');
});

it('the table cart / rename UI paths push immediately (the original symptom)', () => {
  assert.ok(appSrc.includes("syncRecordImmediately(collection, tableIdClean)"), 'cart edit pushes immediately');
  assert.ok(appSrc.includes("syncRecordImmediately('restaurant_tables', cleanId)"), 'table rename pushes immediately');
});

it('database.js exposes the immediate push pair used above', () => {
  assert.ok(dbSrc.includes('export async function syncRecordImmediately'), 'syncRecordImmediately exported');
  assert.ok(queueSrc.includes('export async function syncSupabaseRecordImmediately'), 'supabase twin exported');
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
