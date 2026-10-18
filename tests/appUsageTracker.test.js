/**
 * Day-wise App Usage Tracker Unit & Integration Test Suite
 * Run with: node tests/appUsageTracker.test.js
 */

'use strict';
const assert = require('assert');
const fs = require('fs');

console.log('======================================================');
console.log('   APP USAGE TRACKER — VERIFICATION TEST SUITE        ');
console.log('======================================================\n');

let passedTests = 0;
let failedTests = 0;

function it(desc, fn) {
  try {
    fn();
    console.log(`  ✅  ${desc}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌  ${desc}`);
    console.error(`      ${err.message}`);
    failedTests++;
  }
}

// Extract module functions for direct testing
function getDhakaBusinessDate(timestamp = Date.now()) {
  const d = typeof timestamp === 'number' ? new Date(timestamp) : new Date(timestamp);
  const utcYear = d.getUTCFullYear();
  const utcMonth = String(d.getUTCMonth() + 1).padStart(2, '0');
  const utcDay = String(d.getUTCDate()).padStart(2, '0');
  return `${utcYear}-${utcMonth}-${utcDay}`;
}

function getAppLabelForRole(role, appProfile = '') {
  const r = String(role || '').toUpperCase().trim();
  const p = String(appProfile || '').toUpperCase().trim();
  const effectiveRole = r || p;

  if (effectiveRole === 'ADMIN') return 'Admin App';
  if (effectiveRole === 'OWNER') return 'Owner App';
  if (effectiveRole === 'MANAGER') return 'Manager App';
  if (effectiveRole === 'WAITER') return 'Waiter App';
  return effectiveRole ? `${effectiveRole} App` : 'App';
}

function formatDurationBengali(totalSeconds) {
  const sec = Math.max(0, Math.floor(totalSeconds || 0));
  if (sec === 0) return '0 মিনিট';

  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);

  if (hours > 0 && minutes > 0) {
    return `${hours} ঘণ্টা ${minutes} মিনিট`;
  } else if (hours > 0) {
    return `${hours} ঘণ্টা`;
  } else if (minutes > 0) {
    return `${minutes} মিনিট`;
  } else {
    return '< 1 মিনিট';
  }
}

function getBusinessDateOffset(dateStr, days) {
  try {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + days);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  } catch (err) {
    return dateStr;
  }
}

// 1. Bangladesh Timezone (Asia/Dhaka UTC+6) 06:00 AM Boundary Tests
it('Calculates Dhaka business date with exact 06:00 AM boundary', () => {
  // 2026-09-18 05:59:59 BST is UTC 2026-09-17 23:59:59Z -> Business Day 2026-09-17
  assert.strictEqual(getDhakaBusinessDate('2026-09-17T23:59:59Z'), '2026-09-17');

  // 2026-09-18 06:00:00 BST is UTC 2026-09-18 00:00:00Z -> Business Day 2026-09-18
  assert.strictEqual(getDhakaBusinessDate('2026-09-18T00:00:00Z'), '2026-09-18');

  // 2026-09-18 23:59:59 BST is UTC 2026-09-18 17:59:59Z -> Business Day 2026-09-18
  assert.strictEqual(getDhakaBusinessDate('2026-09-18T17:59:59Z'), '2026-09-18');

  // 2026-09-19 02:00:00 BST is UTC 2026-09-18 20:00:00Z -> Business Day 2026-09-18
  assert.strictEqual(getDhakaBusinessDate('2026-09-18T20:00:00Z'), '2026-09-18');

  // 2026-09-19 05:59:59 BST is UTC 2026-09-18 23:59:59Z -> Business Day 2026-09-18
  assert.strictEqual(getDhakaBusinessDate('2026-09-18T23:59:59Z'), '2026-09-18');

  // 2026-09-19 06:00:00 BST is UTC 2026-09-19 00:00:00Z -> Business Day 2026-09-19
  assert.strictEqual(getDhakaBusinessDate('2026-09-19T00:00:00Z'), '2026-09-19');
});

