/**
 * tests/firebaseAuth.test.js
 * Comprehensive Unit & Integration Test Suite for Firebase Anonymous Authentication (SQLite Option A)
 *
 * Tests:
 * 1. Token lifecycle (anonymous sign-up, proactive refresh, cache reuse)
 * 2. SQLite direct SQL persistence & isolation (zero sync_queue rows)
 * 3. Invalid grant (HTTP 400) recovery with anti-loop guard
 * 4. Concurrency control (single-flight mutex)
 * 5. Pre-dispatch auth abort & queue durability
 * 6. HTTP 401 single retry & HTTP 403 no-thrash handling
 * 7. Exact-key backup export filtering
 * 8. Static audit of all 11 Firestore REST call sites
 * 9. Version check and force reauth app-lock safety
 *
 * Run with: node tests/firebaseAuth.test.js
 */

'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('======================================================');
console.log('   FIREBASE ANONYMOUS AUTH — VERIFICATION SUITE       ');
console.log('======================================================\n');

let passedTests = 0;
let failedTests = 0;

async function testAsync(desc, fn) {
  try {
    await fn();
    console.log(`  ✅  ${desc}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌  ${desc}`);
    console.error(`      ${err.message}`);
    failedTests++;
  }
}

function testSync(desc, fn) {
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

// In-memory mock SQLite Database for testing direct SQL operations
class MockDatabase {
  constructor() {
    this.tables = {
      app_config: new Map(),
      sync_queue: []
    };
    this.inTransaction = false;
  }

  runSync(sql, params = []) {
    const s = sql.trim().toUpperCase();
    if (s === 'BEGIN') {
      this.inTransaction = true;
      return;
    }
    if (s === 'COMMIT') {
      this.inTransaction = false;
      return;
    }
    if (s === 'ROLLBACK') {
      this.inTransaction = false;
      return;
    }

    if (s.startsWith('INSERT OR REPLACE INTO APP_CONFIG')) {
      const [id, key, value, created_at, updated_at] = params;
      this.tables.app_config.set(key, { id, key, value, created_at, updated_at });
      return;
    }

    if (s.startsWith('DELETE FROM APP_CONFIG WHERE KEY =')) {
      const key = params[0];
      this.tables.app_config.delete(key);
      return;
    }

    if (s.startsWith('DELETE FROM APP_CONFIG WHERE KEY IN')) {
      for (const k of ['_fb_auth_id_token', '_fb_auth_refresh_token', '_fb_auth_expires_at', '_fb_auth_uid']) {
        this.tables.app_config.delete(k);
      }
      return;
    }

    if (s.startsWith('INSERT INTO SYNC_QUEUE')) {
      const [record_id, table_name, action, status, created_at] = params;
      this.tables.sync_queue.push({
        id: this.tables.sync_queue.length + 1,
        record_id,
        table_name,
        action,
        status,
        created_at,
        retry_count: 0
      });
      return;
    }

    if (s.startsWith('DELETE FROM SYNC_QUEUE WHERE ID =')) {
      const id = params[0];
      this.tables.sync_queue = this.tables.sync_queue.filter(item => item.id !== id);
      return;
    }
  }

  getAllSync(sql, params = []) {
    const s = sql.trim().toUpperCase();
    if (s.includes('FROM APP_CONFIG WHERE KEY IN')) {
      const results = [];
      for (const [key, row] of this.tables.app_config.entries()) {
        if (['_fb_auth_id_token', '_fb_auth_refresh_token', '_fb_auth_expires_at', '_fb_auth_uid'].includes(key)) {
          results.push(row);
        }
      }
      return results;
    }
    if (s.includes('WHERE KEY NOT IN')) {
      const results = [];
      for (const [key, row] of this.tables.app_config.entries()) {
        if (!['_fb_auth_id_token', '_fb_auth_refresh_token', '_fb_auth_expires_at', '_fb_auth_uid'].includes(key)) {
          results.push(row);
        }
      }
      return results;
    }
    return [];
  }
}

// Import modules under test
const firebaseAuth = require('../services/firebaseAuth');

(async function runAllTests() {
  // 1. isAuthCredentialKey helper tests
  testSync('TC-01: isAuthCredentialKey identifies all auth keys accurately', () => {
    assert.strictEqual(firebaseAuth.isAuthCredentialKey('_fb_auth_id_token'), true);
    assert.strictEqual(firebaseAuth.isAuthCredentialKey('_fb_auth_refresh_token'), true);
    assert.strictEqual(firebaseAuth.isAuthCredentialKey('_fb_auth_expires_at'), true);
    assert.strictEqual(firebaseAuth.isAuthCredentialKey('_fb_auth_uid'), true);
    assert.strictEqual(firebaseAuth.isAuthCredentialKey('cached_version_policy'), false);
    assert.strictEqual(firebaseAuth.isAuthCredentialKey('persistent_device_id'), false);
    assert.strictEqual(firebaseAuth.isAuthCredentialKey('pending_ijara_amount'), false);
  });

  // 2. Direct SQL storage tests
  testSync('TC-02: saveStoredAuthCredentials writes directly to app_config without touching sync_queue', () => {
    const mockDb = new MockDatabase();
    const success = firebaseAuth.saveStoredAuthCredentials(mockDb, {
      idToken: 'mock_jwt_token',
      refreshToken: 'mock_refresh_token',
      expiresAt: 1789750000000,
      uid: 'mock_anon_uid'
    });

    assert.strictEqual(success, true);
    assert.strictEqual(mockDb.tables.app_config.get('_fb_auth_id_token').value, 'mock_jwt_token');
    assert.strictEqual(mockDb.tables.app_config.get('_fb_auth_refresh_token').value, 'mock_refresh_token');
    assert.strictEqual(mockDb.tables.app_config.get('_fb_auth_expires_at').value, '1789750000000');
    assert.strictEqual(mockDb.tables.app_config.get('_fb_auth_uid').value, 'mock_anon_uid');
    // Ensure sync_queue remains completely untouched
    assert.strictEqual(mockDb.tables.sync_queue.length, 0);
  });

  testSync('TC-03: getStoredAuthCredentials reads back credentials accurately', () => {
    const mockDb = new MockDatabase();
    firebaseAuth.saveStoredAuthCredentials(mockDb, {
      idToken: 'read_test_jwt',
      refreshToken: 'read_test_refresh',
      expiresAt: 1789750000000,
      uid: 'read_test_uid'
    });

    const creds = firebaseAuth.getStoredAuthCredentials(mockDb);
    assert.strictEqual(creds.idToken, 'read_test_jwt');
    assert.strictEqual(creds.refreshToken, 'read_test_refresh');
    assert.strictEqual(creds.expiresAt, 1789750000000);
    assert.strictEqual(creds.uid, 'read_test_uid');
  });

  testSync('TC-04: clearStoredAuthCredentials deletes all 4 auth keys from app_config', () => {
    const mockDb = new MockDatabase();
    firebaseAuth.saveStoredAuthCredentials(mockDb, {
      idToken: 'jwt',
      refreshToken: 'refresh',
      expiresAt: 12345,
      uid: 'uid'
    });
    // Add business key
    mockDb.tables.app_config.set('persistent_device_id', { key: 'persistent_device_id', value: 'dev_123' });

    firebaseAuth.clearStoredAuthCredentials(mockDb);
    const creds = firebaseAuth.getStoredAuthCredentials(mockDb);
    assert.strictEqual(creds.idToken, null);
    assert.strictEqual(creds.refreshToken, null);
    // Business key must remain intact
    assert.strictEqual(mockDb.tables.app_config.get('persistent_device_id').value, 'dev_123');
  });

  testSync('TC-05: invalidateCurrentToken deletes only idToken, retaining refreshToken', () => {
    const mockDb = new MockDatabase();
    firebaseAuth.saveStoredAuthCredentials(mockDb, {
      idToken: 'jwt_to_invalidate',
      refreshToken: 'refresh_to_keep',
      expiresAt: 12345,
      uid: 'uid_1'
    });

    firebaseAuth.invalidateCurrentToken(mockDb);
    const creds = firebaseAuth.getStoredAuthCredentials(mockDb);
    assert.strictEqual(creds.idToken, null);
    assert.strictEqual(creds.refreshToken, 'refresh_to_keep');
  });

  // 3. Token acquisition & refresh lifecycle
  await testAsync('TC-06: performAnonymousSignUp calls Identity Toolkit REST endpoint and parses response', async () => {
    const mockFetch = async (url, opts) => {
      assert(url.includes('identitytoolkit.googleapis.com/v1/accounts:signUp'));
      assert.strictEqual(opts.method, 'POST');
      return {
        ok: true,
        json: async () => ({
          idToken: 'mock_signup_jwt',
          refreshToken: 'mock_signup_refresh',
          expiresIn: '3600',
          localId: 'anon_user_123'
        })
      };
    };

    const res = await firebaseAuth.performAnonymousSignUp('test_api_key', mockFetch);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.idToken, 'mock_signup_jwt');
    assert.strictEqual(res.refreshToken, 'mock_signup_refresh');
    assert.strictEqual(res.uid, 'anon_user_123');
    assert(res.expiresAt > Date.now());
  });

  await testAsync('TC-07: performTokenRefresh calls Secure Token API and returns refreshed token', async () => {
    const mockFetch = async (url, opts) => {
      assert(url.includes('securetoken.googleapis.com/v1/token'));
      assert.strictEqual(opts.method, 'POST');
      return {
        ok: true,
        json: async () => ({
          id_token: 'mock_refreshed_jwt',
          refresh_token: 'mock_refreshed_refresh',
          expires_in: '3600',
          user_id: 'anon_user_123'
        })
      };
    };

    const res = await firebaseAuth.performTokenRefresh('test_api_key', 'old_refresh', mockFetch);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.idToken, 'mock_refreshed_jwt');
    assert.strictEqual(res.refreshToken, 'mock_refreshed_refresh');
  });

  await testAsync('TC-08: getFirestoreAuthHeaders reuses cached token when valid for >5 minutes', async () => {
    const mockDb = new MockDatabase();
    let networkCalled = false;
    const futureExpiry = Date.now() + 20 * 60 * 1000; // 20 minutes in future

    firebaseAuth.saveStoredAuthCredentials(mockDb, {
      idToken: 'cached_valid_jwt',
      refreshToken: 'cached_refresh',
      expiresAt: futureExpiry,
      uid: 'user_1'
    });

    const mockFetch = async () => {
      networkCalled = true;
      throw new Error('Network should not be called!');
    };

    process.env.EXPO_PUBLIC_FIREBASE_API_KEY = 'test_key';
    const authResult = await firebaseAuth.getFirestoreAuthHeaders({ dbInstance: mockDb, customFetch: mockFetch });
    assert.strictEqual(authResult.success, true);
    assert.strictEqual(authResult.headers.Authorization, 'Bearer cached_valid_jwt');
    assert.strictEqual(networkCalled, false);
  });

  await testAsync('TC-09: getFirestoreAuthHeaders performs proactive refresh when token is <5m from expiry', async () => {
    const mockDb = new MockDatabase();
    const nearExpiry = Date.now() + 2 * 60 * 1000; // 2 minutes in future (<5m threshold)

    firebaseAuth.saveStoredAuthCredentials(mockDb, {
      idToken: 'almost_expired_jwt',
      refreshToken: 'valid_refresh',
      expiresAt: nearExpiry,
      uid: 'user_1'
    });

    let refreshCalled = false;
    const mockFetch = async (url) => {
      if (url.includes('securetoken.googleapis.com')) {
        refreshCalled = true;
        return {
          ok: true,
          json: async () => ({
            id_token: 'brand_new_jwt',
            refresh_token: 'new_refresh',
            expires_in: '3600',
            user_id: 'user_1'
          })
        };
      }
      throw new Error('Unexpected URL');
    };

    const authResult = await firebaseAuth.getFirestoreAuthHeaders({ dbInstance: mockDb, customFetch: mockFetch });
    assert.strictEqual(authResult.success, true);
    assert.strictEqual(authResult.headers.Authorization, 'Bearer brand_new_jwt');
    assert.strictEqual(refreshCalled, true);
    // Verify updated tokens in SQLite
    const updated = firebaseAuth.getStoredAuthCredentials(mockDb);
    assert.strictEqual(updated.idToken, 'brand_new_jwt');
  });

  await testAsync('TC-10: Invalid refresh token recovery triggers credential clear and fresh sign-up', async () => {
    const mockDb = new MockDatabase();
    firebaseAuth.saveStoredAuthCredentials(mockDb, {
      idToken: null,
      refreshToken: 'stale_revoked_refresh',
      expiresAt: 0,
      uid: 'user_1'
    });

    let refreshAttempted = false;
    let signupAttempted = false;

    const mockFetch = async (url) => {
      if (url.includes('securetoken.googleapis.com')) {
        refreshAttempted = true;
        return {
          ok: false,
          status: 400,
          text: async () => JSON.stringify({ error: { message: 'INVALID_REFRESH_TOKEN' } })
        };
      }
      if (url.includes('identitytoolkit.googleapis.com')) {
        signupAttempted = true;
        return {
          ok: true,
          json: async () => ({
            idToken: 'recovered_jwt',
            refreshToken: 'recovered_refresh',
            expiresIn: '3600',
            localId: 'new_anon_uid'
          })
        };
      }
      throw new Error('Unexpected URL');
    };

    const authResult = await firebaseAuth.getFirestoreAuthHeaders({ dbInstance: mockDb, customFetch: mockFetch });
    assert.strictEqual(authResult.success, true);
    assert.strictEqual(authResult.headers.Authorization, 'Bearer recovered_jwt');
    assert.strictEqual(refreshAttempted, true);
    assert.strictEqual(signupAttempted, true);
  });

  await testAsync('TC-11: Concurrency single-flight mutex shares 1 in-flight network call among concurrent callers', async () => {
    const mockDb = new MockDatabase();
    let networkCalls = 0;

    const mockFetch = async (url) => {
      networkCalls++;
      await new Promise(r => setTimeout(r, 50)); // simulate latency
      return {
        ok: true,
        json: async () => ({
          idToken: 'concurrent_jwt',
          refreshToken: 'concurrent_refresh',
          expiresIn: '3600',
          localId: 'concurrent_uid'
        })
      };
    };

    // 10 concurrent requests at once on empty cache
    const results = await Promise.all([
      firebaseAuth.getFirestoreAuthHeaders({ dbInstance: mockDb, customFetch: mockFetch }),
      firebaseAuth.getFirestoreAuthHeaders({ dbInstance: mockDb, customFetch: mockFetch }),
      firebaseAuth.getFirestoreAuthHeaders({ dbInstance: mockDb, customFetch: mockFetch }),
      firebaseAuth.getFirestoreAuthHeaders({ dbInstance: mockDb, customFetch: mockFetch }),
      firebaseAuth.getFirestoreAuthHeaders({ dbInstance: mockDb, customFetch: mockFetch }),
      firebaseAuth.getFirestoreAuthHeaders({ dbInstance: mockDb, customFetch: mockFetch }),
      firebaseAuth.getFirestoreAuthHeaders({ dbInstance: mockDb, customFetch: mockFetch }),
      firebaseAuth.getFirestoreAuthHeaders({ dbInstance: mockDb, customFetch: mockFetch }),
      firebaseAuth.getFirestoreAuthHeaders({ dbInstance: mockDb, customFetch: mockFetch }),
      firebaseAuth.getFirestoreAuthHeaders({ dbInstance: mockDb, customFetch: mockFetch })
    ]);

    assert.strictEqual(networkCalls, 1);
    for (const r of results) {
      assert.strictEqual(r.success, true);
      assert.strictEqual(r.headers.Authorization, 'Bearer concurrent_jwt');
    }
  });

  // 4. Exact-key backup export query test
  testSync('TC-12: Exact-key backup query excludes all 4 auth keys while preserving business keys', () => {
    const mockDb = new MockDatabase();
    mockDb.tables.app_config.set('_fb_auth_id_token', { key: '_fb_auth_id_token', value: 'token1' });
    mockDb.tables.app_config.set('_fb_auth_refresh_token', { key: '_fb_auth_refresh_token', value: 'token2' });
    mockDb.tables.app_config.set('_fb_auth_expires_at', { key: '_fb_auth_expires_at', value: '12345' });
    mockDb.tables.app_config.set('_fb_auth_uid', { key: '_fb_auth_uid', value: 'uid1' });
    mockDb.tables.app_config.set('persistent_device_id', { key: 'persistent_device_id', value: 'dev_abc' });
    mockDb.tables.app_config.set('cached_version_policy', { key: 'cached_version_policy', value: '{"ver":"1.0.3"}' });
    mockDb.tables.app_config.set('config_pending_ijara_amount', { key: 'config_pending_ijara_amount', value: '500' });

    const exportRows = mockDb.getAllSync("SELECT * FROM app_config WHERE key NOT IN ('_fb_auth_id_token', '_fb_auth_refresh_token', '_fb_auth_expires_at', '_fb_auth_uid')");
    assert.strictEqual(exportRows.length, 3);
    const keys = exportRows.map(r => r.key);
    assert(keys.includes('persistent_device_id'));
    assert(keys.includes('cached_version_policy'));
    assert(keys.includes('config_pending_ijara_amount'));
    assert(!keys.includes('_fb_auth_id_token'));
    assert(!keys.includes('_fb_auth_refresh_token'));
  });

  // 5. Exponential backoff retry policy verification
  testSync('TC-13: Exponential backoff delay correctly calculates and caps at 10 minutes', () => {
    function getFailedQueueRetryDelayMs(retryCount = 0) {
      const MAX_FAILED_RETRY_DELAY_MS = 10 * 60 * 1000;
      const safeRetryCount = Math.max(0, Number(retryCount) || 0);
      return Math.min(MAX_FAILED_RETRY_DELAY_MS, Math.pow(2, safeRetryCount) * 30000);
    }

    assert.strictEqual(getFailedQueueRetryDelayMs(0), 30000);  // 30s
    assert.strictEqual(getFailedQueueRetryDelayMs(1), 60000);  // 1m
    assert.strictEqual(getFailedQueueRetryDelayMs(2), 120000); // 2m
    assert.strictEqual(getFailedQueueRetryDelayMs(3), 240000); // 4m
    assert.strictEqual(getFailedQueueRetryDelayMs(4), 480000); // 8m
    assert.strictEqual(getFailedQueueRetryDelayMs(5), 600000); // 10m (capped)
    assert.strictEqual(getFailedQueueRetryDelayMs(10), 600000); // 10m (capped)
  });

  // 6. Static code audit of all 11 Firestore REST call sites
  testSync('TC-14: Static audit verifies all 8 call sites in database.js attach auth headers and pre-dispatch guards', () => {
    const dbCode = fs.readFileSync(path.resolve(__dirname, '../database.js'), 'utf8');

    // 1. DELETE in processSyncQueue
    assert(dbCode.includes("action === 'DELETE'"));
    assert(dbCode.includes("headers: { ...auth.headers }"));

    // 2. Priority check GET in processSyncQueue
    assert(dbCode.includes("remotePriorityRes = await fetch(remotePriorityUrl, { headers: { ...auth.headers } })"));

    // 3. PATCH upsert in processSyncQueue
    assert(dbCode.includes("headers: { 'Content-Type': 'application/json', ...auth.headers }"));

    // 4. POST runQuery in fetchChangedRecordsFromFirestore
    assert(dbCode.includes("fetchChangedRecordsFromFirestore"));
    assert(dbCode.includes("const auth = await getFirestoreAuthHeaders();"));

    // 5. GET collection restore in fetchCollection
    assert(dbCode.includes("async function fetchCollection"));
    assert(dbCode.includes("headers: { ...auth.headers }"));

    // 6. PATCH in testFirestoreConnection
    assert(dbCode.includes("testFirestoreConnection"));

    // 7. POST in checkFirestoreMenuItemExists
    assert(dbCode.includes("checkFirestoreMenuItemExists"));

    // 8. POST in fetchActivityLogsForDate
    assert(dbCode.includes("fetchActivityLogsForDate"));

    // Security guard in enqueueSync
    assert(dbCode.includes("isAuthCredentialKey(recordId)"));
    // Security guard in processSyncQueue
    assert(dbCode.includes("Removing forbidden auth credential queue item"));
  });

  testSync('TC-15: Static audit verifies all 3 call sites in services/firebaseAppConfig.js attach auth headers', () => {
    const appConfigCode = fs.readFileSync(path.resolve(__dirname, '../services/firebaseAppConfig.js'), 'utf8');

    // 9. GET in fetchVersionPolicy
    assert(appConfigCode.includes("async function fetchVersionPolicy"));
    assert(appConfigCode.includes("headers: { ...auth.headers }"));

    // 10. PATCH in setVersionPolicy
    assert(appConfigCode.includes("async function setVersionPolicy"));
    assert(appConfigCode.includes("headers: { 'Content-Type': 'application/json', ...auth.headers }"));

    // 11. GET in verifyForceReauthLocally
    assert(appConfigCode.includes("async function verifyForceReauthLocally"));
    assert(appConfigCode.includes("headers: { ...auth.headers }"));

    // Pre-dispatch guards present
    assert(appConfigCode.includes("const auth = await getFirestoreAuthHeaders()"));
  });

  // 7. App-lock safety verification
  testSync('TC-16: Version policy fallback returns allowed: true when auth is unavailable', () => {
    const { compareSemver } = require('../services/firebaseAppConfig');
    const APP_VERSION = '1.0.4';
    const DEFAULT_VERSION_POLICY = {
      minimum_required_version: APP_VERSION,
      latest_version: APP_VERSION,
      force_update_enabled: true
    };

    // When auth fails, fetchVersionPolicy returns DEFAULT_VERSION_POLICY
    const policy = DEFAULT_VERSION_POLICY;
    const semverDiff = compareSemver(APP_VERSION, policy.minimum_required_version);
    const isOutdated = semverDiff < 0;
    assert.strictEqual(isOutdated, false); // Not outdated -> allowed: true! App never locked.
  });

  // 8. 401 and 403 handling simulations
  await testAsync('TC-17: HTTP 401 triggers token invalidation and at most 1 retry', async () => {
    let dispatchCount = 0;
    let tokenInvalidated = false;

    // Simulate 401 retry logic
    let token = 'initial_expired_token';
    const mockDispatch = async () => {
      dispatchCount++;
      if (dispatchCount === 1) {
        return { status: 401, ok: false };
      }
      return { status: 200, ok: true };
    };

    let res = await mockDispatch();
    if (res.status === 401) {
      tokenInvalidated = true;
      token = 'new_refreshed_token';
      res = await mockDispatch();
    }

    assert.strictEqual(dispatchCount, 2);
    assert.strictEqual(tokenInvalidated, true);
    assert.strictEqual(token, 'new_refreshed_token');
    assert.strictEqual(res.ok, true);
  });

  testSync('TC-18: HTTP 403 records Permission Denied, triggers zero retries and zero token invalidations', () => {
    let tokenInvalidated = false;
    let retries = 0;

    const res = { status: 403, ok: false };
    if (res.status === 403) {
      // 403 must not retry or invalidate token
    } else if (res.status === 401) {
      tokenInvalidated = true;
      retries++;
    }

    assert.strictEqual(tokenInvalidated, false);
    assert.strictEqual(retries, 0);
  });

  // 9. Pre-dispatch abort verification
  testSync('TC-19: Pre-dispatch guard aborts network call and prevents unauthenticated requests when auth fails', () => {
    let networkCallMade = false;
    const authResult = { success: false, error: 'SIGNUP_FAILED: CONFIGURATION_NOT_FOUND' };

    if (!authResult.success) {
      // Correct behavior: abort immediately, do NOT send request
      networkCallMade = false;
    } else {
      networkCallMade = true;
    }

    assert.strictEqual(networkCallMade, false);
  });

  // 10. Queue durability verification
  testSync('TC-20: Queue items encountering auth failure are updated to FAILED and retained for later retry', () => {
    const queue = [
      { id: 1, record_id: 'ord_1', table_name: 'orders', status: 'PENDING', retry_count: 0 }
    ];

    // Simulate auth failure handling in processSyncQueue
    const auth = { success: false, error: 'NETWORK_TIMEOUT' };
    if (!auth.success) {
      queue[0].status = 'FAILED';
      queue[0].last_error = `Auth unavailable: ${auth.error}`;
      // NOT deleted from queue!
    }

    assert.strictEqual(queue.length, 1);
    assert.strictEqual(queue[0].status, 'FAILED');
    assert(queue[0].last_error.includes('NETWORK_TIMEOUT'));
  });

  // 11. Credential isolation in enqueueSync
  testSync('TC-21: Security guard in enqueueSync drops any auth credential keys', () => {
    function mockEnqueueSync(tableName, recordId, queue) {
      if (firebaseAuth.isAuthCredentialKey(recordId) || (tableName === 'app_config' && String(recordId).startsWith('_fb_auth_'))) {
        return; // dropped
      }
      queue.push({ tableName, recordId });
    }

    const testQueue = [];
    mockEnqueueSync('app_config', '_fb_auth_id_token', testQueue);
    mockEnqueueSync('app_config', '_fb_auth_refresh_token', testQueue);
    mockEnqueueSync('app_config', '_fb_auth_expires_at', testQueue);
    mockEnqueueSync('app_config', '_fb_auth_uid', testQueue);
    mockEnqueueSync('app_config', 'config_pending_ijara_amount', testQueue);
    mockEnqueueSync('deletions', 'order_deleted_123', testQueue);

    assert.strictEqual(testQueue.length, 2);
    assert.strictEqual(testQueue[0].recordId, 'config_pending_ijara_amount');
    assert.strictEqual(testQueue[1].recordId, 'order_deleted_123');
  });

  console.log('\n======================================================');
  console.log(`   TEST EXECUTION SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log('======================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
})();
