/**
 * services/firebaseAuth.js
 * Firebase Anonymous Authentication Service (SQLite Option A)
 *
 * Implements:
 * 1. Anonymous token minting via Google Identity Toolkit REST API (accounts:signUp)
 * 2. Token refresh via Google Secure Token REST API (token?grant_type=refresh_token)
 * 3. Token persistence directly in SQLite `app_config` using direct SQL (bypasses setAppConfig & enqueueSync)
 * 4. Single-flight concurrency mutex to deduplicate concurrent refresh/sign-up requests
 * 5. Proactive token refresh 5 minutes before expiration
 * 6. Invalid refresh token recovery (invalid_grant -> clear credentials -> fresh sign-up) with anti-loop guard
 * 7. Bounded 401 token invalidation and retry guard
 * 8. Zero credential leakage: tokens excluded from sync_queue, exports, diagnostics, and logs
 */

export const AUTH_KEYS = [
  '_fb_auth_id_token',
  '_fb_auth_refresh_token',
  '_fb_auth_expires_at',
  '_fb_auth_uid'
];

export const KEY_ID_TOKEN = '_fb_auth_id_token';
export const KEY_REFRESH_TOKEN = '_fb_auth_refresh_token';
export const KEY_EXPIRES_AT = '_fb_auth_expires_at';
export const KEY_UID = '_fb_auth_uid';

const REFRESH_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes before expiry
const NETWORK_TIMEOUT_MS = 10000; // 10 seconds timeout

// Concurrency control & recovery state
let authPromiseInProgress = null;
let isRecoveryInProgress = false;

/**
 * Returns true if a given key is an internal auth credential key
 */
export function isAuthCredentialKey(key) {
  if (!key || typeof key !== 'string') return false;
  return key.startsWith('_fb_auth_') || AUTH_KEYS.includes(key);
}

/**
 * Resolves SQLite database instance safely
 */
function resolveDb(customDb = null) {
  if (customDb) return customDb;
  try {
    const { getDb } = require('../database');
    return getDb();
  } catch (e) {
    return null;
  }
}

/**
 * Reads Firebase configuration from environment
 */
export function getFirebaseAuthConfig() {
  const projectId = (process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || '').trim().replace(/[\r\n\0]/g, '');
  const apiKey = (process.env.EXPO_PUBLIC_FIREBASE_API_KEY || '').trim().replace(/[\r\n\0]/g, '');
  return { projectId, apiKey };
}

/**
 * Reads stored auth credentials from SQLite app_config using DIRECT SQL.
 * Never touches setAppConfig() or enqueueSync().
 */
export function getStoredAuthCredentials(dbInstance = null) {
  const db = resolveDb(dbInstance);
  if (!db) return { idToken: null, refreshToken: null, expiresAt: 0, uid: null };

  try {
    const rows = db.getAllSync(
      "SELECT key, value FROM app_config WHERE key IN ('_fb_auth_id_token', '_fb_auth_refresh_token', '_fb_auth_expires_at', '_fb_auth_uid')"
    );

    const creds = { idToken: null, refreshToken: null, expiresAt: 0, uid: null };
    if (Array.isArray(rows)) {
      for (const row of rows) {
        if (row.key === KEY_ID_TOKEN) creds.idToken = row.value || null;
        else if (row.key === KEY_REFRESH_TOKEN) creds.refreshToken = row.value || null;
        else if (row.key === KEY_EXPIRES_AT) creds.expiresAt = Number(row.value) || 0;
        else if (row.key === KEY_UID) creds.uid = row.value || null;
      }
    }
    return creds;
  } catch (err) {
    console.error('[FirebaseAuth] Failed to read stored credentials from SQLite:', err.message);
    return { idToken: null, refreshToken: null, expiresAt: 0, uid: null };
  }
}

/**
 * Writes auth credentials to SQLite app_config using DIRECT SQL.
 * Guarantees zero rows are placed into sync_queue or sent to Firestore.
 */