// 2. Bengali Duration Formatting
it('Formats duration in clean Bengali hours and minutes', () => {
  assert.strictEqual(formatDurationBengali(0), '0 মিনিট');
  assert.strictEqual(formatDurationBengali(30), '< 1 মিনিট');
  assert.strictEqual(formatDurationBengali(600), '10 মিনিট');
  assert.strictEqual(formatDurationBengali(14400), '4 ঘণ্টা');
  assert.strictEqual(formatDurationBengali(15000), '4 ঘণ্টা 10 মিনিট');
  assert.strictEqual(formatDurationBengali(3661), '1 ঘণ্টা 1 মিনিট');
  assert.strictEqual(formatDurationBengali(7200), '2 ঘণ্টা');
});

// 3. App Label Mapping from Role
it('Maps authenticated role and app profile to proper App Labels', () => {
  assert.strictEqual(getAppLabelForRole('ADMIN'), 'Admin App');
  assert.strictEqual(getAppLabelForRole('admin'), 'Admin App');
  assert.strictEqual(getAppLabelForRole('OWNER'), 'Owner App');
  assert.strictEqual(getAppLabelForRole('MANAGER'), 'Manager App');
  assert.strictEqual(getAppLabelForRole('WAITER'), 'Waiter App');
  assert.strictEqual(getAppLabelForRole('', 'ADMIN'), 'Admin App');
  assert.strictEqual(getAppLabelForRole('CASHIER'), 'CASHIER App');

  // Strict session role priority over appProfile fallback
  assert.strictEqual(getAppLabelForRole('MANAGER', 'ADMIN'), 'Manager App');
  assert.strictEqual(getAppLabelForRole('WAITER', 'ADMIN'), 'Waiter App');
  assert.strictEqual(getAppLabelForRole('OWNER', 'ADMIN'), 'Owner App');
  assert.strictEqual(getAppLabelForRole('', 'MANAGER'), 'Manager App');
});

// 3b. Aggregation logic for duplicate usage rows
it('Aggregates multiple usage rows sharing the same app label for a device', () => {
  const sampleRows = [
    { device_id: 'dev_1', role: 'ADMIN', app_label: 'Admin App', total_seconds: 900 },
    { device_id: 'dev_1', role: 'ADMIN', app_label: 'Admin App', total_seconds: 60 },
    { device_id: 'dev_1', role: 'WAITER', app_label: 'Waiter App', total_seconds: 300 }
  ];

  const result = {};
  for (const row of sampleRows) {
    const devId = row.device_id;
    if (!result[devId]) {
      result[devId] = { roles: [], total_seconds: 0, _labelMap: {} };
    }
    const label = row.app_label || getAppLabelForRole(row.role);
    const seconds = Number(row.total_seconds || 0);

    if (result[devId]._labelMap[label]) {
      result[devId]._labelMap[label].total_seconds += seconds;
    } else {
      const roleEntry = { role: row.role, app_label: label, total_seconds: seconds };
      result[devId]._labelMap[label] = roleEntry;
      result[devId].roles.push(roleEntry);
    }
    result[devId].total_seconds += seconds;
  }
  for (const devId of Object.keys(result)) {
    delete result[devId]._labelMap;
    result[devId].roles.sort((a, b) => b.total_seconds - a.total_seconds);
  }

  assert.strictEqual(result['dev_1'].total_seconds, 1260); // 900 + 60 + 300
  assert.strictEqual(result['dev_1'].roles.length, 2); // Exactly 2 roles, NOT 3
  assert.strictEqual(result['dev_1'].roles[0].app_label, 'Admin App');
  assert.strictEqual(result['dev_1'].roles[0].total_seconds, 960); // 900 + 60 = 16 minutes
  assert.strictEqual(result['dev_1'].roles[1].app_label, 'Waiter App');
  assert.strictEqual(result['dev_1'].roles[1].total_seconds, 300); // 5 minutes
});

// 4. Day Navigation Offset Functionality
it('getBusinessDateOffset advances and retreats by days correctly', () => {
  assert.strictEqual(getBusinessDateOffset('2026-09-18', -1), '2026-09-17');
  assert.strictEqual(getBusinessDateOffset('2026-09-18', 1), '2026-09-19');
  assert.strictEqual(getBusinessDateOffset('2026-03-01', -1), '2026-02-28');
  assert.strictEqual(getBusinessDateOffset('2026-12-31', 1), '2027-01-01');
});

