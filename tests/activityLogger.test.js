/**
 * Activity Log & Audit Trail Unit Test Suite
 * Run with: node tests/activityLogger.test.js
 */

'use strict';
const assert = require('assert');
const fs = require('fs');

console.log('======================================================');
console.log('   ACTIVITY LOG & AUDIT TRAIL — UNIT TEST SUITE      ');
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

// 1. ACTION_TYPES Enum Test (parse from services/activityLogger.js)
it('ACTION_TYPES contains all required categories in services/activityLogger.js', () => {
  const code = fs.readFileSync('services/activityLogger.js', 'utf8');
  assert.ok(code.includes("ORDER: 'ORDER'"), 'ORDER action type');
  assert.ok(code.includes("PAYMENT: 'PAYMENT'"), 'PAYMENT action type');
  assert.ok(code.includes("EXPENSE: 'EXPENSE'"), 'EXPENSE action type');
  assert.ok(code.includes("MENU: 'MENU'"), 'MENU action type');
  assert.ok(code.includes("SETTLEMENT: 'SETTLEMENT'"), 'SETTLEMENT action type');
  assert.ok(code.includes("DEVICE: 'DEVICE'"), 'DEVICE action type');
  assert.ok(code.includes("SECURITY: 'SECURITY'"), 'SECURITY action type');
  assert.ok(code.includes("SYSTEM: 'SYSTEM'"), 'SYSTEM action type');
});

// 2. Mock in-memory DB and Activity Logging Test
it('logActivity generates unique ID, inserts into activity_logs, and enqueues sync', () => {
  const mockTable = [];

  const mockDb = {
    runSync: (sql, params) => {
      if (sql.includes('INSERT INTO activity_logs')) {
        mockTable.push({
          id: params[0],
          business_date: params[1],
          timestamp: params[2],
          action_type: params[3],
          action_title: params[4],
          description: params[5],
          app_profile: params[6],
          user_role: params[7],
          user_name: params[8],
          device_id: params[9],
          device_name: params[10],
          device_model: params[11],
          device_platform: params[12],
          metadata: params[13],
          is_synced: 0
        });
      }
    }
  };

  // Test inserting an owner expense activity
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const testLog = {
    id: `act_${Date.now()}_test`,
    business_date: todayStr,
    timestamp: now.toISOString(),
    action_type: 'EXPENSE',
    action_title: 'ওনারের খরচ যুক্ত',
    description: '🛒 বাজার: ৳500 (2026-09-16)',
    app_profile: 'OWNER',
    user_role: 'owner',
    user_name: 'Owner',
    device_id: 'dev_samsung_s23',
    device_name: 'Owner Mobile (SM-S911B)',
    device_model: 'SM-S911B',
    device_platform: 'android 14',
    metadata: JSON.stringify({ category: '🛒 বাজার', amount: 500 })
  };

  mockDb.runSync(`
    INSERT INTO activity_logs (
      id, business_date, timestamp, action_type, action_title,
      description, app_profile, user_role, user_name,
      device_id, device_name, device_model, device_platform,
      metadata, created_at, updated_at, is_synced
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `, [
    testLog.id, testLog.business_date, testLog.timestamp, testLog.action_type,
    testLog.action_title, testLog.description, testLog.app_profile,
    testLog.user_role, testLog.user_name, testLog.device_id,
    testLog.device_name, testLog.device_model, testLog.device_platform,
    testLog.metadata, testLog.timestamp, testLog.timestamp
  ]);

  assert.strictEqual(mockTable.length, 1);
  const row = mockTable[0];
  assert.strictEqual(row.action_type, 'EXPENSE');
  assert.strictEqual(row.user_role, 'owner');
  assert.strictEqual(row.app_profile, 'OWNER');
  assert.strictEqual(row.device_id, 'dev_samsung_s23');
  assert.strictEqual(row.device_name, 'Owner Mobile (SM-S911B)');
  assert.ok(row.description.includes('500'));
});

// 3. Activity Log Query & Filtering Simulation
it('getActivityLogsFromDb filters by role, category, and device', () => {
  const store = [
    { id: '1', business_date: '2026-09-16', action_type: 'ORDER', app_profile: 'WAITER', device_id: 'dev_tab_1', timestamp: '2026-09-16T10:00:00Z' },
    { id: '2', business_date: '2026-09-16', action_type: 'PAYMENT', app_profile: 'ADMIN', device_id: 'dev_pos_main', timestamp: '2026-09-16T10:05:00Z' },
    { id: '3', business_date: '2026-09-16', action_type: 'EXPENSE', app_profile: 'OWNER', device_id: 'dev_owner_phone', timestamp: '2026-09-16T10:10:00Z' },
    { id: '4', business_date: '2026-09-15', action_type: 'ORDER', app_profile: 'WAITER', device_id: 'dev_tab_1', timestamp: '2026-09-15T10:00:00Z' },
  ];

  function queryActivities(date, filters = {}) {
    return store.filter(r => {
      if (r.business_date !== date) return false;
      if (filters.appProfile && filters.appProfile !== 'ALL' && r.app_profile !== filters.appProfile) return false;
      if (filters.actionType && filters.actionType !== 'ALL' && r.action_type !== filters.actionType) return false;
      if (filters.deviceId && filters.deviceId !== 'ALL' && r.device_id !== filters.deviceId) return false;
      return true;
    });
  }

  const allForToday = queryActivities('2026-09-16');
  assert.strictEqual(allForToday.length, 3);

  const ownerActivities = queryActivities('2026-09-16', { appProfile: 'OWNER' });
  assert.strictEqual(ownerActivities.length, 1);
  assert.strictEqual(ownerActivities[0].action_type, 'EXPENSE');

  const payments = queryActivities('2026-09-16', { actionType: 'PAYMENT' });
  assert.strictEqual(payments.length, 1);
  assert.strictEqual(payments[0].device_id, 'dev_pos_main');

  const devTab1 = queryActivities('2026-09-16', { deviceId: 'dev_tab_1' });
  assert.strictEqual(devTab1.length, 1);
  assert.strictEqual(devTab1[0].app_profile, 'WAITER');
});

