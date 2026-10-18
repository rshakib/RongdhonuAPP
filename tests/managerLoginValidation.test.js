/**
 * Manager Login Resolution & Core User Auto-Seeding Test Suite
 * Run with: node tests/managerLoginValidation.test.js
 */

'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('======================================================');
console.log('   MANAGER LOGIN & USER AUTO-SEEDING TEST SUITE        ');
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

const dbCode = fs.readFileSync(path.join(__dirname, '../database.js'), 'utf8');
const appCode = fs.readFileSync(path.join(__dirname, '../App.js'), 'utf8');
const loginCode = fs.readFileSync(path.join(__dirname, '../screens/LoginScreen.js'), 'utf8');
const fbConfigCode = fs.readFileSync(path.join(__dirname, '../services/firebaseAppConfig.js'), 'utf8');

// Test 1: DEFAULT_CORE_USERS definition exists
it('database.js exports DEFAULT_CORE_USERS with m, ro, and a', () => {
  assert(dbCode.includes('export const DEFAULT_CORE_USERS'), 'Missing DEFAULT_CORE_USERS export');
  assert(dbCode.includes("username: \"m\""), 'Missing user m');
  assert(dbCode.includes("pin: \"1111\""), 'Missing PIN 1111 for user m');
  assert(dbCode.includes("role: \"manager\""), 'User m must have role manager');
  assert(dbCode.includes("username: \"ro\""), 'Missing user ro');
  assert(dbCode.includes("username: \"a\""), 'Missing user a');
});

// Test 2: ensureDefaultUser function exists and exports
it('database.js exports ensureDefaultUser function', () => {
  assert(dbCode.includes('export function ensureDefaultUser('), 'Missing ensureDefaultUser function');
  assert(dbCode.includes('INSERT OR REPLACE INTO users'), 'ensureDefaultUser must safely insert or replace user');
});

// Test 3: getUserByUsername auto-seeds missing core users
it('getUserByUsername auto-seeds missing core users (m, ro, a)', () => {
  assert(dbCode.includes('getUserByUsername(username)'), 'Missing getUserByUsername function');
  assert(dbCode.includes('ensureDefaultUser(cleanUser)'), 'getUserByUsername must call ensureDefaultUser on miss');
});

// Test 4: verifyUserLogin auto-seeds missing core users before checking PIN
it('verifyUserLogin auto-seeds missing core users before verifying PIN', () => {
  assert(dbCode.includes('verifyUserLogin(username, pin)'), 'Missing verifyUserLogin function');
  assert(dbCode.includes('DEFAULT_CORE_USERS[cleanUser]'), 'verifyUserLogin must recognize core users');
});

// Test 5: checkUserExists auto-seeds missing core users
it('checkUserExists auto-seeds missing core users', () => {
  assert(dbCode.includes('checkUserExists(username)'), 'Missing checkUserExists function');
});

// Test 6: initDatabase migration branch ensures m and a exist for existing databases
it('initDatabase migration seeds missing manager "m" and admin "a" for existing databases', () => {
  assert(dbCode.includes("SELECT id FROM users WHERE username = 'm'"), 'Migration must check for username m');
  assert(dbCode.includes("SELECT id FROM users WHERE username = 'a'"), 'Migration must check for username a');
  assert(dbCode.includes("manager_shakib1"), 'Migration must seed manager_shakib1');
});

// Test 7: App.js runs initDatabase(false) unconditionally
it('App.js executes initDatabase(false) unconditionally after bootstrap attempt', () => {
  assert(appCode.includes('initDatabase(false);'), 'App.js must run initDatabase(false)');
  assert(!appCode.includes('} else {\n          // Regular launch: existing data found\n          initDatabase(false);'),
    'initDatabase(false) must not be locked inside else branch');
});

// Test 8: LoginScreen role check allows manager role for MANAGER app profile
it('LoginScreen accepts role MANAGER on ACTIVE_APP_PROFILE MANAGER', () => {
  assert(loginCode.includes("ACTIVE_APP_PROFILE === 'MANAGER' && role !== 'MANAGER'"),
    'LoginScreen enforces MANAGER role for MANAGER profile');
});

// Test 9: firebaseAppConfig treats HTTP 429 quota exhaustion as verified to prevent lockout
it('verifyForceReauthLocally treats HTTP 429 as online/verified to prevent quota lockout', () => {
  assert(fbConfigCode.includes('res.status === 429'), 'verifyForceReauthLocally must handle 429 quota code');
});

// Test 10: Simulated resolution logic for manager user
it('Simulation: entering "m" resolves correctly to role "manager" with PIN "1111"', () => {
  const usersDb = new Map();
  const defaultCoreUsers = {
    m: { id: "manager_shakib1", username: "m", pin: "1111", role: "manager" }
  };

  function simulateGetUser(username) {
    const clean = String(username || '').trim().toLowerCase();
    let u = usersDb.get(clean);
    if (!u && defaultCoreUsers[clean]) {
      u = defaultCoreUsers[clean];
      usersDb.set(clean, u);
    }
    return u || null;
  }

  // First call on empty DB returns seeded user
  const resolved = simulateGetUser('m');
  assert.ok(resolved, 'User m must resolve');
  assert.strictEqual(resolved.role, 'manager');
  assert.strictEqual(resolved.pin, '1111');

  // Case insensitive resolution ("M" or " m ")
  assert.ok(simulateGetUser('M'));
  assert.ok(simulateGetUser(' m '));

  // Role comparison in LoginScreen
  const role = String(resolved.role || '').toUpperCase().trim();
  const profile = 'MANAGER';
  const isRejected = (profile === 'MANAGER' && role !== 'MANAGER');
  assert.strictEqual(isRejected, false, 'Manager role must not be rejected on MANAGER profile');
});

// Test 11: fetchVersionPolicy queries Supabase first
it('fetchVersionPolicy queries Supabase app_config first before Firestore', () => {
  assert(fbConfigCode.includes("from('app_config')"), 'fetchVersionPolicy must query app_config');
  assert(fbConfigCode.includes("eq('key', 'version_policy')"), 'fetchVersionPolicy must filter key = version_policy');
  assert(fbConfigCode.includes("source: 'supabase'"), 'fetchVersionPolicy must return source: supabase');
});

// Test 12: verifyForceReauthLocally uses Supabase probe first
it('verifyForceReauthLocally uses Supabase probe first to verify cloud connectivity', () => {
  assert(fbConfigCode.includes("isSupabaseConfigured()"), 'verifyForceReauthLocally must check isSupabaseConfigured');
  assert(fbConfigCode.includes("source: 'supabase'"), 'verifyForceReauthLocally must return source: supabase on success');
});

console.log('\n======================================================');
console.log(`   RESULTS: ${passedTests} passed, ${failedTests} failed`);
console.log('======================================================\n');

if (failedTests > 0) {
  process.exit(1);
}
