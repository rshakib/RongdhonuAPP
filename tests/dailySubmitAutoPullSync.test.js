/**
 * Daily Submit Realtime Auto-Pull & Dual Cloud Sync Verification
 * Run with: node tests/dailySubmitAutoPullSync.test.js
 *
 * Verifies:
 * 1. services/supabaseSync.js defines SIGNAL_GROUPS.daily containing daily_submit, daily_summary, daily_submit_priority, eja_history, expenses
 * 2. services/supabaseSync.js exports syncSupabaseDaily
 * 3. services/realtimeSignal.js enables daily in ENABLED_GROUPS
 * 4. App.js imports syncSupabaseDaily and dispatches group 'daily' to realtime-daily-pull
 * 5. services/supabaseSync.js pullSupabaseTable caps queryMarker to today's midnight for daily tables
 * 6. services/supabaseSync.js pullSupabaseTable has fallback to Firestore single doc for old app submissions
 * 7. database.js exports fetchSingleDocFromFirestore and fromFirestoreDocument
 * 8. database.js submitDailySheet triggers syncRecordImmediately for daily_submit, daily_submit_priority, and daily_summary
 * 9. database.js savePastAccount triggers syncRecordImmediately for daily_submit, daily_submit_priority, and daily_summary
 */

'use strict';
const assert = require('assert');
const fs = require('fs');

console.log('======================================================');
console.log('   DAILY SUBMIT REALTIME AUTO-PULL VERIFICATION       ');
console.log('======================================================\n');

let passed = 0;
let failed = 0;
const tests = [];
function it(desc, fn) { tests.push({ desc, fn }); }

const sync = require('../services/supabaseSync.js');
const signal = require('../services/realtimeSignal.js');
const syncSrc = fs.readFileSync('services/supabaseSync.js', 'utf8');
const signalSrc = fs.readFileSync('services/realtimeSignal.js', 'utf8');
const appSrc = fs.readFileSync('App.js', 'utf8');
const dbSrc = fs.readFileSync('database.js', 'utf8');

// 1. SIGNAL_GROUPS.daily
it('SIGNAL_GROUPS contains daily group with all required daily tables', () => {
  assert.ok(Array.isArray(sync.SIGNAL_GROUPS.daily), 'daily group exists in SIGNAL_GROUPS');
  assert.ok(sync.SIGNAL_GROUPS.daily.includes('daily_submit'), 'daily group includes daily_submit');
  assert.ok(sync.SIGNAL_GROUPS.daily.includes('daily_summary'), 'daily group includes daily_summary');
  assert.ok(sync.SIGNAL_GROUPS.daily.includes('daily_submit_priority'), 'daily group includes daily_submit_priority');
  assert.ok(sync.SIGNAL_GROUPS.daily.includes('eja_history'), 'daily group includes eja_history');
  assert.ok(sync.SIGNAL_GROUPS.daily.includes('expenses'), 'daily group includes expenses');
});

// 2. syncSupabaseDaily export
it('services/supabaseSync.js exports syncSupabaseDaily function', () => {
  assert.strictEqual(typeof sync.syncSupabaseDaily, 'function', 'syncSupabaseDaily is a function');
  assert.ok(syncSrc.includes('runSupabaseGroup(SIGNAL_GROUPS.daily'), 'syncSupabaseDaily calls runSupabaseGroup with daily');
});

// 3. ENABLED_GROUPS.daily
it('services/realtimeSignal.js enables daily group in ENABLED_GROUPS', () => {
  assert.strictEqual(signal.ENABLED_GROUPS.daily, true, 'ENABLED_GROUPS.daily is true');
  assert.ok(signalSrc.includes('daily: true'), 'daily: true is defined in realtimeSignal.js');
});

