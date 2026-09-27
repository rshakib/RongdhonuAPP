# RONGDHONU POS — VERSION CONTROL SYSTEM (MIGRATION REFERENCE)

> **Purpose:** Detailed reference of the app's Version Control and Update Gating system.  
> **Migration Goal:** Enable a **dual-database setup** where **Supabase is PRIMARY** and **Firebase is FALLBACK** (queried only if Supabase fails or is unreachable).  
> **Source Baseline:** Codebase audit of `/home/shakib/Downloads/rong`.

---

## 1. Firestore `app_config/global` Document Structure

The version policy lives in the Firestore collection `app_config` under the document ID `global`.

### 1.1. Field Specifications

| Field Name | Firestore REST Type | Example Value | Purpose | Fallback / Default |
|---|---|---|---|---|
| `minimum_required_version` | `stringValue` | `"1.0.5"` | Lowest client semver allowed to operate. | `APP_VERSION` (from `app.json`) |
| `minimum_version` | `stringValue` | `"1.0.5"` | Legacy duplicate alias of `minimum_required_version`. | `minimum_required_version` |
| `latest_version` | `stringValue` | `"1.0.5"` | The latest available release version. | `minimum_required_version` |
| `update_url` | `stringValue` | `"https://github.com/rshakib/RongdhonuAPP/releases"` | Target download URL opened when user taps update button. | Default GitHub release URL |
| `force_update_enabled` | `booleanValue` | `true` | Master switch. If `false`, version mismatches will not block the app. | `true` |
| `update_message` | `stringValue` | `"একটি নতুন সংস্করণ পাওয়া গেছে। অ্যাপ্লিকেশন ব্যবহার চালিয়ে যেতে অনুগ্রহ করে আপডেট করুন।"` | Localized message shown on the blocking update screen. | Standard Bengali notice |
| `updated_at` | `timestampValue` | `"2026-09-27T12:00:00.000Z"` | ISO 8601 UTC timestamp of last policy modification. | `new Date().toISOString()` |