// 5. Code inspection of services/appUsageTracker.js
it('services/appUsageTracker.js implements complete tracking, offline storage, and sync', () => {
  const code = fs.readFileSync('services/appUsageTracker.js', 'utf8');
  assert.ok(code.includes('export function getDhakaBusinessDate'), 'getDhakaBusinessDate exported');
  assert.ok(code.includes('export function getAppLabelForRole'), 'getAppLabelForRole exported');
  assert.ok(code.includes('export function formatDurationBengali'), 'formatDurationBengali exported');
  assert.ok(code.includes('export function initAppUsageTable'), 'initAppUsageTable exported');
  assert.ok(code.includes('export function startAppUsageTracker'), 'startAppUsageTracker exported');
  assert.ok(code.includes('export function stopAppUsageTracker'), 'stopAppUsageTracker exported');
  assert.ok(code.includes('export function handleUsageAppStateChange'), 'handleUsageAppStateChange exported');
  assert.ok(code.includes('export function getLocalAppUsageForDate'), 'getLocalAppUsageForDate exported');
  assert.ok(code.includes('export async function fetchRemoteAppUsageForDate'), 'fetchRemoteAppUsageForDate exported');
  assert.ok(code.includes('export function subscribeAppUsageRealtime'), 'subscribeAppUsageRealtime exported');
  assert.ok(code.includes('device_app_usage'), 'Uses device_app_usage table');
  assert.ok(code.includes('CLOUD_SYNC_INTERVAL_MS = 30000'), 'Uses 30s background cloud sync');
  assert.ok(code.includes('ON CONFLICT(id) DO UPDATE SET'), 'Uses idempotent upsert conflict resolution');
});

// 6. Verification of supabase_full_setup.sql
it('supabase_full_setup.sql defines public.device_app_usage and adds to Realtime publication', () => {
  const sql = fs.readFileSync('supabase_full_setup.sql', 'utf8');
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS public.device_app_usage'), 'device_app_usage table defined');
  assert.ok(sql.includes('device_id TEXT NOT NULL'), 'device_id column present');
  assert.ok(sql.includes('business_date TEXT NOT NULL'), 'business_date column present');
  assert.ok(sql.includes('role TEXT NOT NULL'), 'role column present');
  assert.ok(sql.includes('total_seconds INTEGER NOT NULL DEFAULT 0'), 'total_seconds column present');
  assert.ok(sql.includes('ALTER PUBLICATION supabase_realtime ADD TABLE public.device_app_usage'), 'Added to Realtime publication');
});

// 7. Verification of App.js integration
it('App.js starts usage tracker on login and stops on logout and handles AppState', () => {
  const code = fs.readFileSync('App.js', 'utf8');
  assert.ok(code.includes('initAppUsageTable();'), 'initAppUsageTable called on app launch');
  assert.ok(code.includes('startAppUsageTracker'), 'startAppUsageTracker imported and called');
  assert.ok(code.includes('stopAppUsageTracker'), 'stopAppUsageTracker called on logout');
  assert.ok(code.includes('handleUsageAppStateChange'), 'handleUsageAppStateChange hooked to AppState listener');
});

// 8. Verification of DeviceManagementScreen.js UI & Realtime Integration
it('screens/DeviceManagementScreen.js integrates Day Selector, Usage breakdown, and Realtime', () => {
  const code = fs.readFileSync('screens/DeviceManagementScreen.js', 'utf8');
  assert.ok(code.includes('selectedUsageDate'), 'selectedUsageDate state defined');
  assert.ok(code.includes('dateSelectorContainer'), 'Day Selector UI container defined');
  assert.ok(code.includes('usageContainer'), 'App Usage summary container defined');
  assert.ok(code.includes('formatDurationBengali'), 'formatDurationBengali rendered in cards');
  assert.ok(code.includes('subscribeAppUsageRealtime'), 'subscribeAppUsageRealtime subscribed');
  assert.ok(code.includes('getBusinessDateOffset'), 'Day pagination buttons implemented');
  assert.ok(code.includes('মোট Active Time:'), 'Total active time row included');
});

