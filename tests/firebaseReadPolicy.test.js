/**
 * Firebase read policy — Firebase is read ONLY by explicit manual actions,
 * and a first sync is bounded to the last 31 days.
 * Run with: node tests/firebaseReadPolicy.test.js
 *
 * Context: the owner observed ~2k+ automatic Firestore reads/day with NO manual pull. The
 * causes were (a) the gate opening on a transient Supabase failure (or sticky FAILED writes),
 * (b) that failure triggering a whole-group Firebase fallback, and (c) a table without a
 * Firebase cursor being read as the ENTIRE collection.
 */

'use strict';
const assert = require('assert');
const fs = require('fs');

console.log('======================================================');
console.log('   FIREBASE READ POLICY (manual-only + 31-day bound)  ');
console.log('======================================================\n');

let passed = 0;
let failed = 0;
const tests = [];
function it(desc, fn) { tests.push({ desc, fn }); }

const syncSrc = fs.readFileSync('services/supabaseSync.js', 'utf8');
const appSrc = fs.readFileSync('App.js', 'utf8');
const dbSrc = fs.readFileSync('database.js', 'utf8');

it('policy constant exists and is OFF (no automatic Firebase reads)', () => {
  assert.ok(syncSrc.includes('export const ALLOW_AUTO_FIREBASE_READ = false;'), 'ALLOW_AUTO_FIREBASE_READ = false');
});

it('a Supabase read failure no longer auto-falls back to Firebase', () => {
  // Scope to the FAILURE branch: the dormant (!configured) and kill-switch branches keep
  // their fallback on purpose — those are explicit operator modes, not automatic reactions.
  const failIdx = syncSrc.indexOf('if (failure) {');
  const policyIdx = syncSrc.indexOf('if (!ALLOW_AUTO_FIREBASE_READ)', failIdx);
  const fallbackIdx = syncSrc.indexOf('callFirebaseFallback(fb, firebaseFnName)', failIdx);
  assert.ok(failIdx > -1, 'failure branch exists');
  assert.ok(policyIdx > failIdx, 'policy check is inside the failure branch');
  assert.ok(fallbackIdx > policyIdx, 'the fallback call is guarded by the policy check');
  assert.ok(syncSrc.includes('BLOCKED by policy'), 'blocks with an explicit log line');
});

it('the standalone Firebase pull timers never read automatically', () => {
  const fnIdx = appSrc.indexOf('const runFirebasePullIfSupabaseDown = async (');
  assert.ok(fnIdx > -1, 'helper exists');
  const body = appSrc.slice(fnIdx, fnIdx + 1400);
  const policyIdx = body.indexOf('if (!allowAutoFirebaseRead)');
  const runIdx = body.indexOf('RUNNING Firebase pull');
  assert.ok(policyIdx > -1, 'policy guard present');
  assert.ok(runIdx > -1, 'the RUNNING branch still exists');
  assert.ok(policyIdx < runIdx, 'policy is checked before any Firebase read');
  assert.ok(body.includes('policy: automatic Firebase reads disabled'), 'explicit skip log');
});

it('lifecycle pulls (login/foreground/startup) never fall back to Firebase', () => {
  const fnIdx = appSrc.indexOf('const runPullPreferSupabase = async (');
  const body = appSrc.slice(fnIdx, fnIdx + 1600);
  const policyIdx = body.indexOf('if (!allowAutoFirebaseRead)');
  const runIdx = body.indexOf('RUNNING Firebase fallback pull');
  assert.ok(policyIdx > -1 && runIdx > -1 && policyIdx < runIdx, 'policy guards the lifecycle fallback');
});

it('manual Firebase reads are preserved (manual pull / restore routes intact)', () => {
  assert.ok(dbSrc.includes('export async function executeManualPull()'), 'executeManualPull exists (manual route)');
  assert.ok(dbSrc.includes('async function restoreFirebaseFromCloud('), 'Firebase restore exists (Cloud Restore button)');
  assert.ok(dbSrc.includes('export async function fetchHistoricalMonthData('), 'month history download exists (manual)');
  assert.ok(dbSrc.includes('export async function fetchHistoricalDateData('), 'date history download exists (manual)');
});

it('a first sync (no cursor) is bounded to the last 31 days, not the whole collection', () => {
  assert.ok(dbSrc.includes('const FIREBASE_FIRST_SYNC_DAYS = 31;'), '31-day window constant');
  const syncIdx = dbSrc.indexOf('async function syncCollections(');
  const endIdx = dbSrc.indexOf('async function fetchCollection(', syncIdx);
  const body = dbSrc.slice(syncIdx, endIdx > -1 ? endIdx : syncIdx + 6000);
  assert.strictEqual(body.includes('fetchCollection(queryCollection)'), false, 'no whole-collection read in the sync path');
  assert.ok(body.includes('const firstSyncMarker = new Date(Date.now() - FIREBASE_FIRST_SYNC_DAYS * 86400000).toISOString();'), 'uses the bounded marker');
  assert.ok(body.includes('fetchChangedRecordsFromFirestore(queryCollection, firstSyncMarker)'), 'reads only since the bounded marker');
  assert.ok(body.includes('isFullSync = false'), 'no longer flagged as a full sync');
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