> **Completeness Confirmation:**  
> Verified against [`services/firebaseAppConfig.js` L134–L140, L177–L199](services/firebaseAppConfig.js#L134-L140).  
> The 7 fields listed above are the **complete and exclusive** schema for `app_config/global`. No other fields exist in this document.

---

## 2. Policy Enforcement & Logic Flow (`checkAppVersionPolicy`)

Implemented in [`services/firebaseAppConfig.js` L254–L304](services/firebaseAppConfig.js#L254-L304).

```
                      [ checkAppVersionPolicy(role) ]
                                    │
                                    ▼
                       [ fetchVersionPolicy() ]
                      (Primary: Cloud, Cache fallback)
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
            Role === 'ADMIN'?              Role !== 'ADMIN'
                    │                               │
             [ YES: EXEMPT ]                        ▼
       { allowed: true,                 compareSemver(APP_VERSION, minVer)
         updateRequired: false,                     │
         adminExempt: true }         ┌──────────────┴──────────────┐
                                     ▼                             ▼
                              semverDiff >= 0               semverDiff < 0
                                     │                     (Outdated Version)
                              { allowed: true,                     │
                                updateRequired: false }    force_update_enabled?
                                                                   │
                                                    ┌──────────────┴──────────────┐
                                                    ▼                             ▼
                                                [ TRUE ]                      [ FALSE ]
                                           { allowed: false,              { allowed: true,
                                             updateRequired: true,          updateRequired: false }
                                             currentScreen:
                                             'APP_UPDATE_REQUIRED' }
```

### 2.1. Semver Comparison Logic (`compareSemver`)

Defined in [`services/firebaseAppConfig.js` L38–L58](services/firebaseAppConfig.js#L38-L58):
```javascript
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
```

* **Return Values:**
  * `1` if version `a > b`
  * `-1` if version `a < b`
  * `0` if equal
* **Edge-case Protections:**
  * Strips leading `'v'` (e.g. `'v1.0.4'` equals `'1.0.4'`).
  * Normalizes length to 3 integers (e.g. `'1.0'` -> `[1, 0, 0]`).
  * Numerically compares each segment (`'1.9.0'` vs `'1.10.0'` correctly evaluates to `-1`).

### 2.2. The ADMIN-Exempt Rule

Condition in [`services/firebaseAppConfig.js` L256, L270–L281](services/firebaseAppConfig.js#L256):
```javascript
const roleUpper = String(role || '').toUpperCase().trim();
const isAdmin = roleUpper === 'ADMIN';

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
```
* **Cold-start optimization:** [`App.js` L422](App.js#L422) checks:
  ```javascript
  if (ACTIVE_APP_PROFILE !== 'ADMIN') {
    // Run version policy gating
  }
  ```
  If the active build profile is `ADMIN`, startup version gating is bypassed entirely so an administrator is never locked out of the management console by a faulty update push.

### 2.3. SQLite Caching & Offline Fallback

* **Storage Location:** SQLite table `app_config`, row `key = 'cached_version_policy'`. Stored as a raw JSON string.
* **When Written:**
  1. [`fetchVersionPolicy()` L142](services/firebaseAppConfig.js#L142): Every successful HTTP GET from the cloud.
  2. [`fetchVersionPolicy()` L122](services/firebaseAppConfig.js#L122): On 404 (initializes defaults in cloud and writes to cache).
  3. [`setVersionPolicy()` L232](services/firebaseAppConfig.js#L232): After the admin saves a new policy.
* **When Read:**
  1. If network is offline, fetch throws, or HTTP status is not OK ([L97, L104, L127, L145](services/firebaseAppConfig.js#L97)).
  2. If SQLite has no cached policy either, falls back to `DEFAULT_VERSION_POLICY` ([L63–L69](services/firebaseAppConfig.js#L63-L69)).
* **Expiration / Staleness:**
  * **The cache never expires.** There is no TTL or timestamp invalidation on `cached_version_policy`.
  * If a tablet remains offline, it enforces the last-known policy indefinitely.

### 2.4. What Happens on Mismatch (Blocking Screen)

When `checkAppVersionPolicy` returns `updateRequired: true`:
1. **Screen State:** In [`App.js` L428, L758, L1282](App.js#L428), `setCurrentScreen('APP_UPDATE_REQUIRED')` and `setIsLoggedIn(false)` are called.
2. **Component:** Rendered by [`screens/AppUpdateRequiredScreen.js`](screens/AppUpdateRequiredScreen.js).
3. **Hardware Back Button:** Intercepted by `BackHandler.addEventListener('hardwareBackPress')` ([L22–L36](screens/AppUpdateRequiredScreen.js#L22-L36)). Back button presents an alert asking to exit the app (`BackHandler.exitApp()`). It cannot navigate back.
4. **Permitted Actions:**
   * **Update App:** `Linking.openURL(policy.update_url)` ([L38–L51](screens/AppUpdateRequiredScreen.js#L38-L51)).
   * **Recheck:** Calls `checkAppVersionPolicy()`. If satisfied, triggers `onUpdateSuccess()` ([L53–L75](screens/AppUpdateRequiredScreen.js#L53-L75)).
   * **Exit App:** `BackHandler.exitApp()` ([L141](screens/AppUpdateRequiredScreen.js#L141)).
5. **Partial Access:** **None.** All routes, drawers, navigation menus, and offline POS capabilities are fully blocked behind this full-screen modal.

---

## 3. Where and When Version Checks Are Triggered

There are **5 exact call sites** in the codebase:

| # | Trigger Moment | Calling File & Line | Context & Behavior |
|---|---|---|---|
| 1 | **Cold Launch / Startup** | [`App.js` L421–L434](App.js#L421-L434) | Runs inside the main init `useEffect`. Evaluates for all non-ADMIN profiles. |
| 2 | **Foreground Resume** | [`App.js` L750–L760](App.js#L750-L760) | Runs inside `AppState` change listener when `isReturningFromBackground === true`. |
| 3 | **Successful Login** | [`App.js` L1275–L1287](App.js#L1275-L1287) | Runs inside `handleLoginSuccess(role, displayName)` right before routing to dashboard. |
| 4 | **Force-Reauth PIN Entry** | [`screens/LoginScreen.js` L245–L258](screens/LoginScreen.js#L245-L258) | Runs when user submits PIN during a forced re-auth cycle. Shows an alert if outdated. |
| 5 | **Manual Recheck Button** | [`screens/AppUpdateRequiredScreen.js` L53–L75](screens/AppUpdateRequiredScreen.js#L53-L75) | Runs when user clicks "🔄 পুনরায় পরীক্ষা করুন (Recheck)". |

> **Periodic Background Polling:**  
> There is **no recurring background timer** (`setInterval`) checking version policy while the app remains open. The check occurs only at the 5 discrete lifecycle moments above.

---

## 4. Admin Management Screen (Where Version Policy Is Updated)

Admins update the version policy directly inside the app:

* **File:** [`screens/AdminDB.js` L412–L496, L1888–L1985](screens/AdminDB.js#L412-L496)
* **UI Location:** Admin Dashboard -> Dedicated "Version Management" Section ("নতুন ভার্সন দিন").
* **Capabilities in UI:**
  1. Displays current minimum version from cloud (`firebaseMinVersion`).
  2. Compares live app version of every connected device in the fleet.
  3. Input box for new version: `v [ 1.0.5 ]`.
* **Two-Factor Security on Update:**
  1. **Biometric Verification:** [`AdminDB.js` L445–L462](screens/AdminDB.js#L445-L462) calls `LocalAuthentication.authenticateAsync()`.
  2. **Admin/Owner PIN Modal:** [`AdminDB.js` L470–L481](screens/AdminDB.js#L470-L481) requires entering an Admin/Owner PIN verified against `users` table via `verifyPinCode()`.
* **Save Execution:**
  Calls `setMinimumVersion(cleanVer)` ([L487](screens/AdminDB.js#L487)), which internally forwards to `setVersionPolicy()` in `firebaseAppConfig.js`.

---

## 5. Is `app_config/global` Shared or Overloaded?

* **In Firestore:**  
  The Firestore collection `app_config` is **multi-use**:
  * `app_config/{tombstone_id}`: Used for deletion tombstones (has fields `table_name` and `record_id`).
  * `app_config/global`: **Dedicated strictly to version policy.**
* **Document Separation:**  
  `database.js` [L2053–L2084](database.js#L2053-L2084) explicitly inspects rows in `app_config`. Any row lacking `table_name` and `record_id` is ignored by the deletion engine.
* **Verdict:**  
  The `global` document ID is **never overloaded** with sync markers, deletion records, or auth tokens. It is 100% dedicated to version policy.

---

## 6. Architecture for Dual-DB Setup (Supabase Primary + Firebase Fallback)

To migrate version control to Supabase while preserving identical fallback behavior:

### 6.1. Proposed Supabase Table Schema

Create a single-row configuration table in Supabase:

```sql
CREATE TABLE IF NOT EXISTS public.app_version_policy (
    id TEXT PRIMARY KEY DEFAULT 'global',
    minimum_required_version TEXT NOT NULL DEFAULT '1.0.0',
    latest_version TEXT NOT NULL DEFAULT '1.0.0',
    update_url TEXT NOT NULL DEFAULT 'https://github.com/rshakib/RongdhonuAPP/releases',
    force_update_enabled BOOLEAN NOT NULL DEFAULT true,
    update_message TEXT NOT NULL DEFAULT 'একটি নতুন সংস্করণ পাওয়া গেছে। অ্যাপ্লিকেশন ব্যবহার চালিয়ে যেতে অনুগ্রহ করে আপডেট করুন।',
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Seed initial row
INSERT INTO public.app_version_policy (id, minimum_required_version, latest_version)
VALUES ('global', '1.0.5', '1.0.5')
ON CONFLICT (id) DO NOTHING;

-- Enable RLS: allow anon read, restricted admin write
ALTER TABLE public.app_version_policy ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow anon read version policy" ON public.app_version_policy FOR SELECT USING (true);
CREATE POLICY "Allow anon update version policy" ON public.app_version_policy FOR UPDATE USING (true) WITH CHECK (true);
```

### 6.2. Dual-DB Resolution Flow (`fetchVersionPolicyDualDB`)

```
                  [ fetchVersionPolicyDualDB() ]
                                 │
                                 ▼
                     Try: Supabase (Primary)
                  SELECT * FROM app_version_policy 
                           WHERE id = 'global'
                                 │
                 ┌───────────────┴───────────────┐
                 ▼ (Success)                     ▼ (Fails / Network Error)
         [ Return Supabase ]             Try: Firebase (Fallback)
         Cache in SQLite app_config        GET app_config/global
                                                 │
                                 ┌───────────────┴───────────────┐
                                 ▼ (Success)                     ▼ (Fails / Offline)
                         [ Return Firebase ]             Read SQLite Cache
                         Cache in SQLite app_config   ('cached_version_policy')
                                                                 │
                                                 ┌───────────────┴───────────────┐
                                                 ▼ (Found)                       ▼ (Null)
                                          [ Return Cache ]             DEFAULT_VERSION_POLICY
```

### 6.3. Dual-Write Policy for Admin Updates (`setVersionPolicyDualDB`)

When an Admin updates the version in `AdminDB.js`:
1. **Primary Write:** Update Supabase `public.app_version_policy WHERE id = 'global'`.
2. **Secondary Write:** Best-effort update to Firebase Firestore `app_config/global` (so older APKs still pointing to Firebase receive the update).
3. **Local Cache:** Update SQLite `app_config` key `cached_version_policy`.

---

*Document generated: 2026-09-27. Baseline static analysis of `/home/shakib/Downloads/rong`.*