export function saveStoredAuthCredentials(dbInstance = null, { idToken, refreshToken, expiresAt, uid }) {
  const db = resolveDb(dbInstance);
  if (!db) return false;

  const now = new Date().toISOString();
  try {
    db.runSync('BEGIN');
    if (idToken !== undefined && idToken !== null) {
      db.runSync(
        "INSERT OR REPLACE INTO app_config (id, key, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        [KEY_ID_TOKEN, KEY_ID_TOKEN, idToken, now, now]
      );
    }
    if (refreshToken !== undefined && refreshToken !== null) {
      db.runSync(
        "INSERT OR REPLACE INTO app_config (id, key, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        [KEY_REFRESH_TOKEN, KEY_REFRESH_TOKEN, refreshToken, now, now]
      );
    }
    if (expiresAt !== undefined && expiresAt !== null) {
      db.runSync(
        "INSERT OR REPLACE INTO app_config (id, key, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        [KEY_EXPIRES_AT, KEY_EXPIRES_AT, String(expiresAt), now, now]
      );
    }
    if (uid !== undefined && uid !== null) {
      db.runSync(
        "INSERT OR REPLACE INTO app_config (id, key, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        [KEY_UID, KEY_UID, uid, now, now]
      );
    }
    db.runSync('COMMIT');
    return true;
  } catch (err) {
    try { db.runSync('ROLLBACK'); } catch (_) {}
    console.error('[FirebaseAuth] Failed to save credentials to SQLite:', err.message);
    return false;
  }
}

/**
 * Clears stored auth credentials from SQLite app_config using DIRECT SQL.
 */
export function clearStoredAuthCredentials(dbInstance = null) {
  const db = resolveDb(dbInstance);
  if (!db) return false;

  try {
    db.runSync(
      "DELETE FROM app_config WHERE key IN ('_fb_auth_id_token', '_fb_auth_refresh_token', '_fb_auth_expires_at', '_fb_auth_uid')"
    );
    return true;
  } catch (err) {
    console.error('[FirebaseAuth] Failed to clear credentials from SQLite:', err.message);
    return false;
  }
}

/**
 * Invalidates the current cached idToken in SQLite, forcing a refresh on next call.
 */