// 4. App.js routing
it('App.js imports syncSupabaseDaily and wires realtime-daily-pull', () => {
  assert.ok(appSrc.includes('syncSupabaseDaily'), 'App.js imports syncSupabaseDaily');
  assert.ok(
    appSrc.includes("if (group === 'daily') runAutoPull('realtime-daily-pull', syncSupabaseDaily, refreshData)") ||
    appSrc.includes("else if (group === 'daily') runAutoPull('realtime-daily-pull', syncSupabaseDaily, refreshData)"),
    'App.js dispatches daily group to runAutoPull'
  );
});

// 5. Cursor lookback protection
it('pullSupabaseTable caps queryMarker at today midnight for daily tables', () => {
  assert.ok(syncSrc.includes("table === 'daily_submit' || table === 'daily_summary' || table === 'daily_submit_priority'"), 'checks daily tables');
  assert.ok(syncSrc.includes('todayMidnight'), 'calculates todayMidnight');
  assert.ok(syncSrc.includes('queryMarker > todayMidnight'), 'caps queryMarker to todayMidnight');
});

// 6. Firestore single doc fallback for old app
it('pullSupabaseTable checks Firestore fallback when Supabase and local DB have 0 rows for today', () => {
  assert.ok(syncSrc.includes("fetchSingleDocFromFirestore('daily_submit', todayStr)"), 'calls fetchSingleDocFromFirestore');
  assert.ok(syncSrc.includes("enqueueSupabaseSync('daily_submit', todayStr, 'INSERT')"), 'backfills to Supabase');
});

// 7. database.js exports
it('database.js exports fetchSingleDocFromFirestore and fromFirestoreDocument', () => {
  assert.ok(dbSrc.includes('export async function fetchSingleDocFromFirestore'), 'exports fetchSingleDocFromFirestore');
  assert.ok(dbSrc.includes('export function fromFirestoreDocument'), 'exports fromFirestoreDocument');
});

// 8. submitDailySheet immediate sync
it('submitDailySheet pushes immediately to both clouds and triggers realtime signals', () => {
  const submitIdx = dbSrc.indexOf('export function submitDailySheet(');
  assert.ok(submitIdx > -1, 'submitDailySheet found');
  const nextFnIdx = dbSrc.indexOf('export function checkAndApplyIjaraRollover', submitIdx);
  const submitBody = dbSrc.slice(submitIdx, nextFnIdx > -1 ? nextFnIdx : submitIdx + 6000);
  assert.ok(submitBody.includes('syncRecordImmediately("daily_submit", todayStr)'), 'immediate sync for daily_submit');
  assert.ok(submitBody.includes('syncRecordImmediately("daily_submit_priority", todayStr)'), 'immediate sync for daily_submit_priority');
  assert.ok(submitBody.includes('syncRecordImmediately("daily_summary", todayStr)'), 'immediate sync for daily_summary');
});

// 9. savePastAccount immediate sync
it('savePastAccount pushes immediately to both clouds for past entries', () => {
  const pastIdx = dbSrc.indexOf('export function savePastAccount(');
  assert.ok(pastIdx > -1, 'savePastAccount found');
  const nextFnIdx = dbSrc.indexOf('export function deleteSubmission', pastIdx);
  const pastBody = dbSrc.slice(pastIdx, nextFnIdx > -1 ? nextFnIdx : pastIdx + 6000);
  assert.ok(pastBody.includes('syncRecordImmediately("daily_submit", dateStr)'), 'immediate sync for daily_submit in savePastAccount');
  assert.ok(pastBody.includes('syncRecordImmediately("daily_submit_priority", dateStr)'), 'immediate sync for daily_submit_priority in savePastAccount');
  assert.ok(pastBody.includes('syncRecordImmediately("daily_summary", dateStr)'), 'immediate sync for daily_summary in savePastAccount');
});

(async () => {
  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log(`  ✔ ${t.desc}`);
    } catch (err) {
      failed++;
      console.error(`  ✖ ${t.desc}`);
      console.error(`    ${err.message}`);
    }
  }

  console.log('\n------------------------------------------------------');
  console.log(`Results: ${passed} passed, ${failed} failed (${tests.length} total)`);
  console.log('------------------------------------------------------\n');

  if (failed > 0) process.exit(1);
})();