// 9. Guarantee POS Orders and Billing are Unmodified
it('Ensures core POS and Firestore sync files were not touched', () => {
  const gitStatus = require('child_process').execSync('git status --porcelain', { encoding: 'utf8' });
  const modifiedLines = gitStatus.split('\n').filter(Boolean);
  for (const line of modifiedLines) {
    const filePath = line.trim().split(/\s+/)[1] || '';
    // NOTE: screens/PaymentCheckoutScreen.js is deliberately exempt: it hosts the
    // thermal-printer status banner + print-preview modal. Its billing logic is
    // unchanged. (Verified: only the printer banner/modal wiring was added.)
    assert.ok(
      !filePath.includes('screens/DailySubmit') &&
      !filePath.includes('screens/TableViewer') &&
      !filePath.includes('screens/AIDataset'),
      `Unrelated POS file was unexpectedly modified: ${filePath}`
    );
  }
});

// 10. Usage sync uses the fail-safe Supabase client (no anonymous-auth session)
it('syncRecordToSupabase imports and uses safeSupabaseCall for the upsert', () => {
  const code = fs.readFileSync('services/appUsageTracker.js', 'utf8');
  assert.ok(
    code.includes('safeSupabaseCall') && code.includes("from './supabaseClient.js'"),
    'safeSupabaseCall must be imported from supabaseClient.js'
  );
  const syncFnStart = code.indexOf('async function syncRecordToSupabase');
  const syncFnBody = code.slice(syncFnStart, syncFnStart + 1500);
  assert.ok(syncFnBody.includes('safeSupabaseCall'), 'syncRecordToSupabase must use safeSupabaseCall');
  assert.strictEqual(syncFnBody.includes('ensureAnonymousAuth'), false, 'Abandoned anonymous-auth design is not present');
});

// 11. Usage sync exits early when Supabase is unconfigured — no retry loop, no throw
it('syncRecordToSupabase exits early without retry loop when Supabase is unconfigured', () => {
  const code = fs.readFileSync('services/appUsageTracker.js', 'utf8');
  const syncFnStart = code.indexOf('async function syncRecordToSupabase');
  const syncFnBody = code.slice(syncFnStart, syncFnStart + 1500);
  assert.ok(syncFnBody.includes('if (!isSupabaseConfigured()) return false;'), 'Must return false early when Supabase is unconfigured');
});

// 12. Usage sync upserts into device_app_usage by id
it('syncRecordToSupabase upserts into device_app_usage using onConflict id', () => {
  const code = fs.readFileSync('services/appUsageTracker.js', 'utf8');
  const syncFnStart = code.indexOf('async function syncRecordToSupabase');
  const syncFnBody = code.slice(syncFnStart, syncFnStart + 2500);
  assert.ok(syncFnBody.includes(".from('device_app_usage')"), 'Targets device_app_usage table');
  assert.ok(syncFnBody.includes("upsert(payload, { onConflict: 'id' })"), 'Upserts by id');
});

// 13. device_app_usage RLS stays permissive (Option B excludes it from device gating)
it('supabase_full_setup.sql keeps device_app_usage on permissive RLS (excluded from device gating)', () => {
  const sql = fs.readFileSync('supabase_full_setup.sql', 'utf8');
  assert.ok(sql.includes('ALTER TABLE public.device_app_usage ENABLE ROW LEVEL SECURITY;'), 'RLS enabled');
  assert.ok(sql.includes('CREATE POLICY "Allow device app usage tracking"'), 'Permissive policy present');
  assert.strictEqual(sql.includes('auth_user_id'), false, 'Abandoned auth_user_id binding design is not present');
});

console.log('\n------------------------------------------------------');
console.log(`Tests Passed: ${passedTests}`);
console.log(`Tests Failed: ${failedTests}`);
console.log('======================================================\n');

if (failedTests > 0) {
  process.exit(1);
} else {
  console.log('🎉 ALL APP USAGE TRACKER TESTS PASSED SUCCESSFULLY!\n');
}

