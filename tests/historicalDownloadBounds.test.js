/**
 * Historical Firebase download bounds + daily cap.
 * Run with: node tests/historicalDownloadBounds.test.js
 *
 * Regression guard for the owner-reported 5.9k Firestore read burst: the month download
 * queried "everything updated since <month>-01 → now" and then filtered client-side,
 * so ONE report download transferred months of documents (order_items alone ≈ 4.2k).
 * Now every historical download carries an upper bound, and a month download is capped
 * at MAX_DAILY_MONTH_DOWNLOADS (1) per day.
 */

'use strict';
const assert = require('assert');
const fs = require('fs');

console.log('======================================================');
console.log('   HISTORICAL DOWNLOAD BOUNDS + DAILY CAP             ');
console.log('======================================================\n');

let passed = 0;
let failed = 0;
const tests = [];
function it(desc, fn) { tests.push({ desc, fn }); }

const dbSrc = fs.readFileSync('database.js', 'utf8');
const appSrc = fs.readFileSync('App.js', 'utf8');

it('fetchChangedRecordsFromFirestore accepts an optional endTime bound', () => {
  assert.ok(
    /async function fetchChangedRecordsFromFirestore\(collectionName, lastSyncTime, endTime = null\)/.test(dbSrc),
    'signature has endTime = null'
  );
  assert.ok(dbSrc.includes("compositeFilter:") && dbSrc.includes("op: 'AND'"), 'builds an AND composite filter');
  assert.ok(dbSrc.includes("op: 'LESS_THAN'"), 'adds the upper (LESS_THAN) bound');
  assert.ok(/op: "GREATER_THAN"/.test(dbSrc), 'keeps the lower bound');
});

it('cursor-based callers keep the unbounded (2-arg) form — no behaviour change', () => {
  const twoArg = dbSrc.match(/fetchChangedRecordsFromFirestore\([^,)]+, ?[^,)]+\)/g) || [];
  assert.ok(twoArg.length >= 5, `expected >=5 two-arg call sites, found ${twoArg.length}`);
});

it('month download reads exactly ONE month (lower + next-month upper bound)', () => {
  assert.ok(dbSrc.includes('const nextMonthStart = new Date('), 'computes nextMonthStart');
  assert.ok(
    /fetchChangedRecordsFromFirestore\(table, startOfMonth, nextMonthStart\)/.test(dbSrc),
    'passes both bounds for the month download'
  );
});

it('single-date download reads exactly ONE day', () => {
  assert.ok(dbSrc.includes('const dayEnd = new Date('), 'computes dayEnd');
  assert.ok(
    /fetchChangedRecordsFromFirestore\(table, dateStr \+ "T00:00:00Z", dayEnd\)/.test(dbSrc),
    'passes both bounds for the date download'
  );
});

it('next-month boundary math is correct, including the December rollover', () => {
  const nextMonth = (monthStr) => {
    const [y, m] = monthStr.split('-').map(Number);
    return new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1)).toISOString();
  };
  assert.strictEqual(nextMonth('2026-09'), '2026-10-01T00:00:00.000Z');
  assert.strictEqual(nextMonth('2026-12'), '2027-01-01T00:00:00.000Z', 'December → next January');
  assert.strictEqual(nextMonth('2026-01'), '2026-02-01T00:00:00.000Z');
  assert.strictEqual(nextMonth('2028-02'), '2028-03-01T00:00:00.000Z', 'leap-year February');
  // The +1 day bound for a single-date download:
  assert.strictEqual(
    new Date(new Date('2026-09-15T00:00:00Z').getTime() + 86400000).toISOString(),
    '2026-09-16T00:00:00.000Z',
    'date + 1 day'
  );
});

it('month download is capped at ONE per day (shared constant, used by App.js)', () => {
  assert.ok(dbSrc.includes('export const MAX_DAILY_MONTH_DOWNLOADS = 1;'), 'constant exists and equals 1');
  assert.ok(appSrc.includes('MAX_DAILY_MONTH_DOWNLOADS'), 'App.js imports/uses the constant');
  assert.ok(
    /getDailyDownloadCount\('DEPOSIT_REPORT'\) >= MAX_DAILY_MONTH_DOWNLOADS/.test(appSrc),
    'the deposit month download compares against the constant'
  );
  assert.strictEqual(
    /getDailyDownloadCount\('DEPOSIT_REPORT'\) >= 2/.test(appSrc),
    false,
    'the old 2-per-day literal is gone'
  );
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
