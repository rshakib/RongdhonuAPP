/**
 * firebaseAppConfig.js
 * Firebase App Config Service — Version gating + Force Reauth verification
 * Uses Firestore REST API (same pattern as database.js)
 */

let appVersion = '1.0.4';
try {
  const appJson = require('../app.json');
  appVersion = appJson.expo?.version || '1.0.4';
} catch (e) {}

export const APP_VERSION = appVersion;

import { getFirestoreAuthHeaders, invalidateCurrentToken } from './firebaseAuth.js';
import {
  getSupabaseClient,
  isSupabaseConfigured,
  isSupabaseSyncEnabled,
  withTimeout
} from './supabaseClient.js';

const COLLECTION = 'app_config';
const DOC_ID = 'global';

function getFirebaseConfig() {
  const projectId = (process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || '').trim().replace(/[\r\n\0]/g, '');
  const apiKey = (process.env.EXPO_PUBLIC_FIREBASE_API_KEY || '').trim().replace(/[\r\n\0]/g, '');
  return { projectId, apiKey };
}

function firestoreDocUrl(projectId, apiKey, docId) {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${COLLECTION}/${encodeURIComponent(docId)}?key=${apiKey}`;
}

/**
 * Compare semver strings numerically. Returns:
 *  1 if a > b,  -1 if a < b,  0 if equal
 * Correctly handles:
 *  compareSemver('1.9.0', '1.10.0') === -1
 *  compareSemver('1.10.0', '1.9.0') === 1
 *  compareSemver('v1.0.4', '1.0.4') === 0
 */
export function compareSemver(a, b) {
  const parse = (v) => {
    if (!v) return [0, 0, 0];
    const clean = String(v).trim().replace(/^v/i, '');
    const parts = clean.split('.').map((p) => {
      const n = parseInt(p, 10);
      return isNaN(n) ? 0 : n;
    });
    while (parts.length < 3) parts.push(0);
    return parts.slice(0, 3);
  };

  const pa = parse(a);
  const pb = parse(b);

  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

/**
 * Default fallback version policy
 */
export const DEFAULT_VERSION_POLICY = {
  minimum_required_version: APP_VERSION,
  latest_version: APP_VERSION,
  update_url: 'https://github.com/rshakib/RongdhonuAPP/releases',
  force_update_enabled: true,
  update_message: 'একটি নতুন সংস্করণ পাওয়া গেছে। অ্যাপ্লিকেশন ব্যবহার চালিয়ে যেতে অনুগ্রহ করে আপডেট করুন।'
};

/**
 * Helper to get/set local cached version policy from SQLite
 */
function getCachedVersionPolicy() {
  try {
    const { getAppConfig } = require('../database');
    const raw = getAppConfig('cached_version_policy');
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return null;
}

function setCachedVersionPolicy(policy) {
  try {
    const { setAppConfig } = require('../database');
    setAppConfig('cached_version_policy', JSON.stringify(policy));
  } catch (e) {}
}

// ---------------------------------------------------------------------------
// Phase 6 — Dual-DB version policy (Supabase primary, Firebase fallback).
// ---------------------------------------------------------------------------
// Supabase per-read/write timeout (3–4s per IMPLEMENTATION_PLAN.md §6.2).
const VERSION_TIMEOUT_MS = (() => {
  const n = Number(process.env.EXPO_PUBLIC_SUPABASE_VERSION_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 3500;
})();

// Dependency seams (production defaults; overridable in unit tests).
const productionVersionDeps = {
  isEnabled: () => isSupabaseSyncEnabled(),
  isConfigured: () => isSupabaseConfigured(),
  getClient: () => getSupabaseClient(),
  fetchFirebase: () => fetchVersionPolicy(),
  writeFirebase: (policy) => setVersionPolicy(policy),
  readCache: () => getCachedVersionPolicy(),
  writeCache: (policy) => setCachedVersionPolicy(policy)
};
let versionDeps = { ...productionVersionDeps };

export function __setVersionPolicyDepsForTesting(overrides = {}) {
  versionDeps = { ...versionDeps, ...overrides };
}
export function __resetVersionPolicyDepsForTesting() {
  versionDeps = { ...productionVersionDeps };
}

/** Map a Supabase `app_version_policy` row to the canonical policy shape. */
export function mapSupabasePolicyRow(row = {}) {
  return {
    minimum_required_version: String(row.minimum_required_version || row.minimum_version || APP_VERSION).trim(),
    latest_version: String(row.latest_version || row.minimum_required_version || APP_VERSION).trim(),
    update_url: String(row.update_url || DEFAULT_VERSION_POLICY.update_url).trim(),
    force_update_enabled: row.force_update_enabled === undefined || row.force_update_enabled === null
      ? true
      : row.force_update_enabled !== false,
    update_message: row.update_message || DEFAULT_VERSION_POLICY.update_message
  };
}

/** Normalize an arbitrary new-policy object into the canonical policy shape. */
function normalizePolicy(newPolicy = {}) {
  const minVer = String(newPolicy.minimum_required_version || newPolicy.minimumVersion || '').trim();
  return {
    minimum_required_version: minVer,
    latest_version: String(newPolicy.latest_version || minVer).trim(),
    update_url: String(newPolicy.update_url || DEFAULT_VERSION_POLICY.update_url).trim(),
    force_update_enabled: newPolicy.force_update_enabled !== false,
    update_message: String(newPolicy.update_message || DEFAULT_VERSION_POLICY.update_message).trim()
  };
}

/**
 * Phase 6 read path: Supabase `app_version_policy` first (bounded timeout) →
 * EXISTING `fetchVersionPolicy()` (Firebase, unchanged) → SQLite cache →
 * DEFAULT_VERSION_POLICY. On Supabase success the policy is written to the
 * SQLite cache so offline enforcement stays warm.
 *
 * Never throws. Returns { success, policy, error?, source? } — the same
 * `{ success, policy, error? }` contract the existing fetch returns.
 */
export async function fetchVersionPolicyDualDB() {
  if (versionDeps.isEnabled() && versionDeps.isConfigured()) {
    try {
      const client = versionDeps.getClient();
      if (client) {
        const { data, error } = await withTimeout(
          client.from('app_version_policy').select('*').eq('id', 'global').maybeSingle(),
          VERSION_TIMEOUT_MS,
          'fetch app_version_policy'
        );
        if (!error && data) {
          const policy = mapSupabasePolicyRow(data);
          try { versionDeps.writeCache(policy); } catch (_) {}
          return { success: true, policy, source: 'supabase' };
        }
      }
    } catch (err) {
      console.warn('[AppVersion] Supabase version policy read failed → Firebase fallback:', err?.message || err);
    }
  }
  // Fallback chain (all inside the untouched existing fetcher):
  // Firebase → SQLite cache → DEFAULT_VERSION_POLICY.
  const fallback = await versionDeps.fetchFirebase();
  return { ...fallback, source: fallback?.success ? 'firebase' : (fallback?.source || 'fallback') };
}

/**
 * Phase 6 write path (sequential — rare admin action): Supabase first → then
 * BEST-EFFORT Firebase `setVersionPolicy()` (guaranteed fallback for older
 * APKs) → SQLite cache. Returns { success, error? }; success when at least one
 * cloud write landed. Never throws.
 */
export async function setVersionPolicyDualDB(newPolicy) {
  const policy = normalizePolicy(newPolicy);
  if (!policy.minimum_required_version || !/^\d+(\.\d+)+$/.test(policy.minimum_required_version.replace(/^v/i, ''))) {
    return { success: false, error: 'Invalid minimum version format. Use X.Y.Z (e.g. 1.0.4)' };
  }

  let supabaseResult = { success: false, error: 'Supabase not configured' };

  // 1) Supabase first (sequential, not parallel).
  if (versionDeps.isEnabled() && versionDeps.isConfigured()) {
    try {
      const client = versionDeps.getClient();
      if (client) {
        const { error } = await withTimeout(
          client.from('app_version_policy').upsert(
            {
              id: 'global',
              ...policy,
              minimum_version: policy.minimum_required_version, // legacy alias (mirrors Firestore)
              updated_at: new Date().toISOString()
            },
            { onConflict: 'id' }
          ),
          VERSION_TIMEOUT_MS,
          'upsert app_version_policy'
        );
        supabaseResult = error ? { success: false, error: error.message } : { success: true };
      }
    } catch (err) {
      supabaseResult = { success: false, error: err?.message || String(err) };
    }
  }

  // 2) Firebase best-effort (kept as the guaranteed fallback path).
  let firebaseResult = { success: false, error: 'Firebase not attempted' };
  try {
    firebaseResult = await versionDeps.writeFirebase(policy);
  } catch (err) {
    firebaseResult = { success: false, error: err?.message || String(err) };
  }

  // 3) Local SQLite cache (covers offline enforcement).
  if (supabaseResult.success || firebaseResult.success) {
    try { versionDeps.writeCache(policy); } catch (_) {}
    return { success: true };
  }

  return {
    success: false,
    error: firebaseResult.error || supabaseResult.error || 'Version policy update failed'
  };
}

/**
 * Phase 6 admin helper: set the minimum + latest version via the dual writer.
 * Mirrors the legacy `setMinimumVersion` but reads/writes through the dual-DB
 * layers. Public shape { success, error? } (unchanged for AdminDB).
 */
export async function setMinimumVersionDualDB(newVersion) {
  const current = (await fetchVersionPolicyDualDB()).policy || DEFAULT_VERSION_POLICY;
  return await setVersionPolicyDualDB({
    ...current,
    minimum_required_version: newVersion,
    latest_version: newVersion
  });
}

/**
 * Fetch the complete version policy from Firebase app_config/global.
 * Returns { success: boolean, policy: object, error?: string }
 */
export async function fetchVersionPolicy() {
  const { projectId, apiKey } = getFirebaseConfig();
  if (!projectId || !apiKey) {
    const cached = getCachedVersionPolicy() || DEFAULT_VERSION_POLICY;
    return { success: false, policy: cached, error: 'Firebase config missing' };
  }

  try {
    const auth = await getFirestoreAuthHeaders();
    if (!auth.success) {
      const cached = getCachedVersionPolicy() || DEFAULT_VERSION_POLICY;
      return { success: false, policy: cached, error: `Auth unavailable: ${auth.error}` };
    }

    const url = firestoreDocUrl(projectId, apiKey, DOC_ID);
    let res = await fetch(url, { method: 'GET', headers: { ...auth.headers } });

    if (res.status === 401) {
      invalidateCurrentToken();
      const retryAuth = await getFirestoreAuthHeaders();
      if (retryAuth.success) {
        res = await fetch(url, { method: 'GET', headers: { ...retryAuth.headers } });
      }
    }

    if (res.status === 404) {
      // Auto-initialize with default policy if doc doesn't exist
      await setVersionPolicy(DEFAULT_VERSION_POLICY);
      setCachedVersionPolicy(DEFAULT_VERSION_POLICY);
      return { success: true, policy: DEFAULT_VERSION_POLICY };
    }

    if (!res.ok) {
      const cached = getCachedVersionPolicy() || DEFAULT_VERSION_POLICY;
      return { success: false, policy: cached, error: `HTTP ${res.status}` };
    }

    const data = await res.json();
    const fields = data.fields || {};

    const policy = {
      minimum_required_version: (fields.minimum_required_version?.stringValue || fields.minimum_version?.stringValue || APP_VERSION).trim(),
      latest_version: (fields.latest_version?.stringValue || fields.minimum_required_version?.stringValue || APP_VERSION).trim(),
      update_url: (fields.update_url?.stringValue || DEFAULT_VERSION_POLICY.update_url).trim(),
      force_update_enabled: fields.force_update_enabled?.booleanValue !== undefined ? fields.force_update_enabled.booleanValue : true,
      update_message: fields.update_message?.stringValue || DEFAULT_VERSION_POLICY.update_message
    };

    setCachedVersionPolicy(policy);
    return { success: true, policy };
  } catch (err) {
    const cached = getCachedVersionPolicy() || DEFAULT_VERSION_POLICY;
    return { success: false, policy: cached, error: err.message };
  }
}

/**
 * Update complete version policy in Firebase Firestore (Admin only).
 * Validates version format and URL.
 * Returns { success: boolean, error?: string }
 */
export async function setVersionPolicy(newPolicy) {
  const { projectId, apiKey } = getFirebaseConfig();
  if (!projectId || !apiKey) {
    return { success: false, error: 'Firebase config not available' };
  }

  const minVer = String(newPolicy.minimum_required_version || newPolicy.minimumVersion || '').trim();
  if (!minVer || !/^\d+(\.\d+)+$/.test(minVer.replace(/^v/i, ''))) {
    return { success: false, error: 'Invalid minimum version format. Use X.Y.Z (e.g. 1.0.4)' };
  }

  const latestVer = String(newPolicy.latest_version || minVer).trim();
  const updateUrl = String(newPolicy.update_url || DEFAULT_VERSION_POLICY.update_url).trim();
  const forceUpdateEnabled = newPolicy.force_update_enabled !== false;
  const updateMessage = String(newPolicy.update_message || DEFAULT_VERSION_POLICY.update_message).trim();

  try {
    const auth = await getFirestoreAuthHeaders();
    if (!auth.success) {
      return { success: false, error: `Auth unavailable: ${auth.error}` };
    }

    const fieldPaths = [
      'minimum_required_version',
      'minimum_version',
      'latest_version',
      'update_url',
      'force_update_enabled',
      'update_message',
      'updated_at'
    ];
    const updateMask = fieldPaths.map((f) => `updateMask.fieldPaths=${f}`).join('&');
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${COLLECTION}/${DOC_ID}?${updateMask}&key=${apiKey}`;

    const body = {
      fields: {
        minimum_required_version: { stringValue: minVer },
        minimum_version: { stringValue: minVer }, // Backward compatibility
        latest_version: { stringValue: latestVer },
        update_url: { stringValue: updateUrl },
        force_update_enabled: { booleanValue: forceUpdateEnabled },
        update_message: { stringValue: updateMessage },
        updated_at: { timestampValue: new Date().toISOString() }
      }
    };

    let res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth.headers },
      body: JSON.stringify(body)
    });

    if (res.status === 401) {
      invalidateCurrentToken();
      const retryAuth = await getFirestoreAuthHeaders();
      if (retryAuth.success) {
        res = await fetch(url, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...retryAuth.headers },
          body: JSON.stringify(body)
        });
      }
    }

    if (!res.ok) {
      const text = await res.text();
      console.error('[AppVersion] PATCH failed:', res.status, text);
      return { success: false, error: `Firebase error ${res.status}` };
    }

    const savedPolicy = {
      minimum_required_version: minVer,
      latest_version: latestVer,
      update_url: updateUrl,
      force_update_enabled: forceUpdateEnabled,
      update_message: updateMessage
    };
    setCachedVersionPolicy(savedPolicy);

    return { success: true };
  } catch (err) {
    console.error('[AppVersion] Error setting version policy:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Check version policy on cold launch and foreground resume.
 *
 * Rules:
 * - Checks installed APP_VERSION against minimum_required_version.
 * - Uses semantic comparison: compareSemver(APP_VERSION, minimum_required_version).
 * - If force_update_enabled is true and APP_VERSION < minimum_required_version:
 *   returns { allowed: false, updateRequired: true, policy, currentVersion: APP_VERSION }
 * - If offline: uses cached policy if available.
 *
 * @param {string} [role='']
 * @returns {Promise<{ allowed: boolean, updateRequired: boolean, policy: object, currentVersion: string, offline: boolean, error: string|null }>}
 */
export async function checkAppVersionPolicy(role = '') {
  const roleUpper = String(role || '').toUpperCase().trim();
  const isAdmin = roleUpper === 'ADMIN';

  // Phase 6: Supabase-primary read with the existing Firebase path as the
  // unchanged fallback. Public contract of this function is unchanged.
  const fetchRes = await fetchVersionPolicyDualDB();
  const policy = fetchRes.policy || DEFAULT_VERSION_POLICY;
  const isOffline = !fetchRes.success;

  const minVer = policy.minimum_required_version || APP_VERSION;
  const isForceEnabled = policy.force_update_enabled !== false;

  // Semver check: returns -1 if APP_VERSION < minVer
  const semverDiff = compareSemver(APP_VERSION, minVer);
  const isOutdated = semverDiff < 0;

  // ADMIN role is strictly exempt from mandatory version update gating
  if (isAdmin) {
    return {
      allowed: true,
      updateRequired: false,
      policy,
      currentVersion: APP_VERSION,
      minimumVersion: minVer,
      offline: isOffline,
      error: null,
      adminExempt: true
    };
  }

  if (isForceEnabled && isOutdated) {
    return {
      allowed: false,
      updateRequired: true,
      policy,
      currentVersion: APP_VERSION,
      minimumVersion: minVer,
      offline: isOffline,
      error: isOffline ? 'Version policy check offline (cached enforcement)' : null
    };
  }

  return {
    allowed: true,
    updateRequired: false,
    policy,
    currentVersion: APP_VERSION,
    minimumVersion: minVer,
    offline: isOffline,
    error: fetchRes.error || null
  };
}

/**
 * Backward compatibility: legacy checkAppVersion(role)
 */
export async function checkAppVersion(role = '') {
  const result = await checkAppVersionPolicy(role);
  return {
    allowed: result.allowed,
    minimumVersion: result.minimumVersion,
    currentVersion: result.currentVersion
  };
}

/**
 * Backward compatibility: legacy fetchMinimumVersion()
 */
export async function fetchMinimumVersion() {
  const res = await fetchVersionPolicy();
  return res.policy?.minimum_required_version || APP_VERSION;
}

/**
 * Backward compatibility: legacy setMinimumVersion(newVersion)
 */
export async function setMinimumVersion(newVersion) {
  const current = (await fetchVersionPolicy()).policy || DEFAULT_VERSION_POLICY;
  return await setVersionPolicy({
    ...current,
    minimum_required_version: newVersion,
    latest_version: newVersion
  });
}

/**
 * Cloud-reachability check used by the login gate (new install / first login /
 * force-reauth). Historically this was a Firebase-only GET — which meant an
 * exhausted Firebase read quota (HTTP 429) BLOCKED LOGIN even with Supabase healthy.
 *
 * Now it follows the migration's read-routing rule:
 *   1) Supabase first (primary read path). `app_version_policy` is public-read, so
 *      this works BEFORE device registration. No Firebase read when Supabase answers.
 *   2) Firebase fallback — and a throttling/limit status (429/403) now counts as
 *      REACHABLE (quota ≠ offline); only a genuine network failure blocks login.
 */
export async function verifyForceReauthLocally(username, pin) {
  // --- 1) Supabase (primary) -------------------------------------------------
  if (versionDeps.isEnabled() && versionDeps.isConfigured()) {
    try {
      const client = versionDeps.getClient();
      if (client) {
        const { error } = await withTimeout(
          client.from('app_version_policy').select('id').eq('id', 'global').maybeSingle(),
          VERSION_TIMEOUT_MS,
          'login connectivity (supabase)'
        );
        if (!error) return { verified: true, source: 'supabase' };
      }
    } catch (err) {
      console.warn('[Login Connect] Supabase check failed → Firebase fallback:', err?.message || err);
    }
  }

  // --- 2) Firebase fallback (unchanged behavior, plus throttling tolerance) ---
  const { projectId, apiKey } = getFirebaseConfig();
  if (!projectId || !apiKey) {
    return { verified: false, reason: 'Firebase configuration missing' };
  }

  try {
    const auth = await getFirestoreAuthHeaders();
    if (!auth.success) {
      return { verified: false, reason: `Firebase authentication unavailable (${auth.error})` };
    }

    const url = firestoreDocUrl(projectId, apiKey, DOC_ID);
    let res = await fetch(url, { method: 'GET', headers: { ...auth.headers } });

    if (res.status === 401) {
      invalidateCurrentToken();
      const retryAuth = await getFirestoreAuthHeaders();
      if (retryAuth.success) {
        res = await fetch(url, { method: 'GET', headers: { ...retryAuth.headers } });
      }
    }

    // 429 (quota/rate limit) and 403 (permission/limit) mean the backend IS reachable.
    if (res.ok || res.status === 404) return { verified: true, source: 'firebase' };
    if (res.status === 429 || res.status === 403) {
      return { verified: true, source: 'firebase', throttled: true, status: res.status };
    }

    return { verified: false, reason: `Firebase connectivity check failed (${res.status})` };
  } catch (err) {
    console.error('[ForceReauth] Connectivity check failed:', err);
    return { verified: false, reason: 'No internet connection or Firebase unreachable' };
  }
}