export function invalidateCurrentToken(dbInstance = null) {
  const db = resolveDb(dbInstance);
  if (!db) return false;

  try {
    db.runSync("DELETE FROM app_config WHERE key = ?", [KEY_ID_TOKEN]);
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Fetch wrapper with timeout
 */
async function fetchWithTimeout(url, options = {}, customFetch = null) {
  const fetchFn = customFetch || fetch;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS) : null;

  try {
    const opts = { ...options };
    if (controller) opts.signal = controller.signal;
    const res = await fetchFn(url, opts);
    return res;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

/**
 * Signs up anonymously via Google Identity Toolkit REST API
 */
export async function performAnonymousSignUp(apiKey, customFetch = null) {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`;
  const res = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnSecureToken: true })
    },
    customFetch
  );

  if (!res.ok) {
    const errorText = await res.text();
    let errorCode = `HTTP_${res.status}`;
    try {
      const errJson = JSON.parse(errorText);
      errorCode = errJson?.error?.message || errorCode;
    } catch (_) {}
    return { success: false, error: errorCode };
  }

  const data = await res.json();
  const idToken = data.idToken;
  const refreshToken = data.refreshToken;
  const expiresInSec = Number(data.expiresIn) || 3600;
  const expiresAt = Date.now() + expiresInSec * 1000;
  const uid = data.localId;

  if (!idToken || !refreshToken) {
    return { success: false, error: 'MALFORMED_AUTH_RESPONSE' };
  }

  return { success: true, idToken, refreshToken, expiresAt, uid };
}

/**
 * Refreshes an expired idToken using Google Secure Token REST API
 */
export async function performTokenRefresh(apiKey, refreshToken, customFetch = null) {
  const url = `https://securetoken.googleapis.com/v1/token?key=${apiKey}`;
  const body = `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`;

  const res = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    },
    customFetch
  );

  if (!res.ok) {
    const errorText = await res.text();
    let errorCode = `HTTP_${res.status}`;
    try {
      const errJson = JSON.parse(errorText);
      errorCode = errJson?.error?.message || errorCode;
    } catch (_) {}
    return { success: false, error: errorCode, status: res.status };
  }

  const data = await res.json();
  const idToken = data.id_token;
  const newRefreshToken = data.refresh_token || refreshToken;
  const expiresInSec = Number(data.expires_in) || 3600;
  const expiresAt = Date.now() + expiresInSec * 1000;
  const uid = data.user_id;

  if (!idToken) {
    return { success: false, error: 'MALFORMED_REFRESH_RESPONSE' };
  }

  return { success: true, idToken, refreshToken: newRefreshToken, expiresAt, uid };
}

/**
 * Main token engine: acquires, refreshes, caches, and returns active Authorization headers.
 * Implements concurrency mutex, proactive refresh, invalid_grant recovery, and timeout guards.
 *
 * @param {Object} [options]
 * @param {Object} [options.dbInstance] - Optional SQLite db instance injection
 * @param {Function} [options.customFetch] - Optional fetch injection for testing
 * @returns {Promise<{ success: boolean, headers?: { Authorization: string }, error?: string }>}
 */
export async function getFirestoreAuthHeaders(options = {}) {
  // Concurrency mutex: join any in-flight auth promise
  if (authPromiseInProgress) {
    return await authPromiseInProgress;
  }

  const runner = async () => {
    const { apiKey } = getFirebaseAuthConfig();
    if (!apiKey) {
      return { success: false, error: 'FIREBASE_API_KEY_MISSING' };
    }

    const db = resolveDb(options.dbInstance);
    const now = Date.now();

    // 1. Check local SQLite cache
    const cached = getStoredAuthCredentials(db);

    // If we have an idToken and it has more than 5 minutes of validity left, reuse it immediately
    if (cached.idToken && cached.expiresAt && cached.expiresAt - now > REFRESH_THRESHOLD_MS) {
      return {
        success: true,
        headers: { Authorization: `Bearer ${cached.idToken}` },
        uid: cached.uid
      };
    }

    // 2. If we have a refresh token, attempt refresh
    if (cached.refreshToken) {
      const refreshResult = await performTokenRefresh(apiKey, cached.refreshToken, options.customFetch);

      if (refreshResult.success) {
        saveStoredAuthCredentials(db, {
          idToken: refreshResult.idToken,
          refreshToken: refreshResult.refreshToken,
          expiresAt: refreshResult.expiresAt,
          uid: refreshResult.uid || cached.uid
        });

        return {
          success: true,
          headers: { Authorization: `Bearer ${refreshResult.idToken}` },
          uid: refreshResult.uid || cached.uid
        };
      }

      // Check if refresh failure was invalid_grant / HTTP 400 (expired or revoked refresh token)
      const isInvalidGrant =
        refreshResult.status === 400 ||
        (refreshResult.error && refreshResult.error.includes('INVALID_REFRESH_TOKEN')) ||
        (refreshResult.error && refreshResult.error.includes('TOKEN_EXPIRED'));

      if (isInvalidGrant) {
        // Controlled Recovery: Clear invalid credentials and attempt fresh anonymous sign-up
        if (!isRecoveryInProgress) {
          isRecoveryInProgress = true;
          try {
            clearStoredAuthCredentials(db);
            const reSignup = await performAnonymousSignUp(apiKey, options.customFetch);
            if (reSignup.success) {
              saveStoredAuthCredentials(db, {
                idToken: reSignup.idToken,
                refreshToken: reSignup.refreshToken,
                expiresAt: reSignup.expiresAt,
                uid: reSignup.uid
              });
              return {
                success: true,
                headers: { Authorization: `Bearer ${reSignup.idToken}` },
                uid: reSignup.uid
              };
            }
          } finally {
            isRecoveryInProgress = false;
          }
        }
      }

      // Network or transient refresh failure — do NOT send unauthenticated requests
      return { success: false, error: `REFRESH_FAILED: ${refreshResult.error}` };
    }

    // 3. No credentials cached — perform initial anonymous sign-up
    const signUpResult = await performAnonymousSignUp(apiKey, options.customFetch);
    if (!signUpResult.success) {
      return { success: false, error: `SIGNUP_FAILED: ${signUpResult.error}` };
    }

    saveStoredAuthCredentials(db, {
      idToken: signUpResult.idToken,
      refreshToken: signUpResult.refreshToken,
      expiresAt: signUpResult.expiresAt,
      uid: signUpResult.uid
    });

    return {
      success: true,
      headers: { Authorization: `Bearer ${signUpResult.idToken}` },
      uid: signUpResult.uid
    };
  };

  authPromiseInProgress = runner().finally(() => {
    authPromiseInProgress = null;
  });

  return await authPromiseInProgress;
}

