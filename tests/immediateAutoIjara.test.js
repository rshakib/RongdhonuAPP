/**
 * Immediate Auto-Ijara (Option A) Regression Guard
 * Run with: node tests/immediateAutoIjara.test.js
 *
 * Verifies that when a daily sheet is submitted:
 * 1. Opening ijara for next day is immediately created in `expenses` and `eja_history`.
 * 2. Immediate push via `syncRecordImmediately` is triggered for both clouds.
 * 3. `checkAndApplyIjaraRollover` has self-healing for missing submits from yesterday.
 * 4. `App.js` triggers rollover check on foreground recovery.
 */

'use strict';
const assert = require('assert');
const fs = require('fs');

console.log('======================================================');
console.log('   IMMEDIATE AUTO IJARA & SELF-HEALING (OPTION A)     ');
console.log('======================================================\n');

let passed = 0;
let failed = 0;
const tests = [];
function it(desc, fn) { tests.push({ desc, fn }); }

const dbSrc = fs.readFileSync('database.js', 'utf8');
const appSrc = fs.readFileSync('App.js', 'utf8');

it('applyAutoIjaraImmediately is exported and writes both expenses and eja_history', () => {
  assert.ok(dbSrc.includes('export function applyAutoIjaraImmediately'), 'applyAutoIjaraImmediately is exported');
  assert.ok(dbSrc.includes("category, amount, note, is_due, given_amount, used_amount, returned_amount"), 'expenses table columns included');
  assert.ok(dbSrc.includes("INSERT OR REPLACE INTO eja_history"), 'eja_history table write included');
  assert.ok(dbSrc.includes('syncRecordImmediately("expenses", stableExpId)'), 'immediate sync for expenses');
  assert.ok(dbSrc.includes('syncRecordImmediately("eja_history", ejaId)'), 'immediate sync for eja_history');
});

it('calculateAndStoreNextDayIjara computes next business date and applies immediately', () => {
  const start = dbSrc.indexOf('export function calculateAndStoreNextDayIjara');
  assert.ok(start > -1, 'calculateAndStoreNextDayIjara exists');
  const end = dbSrc.indexOf('\nexport function', start + 10);
  const body = end > -1 ? dbSrc.slice(start, end) : dbSrc.slice(start);

  assert.ok(body.includes('getBusinessDateOffset(submittedDateStr, 1)'), 'targets next business date');
  assert.ok(body.includes('(totalSales + currentIjara - totalExpense) - ownerDeposit'), 'correct formula');
  assert.ok(body.includes('applyAutoIjaraImmediately(targetDate, nextDayIjara)'), 'immediately applies next day ijara');
});

it('checkAndApplyIjaraRollover contains self-healing fallback from yesterday daily_submit', () => {
  const start = dbSrc.indexOf('export function checkAndApplyIjaraRollover');
  assert.ok(start > -1, 'checkAndApplyIjaraRollover exists');
  const end = dbSrc.indexOf('\nexport function', start + 10);
  const body = end > -1 ? dbSrc.slice(start, end) : dbSrc.slice(start);

  assert.ok(body.includes('getBusinessDateOffset(todayStr, -1)'), 'looks up yesterday date');
  assert.ok(body.includes('SELECT * FROM daily_submit WHERE date = ?'), 'reads yesterday daily_submit');
  assert.ok(body.includes('applyAutoIjaraImmediately(todayStr, autoIjara)'), 'self-heals missing today ijara');
});

it('App.js invokes checkAndApplyIjaraRollover on foreground recovery', () => {
  const idx = appSrc.indexOf('[AppState Sync] Device woke up in Foreground!');
  assert.ok(idx > -1, 'foreground wake-up handler found');
  const snippet = appSrc.slice(idx, idx + 1200);
  assert.ok(snippet.includes('checkAndApplyIjaraRollover()'), 'invokes rollover check');
  assert.ok(snippet.includes('refreshData()'), 'refreshes data if rollover applied');
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
  console.log('\n------------------------------------------------------');
  console.log(`Tests Passed: ${passed}`);
  console.log(`Tests Failed: ${failed}`);
  console.log('======================================================\n');
  if (failed > 0) process.exit(1);
})();