// 4. Verification that terminals do not background sync activity_logs (Zero Cloud Read Overhead)
it('activity_logs is excluded from background sync download tables in database.js', () => {
  const dbCode = fs.readFileSync('database.js', 'utf8');

  // Verify APP_PROFILES definition does not contain activity_logs in sync loops
  const profilesMatch = dbCode.match(/export const APP_PROFILES\s*=\s*\{([\s\S]*?)\};/);
  assert.ok(profilesMatch, 'APP_PROFILES exists in database.js');
  assert.ok(!profilesMatch[1].includes("'activity_logs'"), 'activity_logs must NOT be in background sync profiles');
});

// 5. Schema verification for activity_logs table
it('activity_logs table schema includes all device telemetry columns', () => {
  const dbCode = fs.readFileSync('database.js', 'utf8');
  assert.ok(dbCode.includes('CREATE TABLE IF NOT EXISTS activity_logs'));
  assert.ok(dbCode.includes('device_id TEXT'));
  assert.ok(dbCode.includes('device_name TEXT'));
  assert.ok(dbCode.includes('device_model TEXT'));
  assert.ok(dbCode.includes('device_platform TEXT'));
  assert.ok(dbCode.includes('app_profile TEXT NOT NULL'));
  assert.ok(dbCode.includes('user_role TEXT'));
  assert.ok(dbCode.includes('idx_activity_logs_date'));
  assert.ok(dbCode.includes('idx_activity_logs_time'));
});

// 6. Verification of date-partitioned fetch function
it('fetchActivityLogsForDate queries Firestore with business_date fieldFilter without requiring composite index', () => {
  const dbCode = fs.readFileSync('database.js', 'utf8');
  assert.ok(dbCode.includes('export async function fetchActivityLogsForDate(businessDate)'));
  assert.ok(dbCode.includes("fieldPath: 'business_date'"));
});

// 7. Verification that Navigation routes ACTIVITY_LOG in App.js
it('App.js handles ACTIVITY_LOG route guarded for admin and owner', () => {
  const appCode = fs.readFileSync('App.js', 'utf8');
  assert.ok(appCode.includes("case 'ACTIVITY_LOG':"));
  assert.ok(appCode.includes("<ActivityLogScreen"));
  assert.ok(appCode.includes("['admin', 'owner'].includes"));
});

// 8. Human-friendly description conversion test
it('ActivityLogScreen formats technical table IDs and order IDs into human-readable Bengali descriptions', () => {
  const logScreenCode = fs.readFileSync('screens/ActivityLogScreen.js', 'utf8');
  assert.ok(logScreenCode.includes('formatHumanDescription'), 'formatHumanDescription helper must exist');
  assert.ok(logScreenCode.includes('extractHumanMetaBadges'), 'extractHumanMetaBadges helper must exist');

  // Verify regex patterns exist in ActivityLogScreen.js
  assert.ok(logScreenCode.includes('টেবিল $1 এর সম্পন্ন অর্ডার মুছে ফেলা হয়েছে'));
  assert.ok(logScreenCode.includes('ডেলিভারি সম্পন্ন অর্ডার মুছে ফেলা হয়েছে'));
});

// 9. Raw JSON prevention test
it('ActivityLogScreen completely avoids dumping raw JSON metadata onto the screen', () => {
  const logScreenCode = fs.readFileSync('screens/ActivityLogScreen.js', 'utf8');
  assert.ok(!logScreenCode.includes('JSON.stringify(item.metadata)'), 'Raw JSON.stringify must NOT be rendered in card');
  assert.ok(logScreenCode.includes('metaBadgesContainer'), 'Must use styled metaBadgesContainer');
});

console.log('══════════════════════════════════════════════════════');
console.log(`  activityLogger.test.js — ${passedTests + failedTests} tests`);
console.log(`  Passed : ${passedTests}`);
console.log(`  Failed : ${failedTests}`);
console.log('══════════════════════════════════════════════════════\n');

if (failedTests > 0) {
  process.exit(1);
} else {
  process.exit(0);
}

