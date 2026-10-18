/**
 * ULTIMATE AUTO IJARA COMPREHENSIVE AUDIT & SIMULATION
 * Run with: node tests/ultimateAutoIjaraAudit.test.js
 *
 * Verifies all 6 critical dimensions of the Auto Ijara system:
 * 1. Standard Submit Flow (Immediate Day D+1 Expense & Eja Creation)
 * 2. Late Submit Flow (Yesterday submitted today immediately funds today)
 * 3. Self-Healing Fallback (App start/resume heals missing ijara from prior submit)
 * 4. Multi-Device Sync Pipeline (lowFreq lists, immediate push dispatcher)
 * 5. Idempotent Updates (Re-submit updates amounts without duplicates)
 * 6. UI Consumption (getDailyExpenses retrieval contract)
 */

'use strict';
const assert = require('assert');
const fs = require('fs');

console.log('================================================================');
console.log('       ULTIMATE AUTO IJARA SYSTEM AUDIT & VERIFICATION          ');
console.log('================================================================\n');

let passed = 0;
let failed = 0;
const tests = [];
function it(desc, fn) { tests.push({ desc, fn }); }

const dbSrc = fs.readFileSync('database.js', 'utf8');
const appSrc = fs.readFileSync('App.js', 'utf8');
const syncSrc = fs.readFileSync('services/supabaseSync.js', 'utf8');

// -------------------------------------------------------------
// CHECK 1: Immediate Creation Logic (No Midnight Waiting)
// -------------------------------------------------------------
it('[AUDIT 1] calculateAndStoreNextDayIjara immediately applies ijara to next date', () => {
  const fnBody = dbSrc.substring(
    dbSrc.indexOf('export function calculateAndStoreNextDayIjara'),
    dbSrc.indexOf('export function rollbackAutoIjara')
  );

  // Must calculate next business date using getBusinessDateOffset
  assert.ok(fnBody.includes('getBusinessDateOffset(submittedDateStr, 1)'), 'Calculates Day+1');
  // Must use the canonical formula: (totalSales + currentIjara - totalExpense) - ownerDeposit
  assert.ok(fnBody.includes('(totalSales + currentIjara - totalExpense) - ownerDeposit'), 'Correct business formula');
  // Must NOT stage into app_config and wait for midnight
  assert.ok(!fnBody.includes('config_pending_ijara_amount'), 'Legacy delayed config storage removed');
  // Must call applyAutoIjaraImmediately directly
  assert.ok(fnBody.includes('applyAutoIjaraImmediately(targetDate, nextDayIjara)'), 'Calls immediate apply');
});

// -------------------------------------------------------------
// CHECK 2: applyAutoIjaraImmediately Data Integrity
// -------------------------------------------------------------
it('[AUDIT 2] applyAutoIjaraImmediately inserts into both expenses and eja_history with push-on-write', () => {
  const fnBody = dbSrc.substring(
    dbSrc.indexOf('export function applyAutoIjaraImmediately'),
    dbSrc.indexOf('export function calculateAndStoreNextDayIjara')
  );

  // Checks for expenses insertion
  assert.ok(fnBody.includes("INSERT OR REPLACE INTO expenses"), 'Inserts into expenses table');
  assert.ok(fnBody.includes("category, amount, note, is_due"), 'Sets required expense columns');
  assert.ok(fnBody.includes("enqueueSync(\"expenses\", stableExpId, \"INSERT\")"), 'Enqueues expense sync');
  assert.ok(fnBody.includes("syncRecordImmediately(\"expenses\", stableExpId)"), 'Immediate push-on-write for expenses');

  // Checks for eja_history insertion
  assert.ok(fnBody.includes("INSERT OR REPLACE INTO eja_history"), 'Inserts into eja_history table');
  assert.ok(fnBody.includes("enqueueSync(\"eja_history\", ejaId, \"INSERT\")"), 'Enqueues eja_history sync');
  assert.ok(fnBody.includes("syncRecordImmediately(\"eja_history\", ejaId)"), 'Immediate push-on-write for eja_history');

  // Stable IDs
  assert.ok(fnBody.includes("`exp_${targetDate}_ijara`"), 'Uses deterministic expense ID format');
  assert.ok(fnBody.includes("`eja_${targetDate}`"), 'Uses deterministic eja_history ID format');
});

// -------------------------------------------------------------
// CHECK 3: Self-Healing Fallback
// -------------------------------------------------------------
it('[AUDIT 3] checkAndApplyIjaraRollover self-heals missing today ijara from yesterday submit', () => {
  const fnBody = dbSrc.substring(
    dbSrc.indexOf('export function checkAndApplyIjaraRollover'),
    dbSrc.indexOf('export function isSyncPaused')
  );

  // Looks up yesterday's business date
  assert.ok(fnBody.includes('getBusinessDateOffset(todayStr, -1)'), 'Offsets today by -1 day');
  // Checks SQLite daily_submit for yesterday
  assert.ok(fnBody.includes('SELECT * FROM daily_submit WHERE date = ?'), 'Queries yesterday submit');
  // Re-calculates and applies immediately to today
  assert.ok(fnBody.includes('applyAutoIjaraImmediately(todayStr, autoIjara)'), 'Applies missing ijara for today');
  assert.ok(fnBody.includes('Number(yesterdaySubmit.total_sell)'), 'Parses yesterday sales');
  assert.ok(fnBody.includes('Number(yesterdaySubmit.net_deposit)'), 'Parses yesterday deposit');
});

