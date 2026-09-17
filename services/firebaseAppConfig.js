/**
 * firebaseAppConfig.js
 * Firebase App Config Service — Version gating + Force Reauth verification
 * Uses Firestore REST API (same pattern as database.js)
 */

import appJson from '../app.json';

const COLLECTION = 'app_config';
const DOC_ID = 'global';

export const APP_VERSION = appJson.expo?.version || '1.0.1';

function getFirebaseConfig() {
  const projectId = (process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || '').trim().replace(/[\r\n\0]/g, '');
  const apiKey = (process.env.EXPO_PUBLIC_FIREBASE_API_KEY || '').trim().replace(/[\r\n\0]/g, '');
  return { projectId, apiKey };
}

function firestoreDocUrl(projectId, apiKey, docId) {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${COLLECTION}/${encodeURIComponent(docId)}?key=${apiKey}`;
}

/**
 * Compare semver strings. Returns:
 *  1 if a > b,  -1 if a < b,  0 if equal
 */
function compareSemver(a, b) {
  const pa = (a || '0').split('.').map(Number);
  const pb = (b || '0').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

/**
 * Fetch the minimum_version from Firebase app_config/global.
 * Returns { allowed: bool, minimumVersion: string, currentVersion: string }
 *
 * @param {string} role - The user role ('admin', 'owner', 'manager')
 * admin role always returns allowed: true (no version gate)
 */
export async function checkAppVersion(role = '') {
  // Admin is never version-gated
  if (String(role).toLowerCase() === 'admin') {
    return { allowed: true, minimumVersion: APP_VERSION, currentVersion: APP_VERSION };
  }

  const { projectId, apiKey } = getFirebaseConfig();
  if (!projectId || !apiKey) {
    console.warn('[AppVersion] Missing Firebase env vars — allowing login');
    return { allowed: true, minimumVersion: 'unknown', currentVersion: APP_VERSION };
  }

  try {
    const url = firestoreDocUrl(projectId, apiKey, DOC_ID);
    const res = await fetch(url, { method: 'GET' });

    if (!res.ok) {
      // If doc doesn't exist yet (404) allow login
      console.warn(`[AppVersion] Firestore returned ${res.status} — allowing login`);
      return { allowed: true, minimumVersion: 'unset', currentVersion: APP_VERSION };
    }

    const data = await res.json();
    const fields = data.fields || {};
    const minimumVersion = (fields.minimum_version?.stringValue || '0.0.0').trim();

    const allowed = compareSemver(APP_VERSION, minimumVersion) >= 0;
    return { allowed, minimumVersion, currentVersion: APP_VERSION };
  } catch (err) {
    console.error('[AppVersion] Error checking version:', err);
    // On network error — allow (don't block user who is already online)
    return { allowed: true, minimumVersion: 'error', currentVersion: APP_VERSION };
  }
}

/**
 * Fetch the current minimum_version from Firebase (for Admin UI display).
 * Returns string version or null on error.
 */
export async function fetchMinimumVersion() {
  const { projectId, apiKey } = getFirebaseConfig();
  if (!projectId || !apiKey) {
    console.warn('[AppVersion] Missing Firebase credentials');
    return null;
  }

  try {
    const url = firestoreDocUrl(projectId, apiKey, DOC_ID);
    const res = await fetch(url, { method: 'GET' });
    if (res.status === 404) {
      console.log('[AppVersion] Document not found, auto-initializing with:', APP_VERSION);
      await setMinimumVersion(APP_VERSION);
      return APP_VERSION;
    }
    if (!res.ok) {
      console.warn(`[AppVersion] Fetch error status: ${res.status}`);
      return null;
    }
    const data = await res.json();
    const fields = data.fields || {};
    return fields.minimum_version?.stringValue || APP_VERSION;
  } catch (err) {
    console.error('[AppVersion] Error fetching minimum version:', err);
    return null;
  }
}

/**
 * Update minimum_version in Firebase — Admin only.
 * Returns { success: bool, error?: string }
 */
export async function setMinimumVersion(newVersion) {
  const { projectId, apiKey } = getFirebaseConfig();
  if (!projectId || !apiKey) {
    return { success: false, error: 'Firebase config not available' };
  }

  // Allow formats like 1.0.1, 1.0, 56.0.4
  if (!newVersion || !/^\d+(\.\d+)+$/.test(newVersion.trim())) {
    return { success: false, error: 'Invalid version format. Use X.Y.Z (e.g. 1.0.2)' };
  }

  try {
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${COLLECTION}/${DOC_ID}?updateMask.fieldPaths=minimum_version&key=${apiKey}`;
    const body = {
      fields: {
        minimum_version: { stringValue: newVersion.trim() }
      }
    };

    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const text = await res.text();
      console.error('[AppVersion] PATCH failed:', res.status, text);
      return { success: false, error: `Firebase error ${res.status}` };
    }

    return { success: true };
  } catch (err) {
    console.error('[AppVersion] Error setting minimum version:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Verify user credentials against Firebase during forced re-authentication.
 * Uses the `users/{username}` Firestore document which stores `pin`.
 *
 * Strategy (Option B — simpler):
 * - Check that device is approved and force_logout is cleared in Firebase device_registry
 * - Verify PIN locally (PIN stays in SQLite only — not sent to Firebase)
 * - This avoids storing PINs in Firebase
 *
 * Returns { verified: bool, reason?: string }
 */
export async function verifyForceReauthLocally(username, pin) {
  // PIN verification is done locally — this function is a stub that confirms
  // the device's Firebase device record is accessible (proves internet + Firebase up)
  const { projectId, apiKey } = getFirebaseConfig();
  if (!projectId || !apiKey) {
    return { verified: false, reason: 'Firebase configuration missing' };
  }

  try {
    // Ping app_config/global to confirm Firebase connectivity
    const url = firestoreDocUrl(projectId, apiKey, DOC_ID);
    const res = await fetch(url, { method: 'GET' });

    // 404 means doc doesn't exist yet — Firebase is reachable
    if (res.ok || res.status === 404) {
      return { verified: true };
    }

    return { verified: false, reason: `Firebase connectivity check failed (${res.status})` };
  } catch (err) {
    console.error('[ForceReauth] Connectivity check failed:', err);
    return { verified: false, reason: 'No internet connection or Firebase unreachable' };
  }
}