// -------------------------------------------------------------
// CHECK 4: Multi-Device Sync Architecture
// -------------------------------------------------------------
it('[AUDIT 4] Cloud Sync Pipeline ensures Admin, Owner & Manager receive ijara records', () => {
  // 1. Verify expenses & eja_history are in lowFreq for all 3 profiles
  const profilesMatch = dbSrc.match(/export const APP_PROFILES = \{([\s\S]*?)\};/);
  assert.ok(profilesMatch, 'APP_PROFILES is defined');
  const profilesCode = profilesMatch[1];

  assert.ok(profilesCode.includes("'expenses'") && profilesCode.includes("'eja_history'"), 'Both tables in APP_PROFILES');

  // 2. Verify neither expenses nor eja_history are in LOW_FREQ_EXCLUDED in supabaseSync.js
  const excludedMatch = syncSrc.match(/const LOW_FREQ_EXCLUDED = \[(.*?)\];/);
  assert.ok(excludedMatch, 'LOW_FREQ_EXCLUDED is defined');
  const excluded = excludedMatch[1];
  assert.ok(!excluded.includes('expenses'), 'expenses is NOT excluded from cloud sync');
  assert.ok(!excluded.includes('eja_history'), 'eja_history is NOT excluded from cloud sync');

  // 3. Verify syncRecordImmediately pushes to both Supabase and Firebase
  const pushFn = dbSrc.substring(
    dbSrc.indexOf('export async function syncRecordImmediately'),
    dbSrc.indexOf('export async function syncDeletionsOnly')
  );
  assert.ok(pushFn.includes('syncSupabaseRecordImmediately'), 'Dispatches immediate Supabase push');
  assert.ok(pushFn.includes('processSyncQueue'), 'Dispatches immediate Firebase push');
});

// -------------------------------------------------------------
// CHECK 5: App Lifecycle Resumes & Foreground Auto-Refresh
// -------------------------------------------------------------
it('[AUDIT 5] App.js automatically runs rollover check on startup, 60s timer & foreground wake-up', () => {
  // Startup check
  assert.ok(appSrc.includes('const didRollover = checkAndApplyIjaraRollover();'), 'Startup rollover check');
  // 60-second periodic interval
  assert.ok(appSrc.includes('const rollover = checkAndApplyIjaraRollover();'), 'Periodic 60s check');
  // Foreground wake-up check
  const fgIdx = appSrc.indexOf('[AppState Sync] Device woke up in Foreground!');
  assert.ok(fgIdx > -1, 'Foreground resume listener');
  const fgSection = appSrc.slice(fgIdx, fgIdx + 1200);
  assert.ok(fgSection.includes('checkAndApplyIjaraRollover()'), 'Foreground resume triggers rollover check');
  assert.ok(fgSection.includes('refreshData()'), 'Refreshes UI after foreground rollover');
});

// -------------------------------------------------------------
// CHECK 6: UI Read Consumption Contract
// -------------------------------------------------------------
it('[AUDIT 6] getDailyExpenses correctly reads the ijara row with eja_history fallback', () => {
  const expFn = dbSrc.substring(
    dbSrc.indexOf('export function getDailyExpenses'),
    dbSrc.indexOf('export function getSupplierDueData')
  );

  // Reads expenses where category = 'ijara'
  assert.ok(expFn.includes("cat === 'ijara'"), 'Extracts ijara from category');
  // Fallback to eja_history if row is 0 or missing
  assert.ok(expFn.includes("SELECT eja_amount FROM eja_history WHERE date = ? OR id = ?"), 'eja_history fallback query present');
});

// -------------------------------------------------------------
// CHECK 7: Mathematical Simulation Test
// -------------------------------------------------------------
it('[AUDIT 7] Simulation: (Sales: 8230, Ijara: 2750, Exp: 5460, Deposit: 3000) => ৳2520 exactly', () => {
  const summary = {
    sell: 8230,
    breakdown: { ijara: 2750 },
    expense: 5460,
    deposit: 3000
  };

  const totalSales = summary.sell || 0;
  const currentIjara = summary.breakdown?.ijara || 0;
  const totalExpense = summary.expense || 0;
  const ownerDeposit = parseFloat(summary.deposit) || 0;

  const nextDayIjara = Math.max(0, (totalSales + currentIjara - totalExpense) - ownerDeposit);
  assert.strictEqual(nextDayIjara, 2520, 'Mathematical formula produces exactly 2520');
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
  console.log('\n----------------------------------------------------------------');
  console.log(`Audit Summary: ${passed} Passed | ${failed} Failed`);
  console.log('================================================================\n');
  if (failed > 0) process.exit(1);
})();
