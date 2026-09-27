# RONGDHONU POS — MASTER PROJECT DOCUMENTATION

> **Purpose:** Single source of truth for understanding the entire project — architecture, Firebase, Supabase, every service, every method, screens, build system, and tests.
> **Generated:** 2026-09-27 · Branch: `feature/admin-dashboard-redesign`
> This file is written so that any developer (or AI agent) can read it and immediately understand how the whole system works.

---

## TABLE OF CONTENTS

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Directory Structure](#3-directory-structure)
4. [The 3 Apps — Profile System & Roles](#4-the-3-apps--profile-system--roles)
5. [Environment Variables](#5-environment-variables)
6. [Entry Points & Navigation Architecture](#6-entry-points--navigation-architecture)
7. **FIREBASE (Firestore REST + Anonymous Auth)**
   - 7.1 [Firebase Overview](#71-firebase-overview)
   - 7.2 [services/firebaseAuth.js — Full Method Reference](#72-servicesfirebaseauthjs--full-method-reference)
   - 7.3 [services/firebaseAppConfig.js — Full Method Reference](#73-servicesfirebaseappconfigjs--full-method-reference)
   - 7.4 [Firestore REST Transport in database.js](#74-firestore-rest-transport-in-databasejs)
   - 7.5 [Firestore Collections ↔ SQLite Tables](#75-firestore-collections--sqlite-tables)
8. **SUPABASE (Device Control + Realtime)**
   - 8.1 [Supabase Overview](#81-supabase-overview)
   - 8.2 [services/supabaseClient.js — Full Method Reference](#82-servicessupabaseclientjs--full-method-reference)
   - 8.3 [services/supabaseDeviceControl.js — Full Method Reference](#83-servicessupabasedevicecontroljs--full-method-reference)
   - 8.4 [Supabase Schema (devices, device_app_usage)](#84-supabase-schema)
   - 8.5 [RLS Policies & Production RPC Migration Plan](#85-rls-policies--production-rpc-migration-plan)
   - 8.6 [services/deviceRegistry.js — Full Method Reference](#86-servicesdeviceregistryjs--full-method-reference)
   - 8.7 [services/appUsageTracker.js — Full Method Reference](#87-servicesappusagetrackerjs--full-method-reference)
   - 8.8 [Device Lifecycle & Force Logout Flows](#88-device-lifecycle--force-logout-flows)
9. [Data Layer — SQLite Schema & Sync Engine](#9-data-layer--sqlite-schema--sync-engine)
10. [database.js — Complete Method Reference](#10-databasejs--complete-method-reference)
11. [Other Services (activityLogger, analytics, backupRestore, printerService, aiDataset)](#11-other-services)
12. [Screens Inventory (39 files)](#12-screens-inventory)
13. [Components Inventory (13 files)](#13-components-inventory)
14. [Printer Subsystem](#14-printer-subsystem)
15. [AI Dataset Subsystem](#15-ai-dataset-subsystem)
16. [Scripts (credential selector, Apps Script, audits)](#16-scripts)
17. [Build Configuration & Credentials](#17-build-configuration--credentials)
18. [Tests Inventory (45 files)](#18-tests-inventory)
19. [Key Flows End-to-End](#19-key-flows-end-to-end)
20. [Error Handling, Timeouts & Retries](#20-error-handling-timeouts--retries)
21. [Critical Rules & Gotchas](#21-critical-rules--gotchas)

---

## 1. PROJECT OVERVIEW

**Rongdhonu Café & Restaurant POS** — a complete, offline-first restaurant management system built with React Native + Expo. It runs as **three separate Android APKs** generated from **one codebase**: Admin, Owner, and Manager.

Core capabilities:
- Table-based order tracking + delivery orders
- Multi-payment-method billing (Cash, bKash, Nagad, Rocket, Split)
- Daily expense tracking, daily EOD submission with locking
- Owner finance: salaries/employees, owner expenses, deposits, home deposits
- Business analytics (day/week/month comparison, weather impact, top items)
- Thermal 58 mm Bluetooth receipt printing
- **Device access control** (approve/block/lock/force-logout) via Supabase
- **Cloud sync** of POS data to Firebase Firestore (offline-first)
- Mandatory app version gating via Firebase
- AI dataset export pipeline to Google Sheets

**Dual cloud backends (strictly separated):**

| Backend | Owns | Never touches |
|---|---|---|
| **Firebase Firestore (REST)** | ALL POS data — orders, menu, tables, payments, expenses, daily_submit, users, activity_logs, app version policy | Device control |
| **Supabase (PostgREST + Realtime)** | Device control only — `devices`, `device_app_usage`, presence, remote commands | POS/order data |

---

## 2. TECH STACK

| Layer | Technology |
|---|---|
| Framework | React Native 0.85.3 + Expo SDK 56 |
| Language | JavaScript |
| Local DB | SQLite via `expo-sqlite` (synchronous API) — `rongdhonu.db` |
| Cloud (POS) | Google **Firebase Firestore REST API v1** (no Firebase SDK) |
| Cloud (Device) | **Supabase** (`@supabase/supabase-js` v2) |
| Auth (cloud) | Firebase Anonymous Auth via REST (Identity Toolkit + Secure Token) |
| App login | PIN-based against local SQLite `users` table |
| Printing | `react-native-thermal-printer-driver` (native) + Web Bluetooth fallback |
| PDF | `expo-print` / `pdfHelper.js` |
| Icons | `lucide-react-native` + `react-native-svg` |
| State | React Hooks (no Redux / no navigation library) |
| Build | EAS Build (`eas.json`, profiles admin/owner/manager/production) |

---

## 3. DIRECTORY STRUCTURE

```
rong/
├── App.js                      # Root component: custom string router + all app state (3596 lines)
├── index.js                    # registerRootComponent(App)
├── database.js                 # SQLite + Firestore sync engine + ALL POS data functions (7128 lines)
├── app.config.js               # Dynamic Expo config per build profile (admin/owner/manager)
├── app.json                    # Static Expo config (version 1.0.7)
├── eas.json                    # EAS build profiles + env vars
├── supabase_full_setup.sql     # Supabase schema: devices, telemetry, POS tables, version policy (single source of truth)
├── pdfHelper.js                # PDF generation for reports
├── printer-test.js             # Standalone printer test harness
├── credentials.json / *.example.json / credentials/  # Android signing creds (per profile)
├── .env / example.env          # Firebase + Supabase + Apps Script URLs
│
├── services/
│   ├── supabaseClient.js            # Supabase client init + safeSupabaseCall
│   ├── supabaseDeviceControl.js     # Device control (upsert/fetch/presence/realtime cmds)
│   ├── deviceRegistry.js            # Device access control layer (local SQLite mirror)
│   ├── appUsageTracker.js           # Day-wise app usage tracking (Supabase)
│   ├── firebaseAuth.js              # Firebase anonymous auth token engine
│   ├── firebaseAppConfig.js         # Version policy + force reauth
│   ├── activityLogger.js            # Audit trail logger
│   ├── analyticsService.js          # Period analytics queries
│   ├── analyticsHelper.js           # Comparison/insight helpers
│   ├── backupRestore.js             # SQLite .db backup/restore
│   ├── printerService.js            # Dual-transport printer service (native + Web Bluetooth)
│   ├── aiDataset/                   # AI dataset builder/mapper/schema/validator/preview + transport
│   │   ├── builder.js  mapper.js  schema.js  validator.js  preview.js
│   │   └── transport/googleSheets.js
│   └── printer/                     # Printer manager (framework-agnostic)
│       ├── index.js  printerManager.js  printerTransport.js  printerSettings.js
│       ├── printerDiagnostic.js  printerButtonStates.js  receiptData.js
│
├── screens/ (39 files)         # All UI screens (see §12)
├── components/ (13 files)      # Shared UI components (see §13)
├── scripts/ (6 files)          # Build/audit/Apps Script utilities (see §16)
├── tests/ (45 files)           # Node-based test suite (see §18)
├── docs/ (5 files)             # Signing + feature inventory docs
├── android/                    # Expo prebuild native project
├── assets/  image/             # Icons, splash, logo
└── *.md                        # Architecture/notes docs (see below)
```

**Root markdown docs already present:**
- `ARCHITECTURE_CURRENT_STATE.md` — code-accurate architecture baseline (Firebase + Supabase)
- `ARCHITECTURE_QUERY_PATTERNS.md` — query pattern reference
- `AI_DATASET_E2E_REPORT.md` — AI dataset end-to-end report
- `RLS_IMPLEMENTATION_PLAN.md` — Supabase RLS tightening plan
- `DATE_FIELD_ANALYSIS.md` — date field usage analysis
- `BACKUP_NOTES.md` / `VERSION_CONTROL_MIGRATION_NOTES.md` — backup & version notes
- `CHANGELOG.md`, `README.md`, `LICENSE`

---

## 4. THE 3 APPS — PROFILE SYSTEM & ROLES

**One codebase → three APKs.** The profile is a **build-time constant** `EXPO_PUBLIC_APP_PROFILE`, set in `app.config.js` and injected via `eas.json`. It **cannot change at runtime**.

| Profile | App Name | Android Package | APK | Channel |
|---|---|---|---|---|
| `ADMIN` | রংধনু এডমিন | `com.riajulshakib.rongdhonu` | `Admin.apk` | admin |
| `OWNER` | রংধনু ওনার | `com.riajulshakib.rongdhonu.owner` | `owner.apk` | owner |
| `MANAGER` | রংধনু ম্যানেজার | `com.riajulshakib.rongdhonu.manager` | `manager.apk` | manager |

**Two independent identity layers:**
1. **Build profile** — `ACTIVE_APP_PROFILE` (compile-time, from `database.js`) → `'ADMIN' | 'OWNER' | 'MANAGER'`.
2. **Runtime user role** — `userRole` React state, from `verifyUserLogin(username, pin)` → `'admin' | 'owner' | 'manager'`.
   - Manager APK rejects non-manager usernames at login.

**Dashboard routing (App.js `renderScreen()` `case 'DASHBOARD'`):**
- `ACTIVE_APP_PROFILE === 'ADMIN'`: role `admin` → `AdminDB`; role `owner` → `OwnerDashboard`; else → `ManagerDashboard`
- `ACTIVE_APP_PROFILE === 'OWNER'` → `OwnerDashboard`
- otherwise (`MANAGER`) → `ManagerDashboard`

**Per-profile sync differences (`APP_PROFILES` in `database.js`):**

| Feature | ADMIN | OWNER | MANAGER |
|---|---|---|---|
| High-freq pull | orders, order_items, payments, deliveries | Same | Same |
| Low-freq pull | Full set (all tables) | Full set | Reduced (no `owner_*`, `off_days`, `weather_data`, `due_payments`) |
| Device fleet fetch | Full fleet (`fetchSupabaseDevices`) | Blocked | Single-device self-check only |
| Device Control screen | ✅ | ❌ | ❌ |
| Version gate | Exempt (always allowed) | Enforced | Enforced |

---

## 5. ENVIRONMENT VARIABLES

All are `EXPO_PUBLIC_*` (bundled into the app — these are public identifiers, not server secrets). Read via `process.env`, sanitized by `cleanEnvVar()` / `getFirebaseAuthConfig()`.

| Variable | Purpose |
|---|---|
| `EXPO_PUBLIC_APP_PROFILE` | `ADMIN` / `OWNER` / `MANAGER` (build-time) |
| `EXPO_PUBLIC_FIREBASE_API_KEY` | Firebase Web API key (Firestore REST + auth) |
| `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN` | e.g. `rongdhonu-83b3d.firebaseapp.com` |
| `EXPO_PUBLIC_FIREBASE_PROJECT_ID` | e.g. `rongdhonu-83b3d` |
| `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET` | `rongdhonu-83b3d.firebasestorage.app` |
| `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | `931678906315` |
| `EXPO_PUBLIC_FIREBASE_APP_ID` | `1:931678906315:web:...` |
| `EXPO_PUBLIC_SUPABASE_URL` | `https://gdqnfwccohxgaywzoysc.supabase.co` |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon JWT |
| `EXPO_PUBLIC_WEATHER_WEBAPP_URL` | Google Apps Script weather endpoint |
| `EXPO_PUBLIC_GOOGLE_SHEETS_WEBAPP_URL` | Google Apps Script dataset endpoint |
| `EXPO_PUBLIC_AI_DATASET_WEBAPP_URL` | AI dataset transport endpoint |
| `EXPO_PUBLIC_AI_DATASET_ENABLED` | `'true'` / `'false'` feature flag |

---

## 6. ENTRY POINTS & NAVIGATION ARCHITECTURE

- `index.js` → `registerRootComponent(App)`.
- `App.js` — **no navigation library**. It uses a single `currentScreen` string state and a giant `renderScreen()` `switch`. Screens receive `onBack` and `onNavigateToX()` callbacks that call `setCurrentScreen(...)`.
- Global overlays always mounted: `AutoReceiptPrinter` (silent printing), offline block modal, mandatory previous-day-submit modal, toast, restore overlay.

**`renderScreen()` cases (App.js):**
`DASHBOARD`, `TABLE_DETAIL`, `ADD_ITEM`, `EDIT_MENU`, `PAYMENT_CHECKOUT`, `PAYMENT_SUCCESS`, `DAILY_SUBMIT`, `EXPENSES`, `SUPPLIER_DUE`, `ITEM_SALES_REPORT`, `ADMIN_ANALYTICS`, `SYNC_DIAGNOSTICS`, `DELETE_HISTORY`, `AI_DATASET_MONITOR`, `AI_DATASET_AUDIT_CENTER`, `DEVICE_MANAGEMENT`, `BACKUP_RESTORE`, `SYSTEM_TOOLS`, `PRINTER_SETTINGS`, `DB_HEALTH`, `SYNC_STATUS`, `DB_STATS`, `SYSTEM_INFO`, `DB_EXPLORER`, `TABLE_VIEWER`, `ROW_DETAIL`, `OWNER_FINANCE_DASHBOARD`, `OWNER_EXPENSE`, `EMPLOYEE_LIST`, `ADD_EMPLOYEE`, `EMPLOYEE_DETAIL`, `ADD_SALARY_PAYMENT`, `ACTIVITY_LOG`. Pre-login gates: `APP_UPDATE_REQUIRED`, `OFFLINE_VERIFICATION`, `INITIAL_DATA_FAILED`, `DEVICE_BLOCKED`, `DEVICE_PENDING`, `LOGIN`.

**Back navigation:** `BackHandler` — a hardcoded `subScreens` list bounces to `DASHBOARD`; on `DASHBOARD`/logged-out it prompts exit.

**Order/billing chain:** `DASHBOARD → (onTableSelect) TABLE_DETAIL → (onNavigateToAddItem) ADD_ITEM → TABLE_DETAIL → (onPaymentDone) PAYMENT_CHECKOUT → (onCompletePayment) PAYMENT_SUCCESS → (onReturnHome) DASHBOARD`.

**App.js consumes from `database.js` (import list):** `db, enqueueSync, calculateAndSaveDailySummary, initDatabase, getMenuItems, addMenuItem, updateMenuPrice, deleteMenuItem, getTables, updateTableState, updateTableName, getDeliveries, createDelivery, updateDeliveryState, removeDelivery, updateDeliveryDetails, completeDelivery, getDeliveryById, getCompletedOrders, addCompletedOrder, deleteCompletedOrder, updateCompletedOrder, getDailyExpenses, updateDailyExpenses, getSubmissionHistory, savePastAccount, deleteSubmission, getBusinessDate, isTodaySubmitted, submitDailySheet, checkAndApplyIjaraRollover, processSyncQueue, testFirestoreConnection, getLastSyncError, isSyncServiceRunning, isDbInitialized, restoreDatabaseFromCloud, syncRecordImmediately, syncDeletionsOnly, syncMenuOnly, syncTablesOnly, getPendingSyncCount, getSyncQueueItems, syncHighFrequencyCollections, syncLowFrequencyCollections, startSyncService, registerSyncTimer, markSyncTimerInactive, recordAutoSyncEvent, getSyncRuntimeDiagnostics, executeInspectorQuery, formatDisplayDate, ACTIVE_APP_PROFILE`.

---

## 7. FIREBASE

### 7.1 Firebase Overview

**No Firebase SDK is used.** Every Firestore operation is a raw `fetch()` against the **Firestore REST API v1**.

| Endpoint pattern | Usage |
|---|---|
| `https://firestore.googleapis.com/v1/projects/{projectId}/databases/(default)/documents/{collection}/{docId}` | GET / PATCH / DELETE single doc |
| `.../documents:runQuery` | Structured delta query (delta sync) |
| `.../documents/{collection}?pageSize=300` | Full collection fetch (restore) |
| `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=…` | Anonymous token mint |
| `https://securetoken.googleapis.com/v1/token?key=…` | Token refresh |

**Config source:** `EXPO_PUBLIC_FIREBASE_PROJECT_ID` + `EXPO_PUBLIC_FIREBASE_API_KEY`, sanitized by `cleanEnvVar()` (`database.js`) and `getFirebaseAuthConfig()` (`firebaseAuth.js`).

**Two distinct Firebase concerns:**
1. **Data sync** — `database.js` (POS collections).
2. **Version gating + force reauth** — `services/firebaseAppConfig.js`.

Both depend on **`services/firebaseAuth.js`** for anonymous transport credentials.

---

### 7.2 services/firebaseAuth.js — Full Method Reference

Anonymous-only Firebase auth. Tokens are the machine credential for Firestore REST. **Zero credential leakage** — tokens are never written to `sync_queue`.

**Exported constants:**

| Export | Value / purpose |
|---|---|
| `AUTH_KEYS` | `['_fb_auth_id_token','_fb_auth_refresh_token','_fb_auth_expires_at','_fb_auth_uid']` |
| `KEY_ID_TOKEN` | `'_fb_auth_id_token'` |
| `KEY_REFRESH_TOKEN` | `'_fb_auth_refresh_token'` |
| `KEY_EXPIRES_AT` | `'_fb_auth_expires_at'` |
| `KEY_UID` | `'_fb_auth_uid'` |

**Internal constants:** `REFRESH_THRESHOLD_MS = 5 min`, `NETWORK_TIMEOUT_MS = 10 s`. Module state: `authPromiseInProgress` (concurrency mutex), `isRecoveryInProgress` (anti-loop guard).

**Exported functions:**

| Function | Signature | Behavior |
|---|---|---|
| `isAuthCredentialKey(key)` | `(string) → boolean` | True if key starts with `_fb_auth_` / is in `AUTH_KEYS`. Used by `enqueueSync` and `processSyncQueue` security guards. |
| `getFirebaseAuthConfig()` | `() → { projectId, apiKey }` | Reads + sanitizes env vars (strips `\r\n\0`). |
| `getStoredAuthCredentials(db)` | `(db?) → { idToken, refreshToken, expiresAt, uid }` | Direct SQL read from `app_config`. |
| `saveStoredAuthCredentials(db, creds)` | `(db?, {idToken,refreshToken,expiresAt,uid}) → boolean` | Direct SQL `INSERT OR REPLACE` in a transaction. Bypasses `setAppConfig`/`enqueueSync`. |
| `clearStoredAuthCredentials(db)` | `(db?) → boolean` | Direct SQL `DELETE` of all auth keys. |
| `invalidateCurrentToken(db)` | `(db?) → boolean` | Deletes only `_fb_auth_id_token`, forcing refresh next call. Called on HTTP 401. |
| `performAnonymousSignUp(apiKey, fetch?)` | `async → {success, idToken?, refreshToken?, expiresAt?, uid?, error?}` | POST `accounts:signUp` with `{returnSecureToken:true}`. |
| `performTokenRefresh(apiKey, refreshToken, fetch?)` | `async → {success, idToken?, refreshToken?, expiresAt?, uid?, error?, status?}` | POST `securetoken.googleapis.com/v1/token` with `grant_type=refresh_token`. |
| `getFirestoreAuthHeaders(options?)` | `async → {success, headers?:{Authorization}, uid?, error?}` | **Main token engine** (see flow below). |

**`getFirestoreAuthHeaders()` flow:**
1. **Concurrency mutex** — join any in-flight promise (`authPromiseInProgress`).
2. Read cached creds from SQLite `app_config`.
3. If `idToken` valid for >5 min → return `Bearer` header immediately.
4. Else if `refreshToken` exists → `performTokenRefresh()`.
   - Success → save & return.
   - `invalid_grant` / HTTP 400 / `INVALID_REFRESH_TOKEN` / `TOKEN_EXPIRED` → **recovery**: clear creds, fresh `performAnonymousSignUp()`, guarded by `isRecoveryInProgress`.
   - Transient/network failure → return `{success:false, error:'REFRESH_FAILED: …'}` (never sends unauthenticated requests).
5. Else no creds → initial `performAnonymousSignUp()`, save & return.

**Key properties:** 10 s network timeout (`AbortController`), proactive 5-min refresh, single-flight dedup, direct-SQL token storage, 401-driven invalidation.

---

### 7.3 services/firebaseAppConfig.js — Full Method Reference

Version gating + forced re-authentication, using Firestore REST (`app_config/global`).

**Exports:**

| Export | Signature | Behavior |
|---|---|---|
| `APP_VERSION` | `string` | Read from `app.json` → `expo.version` (default `1.0.4`; current `1.0.7`). |
| `compareSemver(a, b)` | `(string,string) → 1\|-1\|0` | Numeric semver compare (handles `v` prefix, missing segments). |
| `DEFAULT_VERSION_POLICY` | `object` | Fallback policy (min/latest = APP_VERSION, GitHub releases URL, Bengali message). |
| `fetchVersionPolicy()` | `async → {success, policy, error?}` | GET `app_config/global`; caches to SQLite `cached_version_policy`; auto-initializes on 404. |
| `setVersionPolicy(policy)` | `async → {success, error?}` | PATCH with `updateMask` (admin). Validates version format `X.Y.Z`. Writes `minimum_required_version`, `minimum_version`, `latest_version`, `update_url`, `force_update_enabled`, `update_message`, `updated_at`. |
| `checkAppVersionPolicy(role)` | `async → {allowed, updateRequired, policy, currentVersion, minimumVersion, offline, error, adminExempt?}` | **ADMIN is always exempt.** Blocks if `force_update_enabled && APP_VERSION < minimum_required_version`. Offline uses cached policy. |
| `checkAppVersion(role)` | `async → {allowed, minimumVersion, currentVersion}` | Backward-compat wrapper over `checkAppVersionPolicy`. |
| `fetchMinimumVersion()` | `async → string` | Returns `policy.minimum_required_version`. |
| `setMinimumVersion(v)` | `async → {success, error?}` | Sets min + latest version. |
| `verifyForceReauthLocally(username, pin)` | `async → {verified, reason?}` | Connectivity + credential check by GETting `app_config/global` (ok or 404 = verified). |

**Firestore version doc fields:** `minimum_required_version`, `minimum_version` (alias), `latest_version`, `update_url`, `force_update_enabled`, `update_message`, `updated_at`.

**Triggers:** cold start (App.js) and foreground resume — if `updateRequired`, routes to `APP_UPDATE_REQUIRED` (only for non-ADMIN profiles).

---

### 7.4 Firestore REST Transport in database.js

**Write (push) — `processSyncQueue()`:**
- Fetch up to **20 PENDING** items, then **20 FAILED** (subject to backoff).
- Get fresh auth headers (`getFirestoreAuthHeaders()`); if unavailable → mark items `FAILED`.
- `DELETE` action → HTTP `DELETE` to `.../documents/{collection}/{id}`.
- `INSERT`/`UPDATE` → read SQLite row → `toFirestoreDocument(row)` → HTTP `PATCH` to `.../documents/{targetCollection}/{id}`.
- **`daily_submit` special case:** queries `daily_submit_priority` in Firestore; if remote priority > local, skip upload (deletes queue item).
- On HTTP 401 → `invalidateCurrentToken()` → retry once.
- On success → delete queue row, set `is_synced=1`; on 403/other → mark `FAILED`.

**Document conversion:**
- `toFirestoreDocument(obj)` — flat JS object → `{ fields: { k:{stringValue|doubleValue|booleanValue} } }`. Skips `is_synced`, null/undefined; objects are `JSON.stringify`→`stringValue`.
- `fromFirestoreDocument(doc)` — Firestore typed fields → flat JS row.

**Delta pull — `fetchChangedRecordsFromFirestore(collection, lastSyncTime)`:**
```js
{ structuredQuery: { from:[{collectionId}],
  where:{ fieldFilter:{ field:{fieldPath:'updated_at'}, op:'GREATER_THAN', value:{stringValue:lastSyncTime} } } } }
```
- Cursor stored per table in `app_config` as `last_sync_time_{table}`.
- **Overlap safety:** subtract 60 s from marker.
- HTTP 403 on pull → treated as empty (graceful), cursor advanced.

**Full fetch — `fetchCollection(collection, isMasterTable)`:** paginated (`pageSize=300`), follows `nextPageToken`.

**`syncCollections(list, cycleName)`:** per-table read cursor → delta or full fetch → per-doc merge (only newer `updated_at` wins, respect local `is_synced=0` pending edits, `restaurant_tables` restricted to `table_1`…`table_8`) → **Schema Guardian** reads `PRAGMA table_info` and only inserts locally-existing columns → upsert with `is_synced=1` → advance cursor (never past `queryStartTime − 15s`).

**Delete tombstones:** `deletions` table is stored in Firestore as the `app_config` collection (rows carrying `table_name` + `record_id`), routed back to `deletions` on pull.

**Other transport helpers:** `fetchSingleDocFromFirestore(collection, docId)`, `testFirestoreConnection()`, `restoreDatabaseFromCloud({mode})`, `resyncSameDayFromCloud(date)`.

---

### 7.5 Firestore Collections ↔ SQLite Tables

Each collection maps 1:1 to a SQLite table of the same name (`(default)` Firestore DB):

`users`, `restaurant_tables`, `orders`, `order_items`, `payments`, `expenses`, `deliveries`, `daily_submit`, `daily_summary`, `menu_categories`, `menu_items`, `due_payments`, `eja_history`, `off_days`, `weather_data`, `supplier_due`, `supplier_due_history`, `supplier_payment_ledger`, `app_config`, `daily_submit_priority`, `owner_employees`, `owner_salary_ledger`, `owner_expenses`, `owner_deposits`, `owner_home_deposits`, `delete_history`, `activity_logs`, `deletions` (→ stored in `app_config` collection).

**Local-only (never synced):** `ai_dataset_queue`, `ai_dataset_history`, `weather_timeline_queue`, `sync_queue`, `history_download_log`, `device_registry`.

---

## 8. SUPABASE

### 8.1 Supabase Overview

Supabase powers **Device Control & Realtime Monitoring only** — deliberately isolated from POS data.

Three mechanisms:
1. **Realtime Presence (WebSocket, in-memory, zero DB writes)** — live online/active state, 25 s heartbeat.
2. **Postgres `devices`/`device_app_usage` tables** — persistent state.
3. **`postgres_changes` (CDC)** — sub-second remote commands and fleet change notifications.

SDK: `@supabase/supabase-js`. No Supabase auth session (`persistSession:false`).

---

### 8.2 services/supabaseClient.js — Full Method Reference

| Export | Signature | Behavior |
|---|---|---|
| `isSupabaseConfigured()` | `() → boolean` | True if URL + anon key valid (`http…`). |
| `getSupabaseClient()` | `() → SupabaseClient\|null` | The singleton client (or `null`). |
| `safeSupabaseCall(fn, fallback)` | `async (opFn, any) → any` | Fail-safe wrapper — never throws; on error logs a warning and returns `fallback`. |
| default export | `supabaseInstance` | The client instance or `null`. |

Client options: `auth:{persistSession:false, autoRefreshToken:false, detectSessionInUrl:false}`, `realtime:{params:{eventsPerSecond:10}}`. Dormant mode if env vars missing/invalid — **Supabase errors never crash the app or POS**.

---

### 8.3 services/supabaseDeviceControl.js — Full Method Reference

**Exported constants:**

| Constant | Value | Meaning |
|---|---|---|
| `STALE_PRESENCE_TIMEOUT_MS` | `45000` | Presence older than 45 s = offline. |
| `KEEPALIVE_HEARTBEAT_MS` | `25000` | Presence heartbeat interval. |
| `DB_HEARTBEAT_INTERVAL_MS` | `120000` | Throttle for `last_seen_at` DB persist. |

**Channel names:** presence = `rongdhonu_device_presence`; command = `device_cmd:{deviceId}`; admin changes = `admin_devices_changes`.

**Exported functions:**

| Function | Signature | Behavior |
|---|---|---|
| `upsertDeviceToSupabase(record)` | `async → boolean` | Upsert into `devices` (`onConflict:'device_id'`); converts SQLite `0/1` → PG booleans. |
| `updateSupabaseDevice(deviceId, fields)` | `async → boolean` | Partial update `.eq('device_id')`; graceful fallback if `force_logout_token` column missing (`PGRST204`). |
| `clearForceLogoutIfMatching(deviceId, ts?, token?)` | `async → boolean` | Sets `force_logout=false` only when token/timestamp matches (race-safe ack). |
| `fetchSingleSupabaseDevice(deviceId)` | `async → {success, record, notFound, error}` | `.maybeSingle()`; distinguishes network error vs confirmed-missing. |
| `fetchSupabaseDevices(callerProfile?)` | `async → array` | **ADMIN-only** (security block returns `[]` for others); orders by `created_at` desc. |
| `extractPresenceMap(state, prevMap?)` | `(object,object?) → map` | Parses presence state; filters stale (>45 s); preserves `last_active` for left devices. |
| `startDevicePresence(deviceId, metadataProvider, onRemoteCommand)` | `(…) → cleanupFn` | Starts presence tracking (25 s heartbeat) + `postgres_changes` command listener; auto-reconnect with 3 s backoff. Returns `stopDevicePresence`. |
| `stopDevicePresence()` | `async` | Stops timers, publishes offline presence + persists `last_seen_at`, unsubscribes channels. |
| `formatDeviceActivityStatus(livePresence, lastSeenTs, now?)` | `(…) → {isOnline, text, subtext}` | Returns `🟢 Active now (ROLE)` or `⏳ <relative>`; computed in-memory, zero network. |
| `subscribeAdminDeviceMonitor(onPresenceUpdate, onRecordChange, adminDeviceId?)` | `(…) → cleanupFn` | Admin subscribes to live presence + `devices` table changes (`event:'*'`). Returns unsubscribe. |

---

### 8.4 Supabase Schema

**`public.devices`** (`supabase_full_setup.sql`):
```sql
device_id TEXT PRIMARY KEY,
device_name, manufacturer, brand, model, android_version, app_version,
first_install_time TEXT,
status TEXT NOT NULL DEFAULT 'PENDING',      -- 'PENDING' | 'ACTIVE' | 'BLOCKED'
allow_login BOOLEAN NOT NULL DEFAULT true,
allow_offline BOOLEAN NOT NULL DEFAULT true,
admin_lock BOOLEAN NOT NULL DEFAULT false,   -- emergency/stolen lock
force_logout BOOLEAN NOT NULL DEFAULT false,
force_logout_token TEXT,                     -- unique revocation id per command
registered_by TEXT DEFAULT 'SYSTEM_AUTO', notes TEXT,
is_deleted BOOLEAN NOT NULL DEFAULT false, deleted_at TIMESTAMPTZ, deleted_by TEXT,
last_seen_at TIMESTAMPTZ DEFAULT now(),
created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
```
Indexes: `status`, `is_deleted`, `last_seen_at`. Realtime replication added to publication `supabase_realtime`.

**`public.device_app_usage`**:
```sql
id TEXT PRIMARY KEY,          -- '{device_id}_{business_date}_{role}'
device_id TEXT NOT NULL, business_date TEXT NOT NULL,   -- YYYY-MM-DD (Dhaka 06:00 cutoff)
role TEXT NOT NULL,                                     -- 'ADMIN'|'OWNER'|'MANAGER'|'WAITER'
app_label TEXT NOT NULL, total_seconds INTEGER NOT NULL DEFAULT 0,
last_heartbeat TIMESTAMPTZ DEFAULT now(),
created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
```

**Local SQLite mirror `device_registry`** (created by `services/deviceRegistry.js`):
```sql
id TEXT PRIMARY KEY, device_id TEXT UNIQUE NOT NULL,
device_name, manufacturer, brand, model, android_version, app_version, first_install_time,
last_seen TEXT, allow_login INTEGER DEFAULT 0, allow_offline INTEGER DEFAULT 0,
status TEXT DEFAULT 'PENDING', registered_by, notes,
created_at, updated_at, is_synced INTEGER DEFAULT 0,
admin_lock INTEGER DEFAULT 0, force_logout INTEGER DEFAULT 0, force_logout_token TEXT,
is_deleted INTEGER DEFAULT 0, deleted_at TEXT, deleted_by TEXT
```

---

### 8.5 RLS Policies & Production RPC Migration Plan

**Current stage — permissive (client-side enforcement only):**
```sql
CREATE POLICY "Allow device tracking and control" ON public.devices
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
```
> ⚠️ Any client with the anon key can run raw queries. Server-side protection is **not yet deployed**.

**Production migration plan (Phase 7 — see `RLS_IMPLEMENTATION_PLAN.md`, not yet executed):**
1. **Tightened SELECT/UPDATE policies** — devices read/update only their own row (via `x-device-id` header or JWT `device_id`); regular devices cannot modify `admin_lock`, `status`, or `allow_offline`.
2. **Server-side RPC** `public.admin_device_action(p_action, p_target_device_id, p_params)` (`SECURITY DEFINER`) — authorized admin-only actions: `FORCE_LOGOUT` (mints `fl_<epoch>_<rand>` token), `LOCK`, `UNLOCK`, `BLOCK`, `APPROVE`.

> **Note:** the app currently performs these actions client-side via `updateSupabaseDevice()` from `deviceRegistry.js`. **No `supabase.rpc(...)` calls exist anywhere in the codebase yet.**

---

### 8.6 services/deviceRegistry.js — Full Method Reference

The device **access-control layer**: local SQLite mirror of Supabase `devices` + push/pull helpers.

**Device ID resolution priority chain:** P1 `Application.getAndroidIdAsync()` → `android_{id}`; P2 stored `persistent_device_id` in `app_config`; P3 deterministic hash of `brand + model` → `hw_{hash}_{brand_model}`; P4 UUID `dev_uuid_{ts}_{rand}`.

| Function | Signature | Behavior |
|---|---|---|
| `checkAndFlushLastSeen()` | `() → ?` | Updates `last_seen=NOW` and pushes to Supabase. |
| `syncDeviceHardwareAndVersion()` | `async` | Pushes fresh phone metadata + app version to Supabase. |
| `reconcileAdminFleet(prefetchedList?)` | `async` | Merges Admin fleet from Supabase into local SQLite. |
| `registerDeviceIfNeeded(options)` | `async` | Registers device (status `PENDING`, `allow_login=0`), upserts to Supabase; pushes metadata only (never admin-controlled fields). |
| `getCurrentDeviceRecord()` | `() → record` | Reads local `device_registry` for this device. |
| `checkDeviceLoginPermission(userRole)` | `(role) → boolean` | Whether the role may log in per status/allow_login. |
| `getAllRegisteredDevices()` | `() → array` | Non-deleted fleet. |
| `getDeletedDevices()` | `() → array` | Soft-deleted archive. |
| `renameDevice(deviceId, newName, admin)` | `() → boolean` | Update local + Supabase. |
| `softDeleteDevice(deviceId, admin)` | `() → boolean` | Set `is_deleted`, `deleted_at/by`. |
| `restoreDevice(deviceId, admin)` | `() → boolean` | Clear `is_deleted`. |
| `updateDeviceStatus(deviceId, status, admin)` | `async → {success, error?}` | Approve/block; **Supabase first**, then local. |
| `updateDeviceOfflinePermission(deviceId, allowOffline, admin)` | `async → {success, error?}` | Toggle `allow_offline`. |
| `checkDeviceOfflinePermission(userRole)` | `(role) → boolean` | Offline login allowed? |
| `setAdminDeviceLock(deviceId, enableLock, admin)` | `async → {success, error?}` | Emergency lock (Supabase-first). |
| `triggerForceLogout(deviceId, admin)` | `async → {success, error?}` | Generates `fl_` token, sets `force_logout=true` in Supabase. |
| `triggerGlobalForceLogout(admin)` | `async` | Sets `force_logout=true` for all devices (fleet-wide). |
| `checkAndExecuteForceLogout(remoteRecord?)` | `async` | If local `force_logout=1` → clear session, set `force_reauth_required`, ack via `clearForceLogoutIfMatching`. |
| `verifyDeviceAccessOnStartupOrResume(userRole)` | `async` | Startup gate: routes to `DEVICE_BLOCKED`/`DEVICE_PENDING`/login; ADMIN/OWNER bypass approval. |
| `syncRemoteDeviceToLocal(remoteRecord)` | `(record) → ?` | Merges a Supabase device record into local SQLite (handles stale `force_logout`). |
| `refreshDeviceRegistryFromSupabase()` | `async` | Full fleet re-fetch + local reconcile. |

---

### 8.7 services/appUsageTracker.js — Full Method Reference

Day-wise per-role app usage, tracked **locally in SQLite and pushed to Supabase `device_app_usage`**. Business date uses **Dhaka 06:00 AM cutoff**.

| Function | Signature | Behavior |
|---|---|---|
| `getDhakaBusinessDate(ts?)` | `(number?) → 'YYYY-MM-DD'` | Business date with 06:00 Dhaka cutoff. |
| `getAppLabelForRole(role, appProfile?)` | `(…) → string` | 'Admin App' / 'Manager App' / etc. |
| `formatDurationBengali(seconds)` | `(number) → string` | Bengali human duration. |
| `initAppUsageTable()` | `()` | Creates local app-usage table. |
| `flushAppUsage(forceCloudPush?)` | `() → ?` | Persists accumulated seconds; pushes to Supabase. |
| `startAppUsageTracker({deviceId,userRole,appProfile,isLoggedIn})` | `()` | Starts tracking. |
| `stopAppUsageTracker()` | `()` | Stops tracking. |
| `handleUsageAppStateChange(nextState)` | `(state)` | Handles background/foreground transitions. |
| `getLocalAppUsageForDate(businessDate)` | `(string) → array` | Local usage rows for a date. |
| `fetchRemoteAppUsageForDate(businessDate)` | `async → array` | Supabase usage rows for a date. |
| `subscribeAppUsageRealtime(businessDate, onUsageUpdate)` | `(…) → cleanupFn` | Realtime subscription to `device_app_usage`. |

Row id format: `{device_id}_{business_date}_{role}`.

---

### 8.8 Device Lifecycle & Force Logout Flows

**New install → register:**
`registerDeviceIfNeeded()` → resolve device ID → insert `device_registry` (`PENDING`, `allow_login=0`) → `upsertDeviceToSupabase()` (UPSERT on `device_id`).

**Startup access check:**
`verifyDeviceAccessOnStartupOrResume()` → reads local status:
- `admin_lock=1` → `DEVICE_BLOCKED`
- `force_logout=1` → clear session + force reauth
- MANAGER + `PENDING` → `DEVICE_PENDING`
- MANAGER + `BLOCKED` → `DEVICE_BLOCKED`
- ADMIN/OWNER → bypass approval (unless locked/blocked)

**Admin approves:**
`updateDeviceStatus(deviceId,'ACTIVE')` → Supabase first → local update. Pending device sees status change via Realtime → `onRemoteCommand` → login proceeds.

**Live tracking (parallel):**
- **Presence** — `startDevicePresence()` channel `rongdhonu_device_presence`, 25 s heartbeat, 45 s stale threshold, zero DB writes.
- **DB persist** — `last_seen_at` written to Supabase at most every 2 min.
- **Force-logout polling** — App.js `setInterval(…,1000)` → `checkAndExecuteForceLogout()`.
- **Realtime command channel** — `postgres_changes` on `devices` filtered by `device_id` → sub-second delivery.

**Force logout (two paths, whichever fires first):**
1. Realtime (`<300 ms`) → `onRemoteCommand(record)` → if `force_logout===true` → `checkAndExecuteForceLogout()`.
2. Polling (≤1 s).
Then: clear session → set `force_reauth_required=1` → `clearForceLogoutIfMatching(deviceId, ts, token)` (token-guarded race-safe ack).

---

## 9. DATA LAYER — SQLITE SCHEMA & SYNC ENGINE

**Database:** `rongdhonu.db` via `expo-sqlite` (`SQLite.openDatabaseSync`). All data tables carry `is_synced INTEGER DEFAULT 0`.

**All SQLite tables (schema in `database.js` `TABLE_SCHEMAS`):**

| Table | PK | Purpose |
|---|---|---|
| `users` | `id` | Accounts (PIN auth): username, pin, role, display_name |
| `restaurant_tables` | `id` | 8 fixed tables (`table_1`…`table_8`); items(JSON), status, startTime |
| `orders` | `id` | Completed orders incl. delivery_charge, change_money_given, split amounts |
| `order_items` | `id` | Line items (order_id, itemName, quantity, unit_price, revenue) |
| `payments` | `id` | Payment records (methods, discount, change, paid_at) |
| `expenses` | `id` | Daily operational expenses (category, amount, due/given/used/returned) |
| `deliveries` | `id` | Delivery orders (customer, items JSON, delivery_charge) |
| `daily_submit` | `id`=date | Manager EOD submission + lock + submission_type |
| `daily_summary` | `id`=date | Computed analytics (weather, totals, itemSummary JSON) |
| `menu_categories` | `id` | Menu categories |
| `menu_items` | `id` | Menu items, `UNIQUE(name, category)` |
| `due_payments` | `id` | Customer dues |
| `eja_history` | `id` | Ijara (rent) history |
| `off_days` | `id` | Closure days |
| `weather_data` | `id` | Daily weather |
| `sync_queue` | AUTOINCREMENT | Outbound write queue |
| `notifications` | `id` | In-app notifications |
| `app_config` | `id`/`key` | KV store: sync cursors, version cache, auth tokens, flags |
| `ai_dataset_history` | `id` | AI export log (local-only) |
| `ai_dataset_queue` | `id` | AI export queue (local-only) |
| `supplier_due` | `id` | Supplier balance |
| `supplier_due_history` | `id` | Per-transaction supplier ledger |
| `supplier_payment_ledger` | `id` | Monthly supplier payments |
| `deletions` | `id` | Deletion tombstones (local cache) |
| `delete_history` | `id` | Audit log of deletes + snapshot_data |
| `history_download_log` | AUTOINCREMENT | Rate-limit historical downloads |
| `daily_submit_priority` | `business_date` | Priority for daily_submit conflict resolution |
| `owner_employees` | `id` | Employees |
| `owner_salary_ledger` | `id` | Salary payments (FK → owner_employees) |
| `owner_expenses` | `id` | Owner expenses |
| `owner_deposits` | `id` | Monthly bank deposits |
| `owner_home_deposits` | `id` | Home deposits |
| `activity_logs` | `id` | Full audit trail (device telemetry + metadata) |
| `device_registry` | `id` | Local mirror of Supabase `devices` |

**`sync_queue` schema:** `id, record_id, table_name, action(INSERT/UPDATE/DELETE), status(PENDING/SUCCESS/FAILED), created_at, retry_count, last_error, last_attempt_at`.

**Push pipeline:**
```
write → SQLite + enqueueSync() → sync_queue(PENDING) → [5s daemon] → Firestore REST (PATCH/DELETE)
```
`enqueueSync(table,id,action)` guards: never enqueue `_fb_auth_*` or local-only tables (`ai_dataset_queue/history`, `weather_timeline_queue`); idempotent (deletes existing PENDING for same record first).

**Pull timers (App.js `useEffect([isLoggedIn])`):**

| Timer | Interval | Function | Collections |
|---|---|---|---|
| `queue-push-daemon` | 5 s | `processSyncQueue()` | push |
| `auto-tables-pull` | 15 s | `syncTablesOnly()` | `restaurant_tables` |
| `auto-high-frequency-pull` | 30 s | `syncHighFrequencyCollections()` | `orders`,`order_items`,`payments`,`deliveries` |
| `auto-deletions-pull` | 90 s | `syncDeletionsOnly()` | `deletions` |
| `auto-low-frequency-pull` | 180 s | `syncLowFrequencyCollections()` | full/reduced sets per profile |
| `menu` | on-demand | `syncMenuOnly()` | `menu_items`,`menu_categories` |

Concurrency guards (`isPullingSync*` flags) + 25 s `runAutoPull` watchdog.

**Full restore `restoreDatabaseFromCloud({mode})`:** always-full tables (users, menu, tables, app_config, supplier_due, owner master tables) + recent-only (31 days) for transactional tables + skip markers per profile.

**Same-day resync `resyncSameDayFromCloud(date)`:** rate-limited 2×/business day; atomic wipe + re-insert of today's data.

---

## 10. database.js — COMPLETE METHOD REFERENCE

The POS data + sync engine (7128 lines). Grouped exports:

**Core / init:** `getDb()`, `db` (Proxy), `initDatabase(skipSeeding?)`, `seedDefaultMenu()`, `cleanupDuplicateMenuItems()`, `isDbInitialized()`, `isDatabaseEmpty()`, `executeLocalTestRollback(date)`.

**Migrations:** `migrateMenuItemsTable()`, `migrateDeliveryCharge()`, `migrateSplitPayments()`, `migrateSyncQueueDiagnostics()`, `migrateDailySubmitUnified()`, `migrateDeleteHistory()`, `migrateSupplierDue()`, `migrateAIDatasetTables()`.

**Sync engine:** `enqueueSync(table,id,action)`, `setSystemOnline(bool)`, `startSyncService()`, `processSyncQueue(singleId?,singleTable?)`, `syncRecordImmediately(table,id)`, `isSyncServiceRunning()`, `syncTablesOnly()`, `syncHighFrequencyCollections()`, `syncLowFrequencyCollections()`, `syncDeletionsOnly()`, `syncMenuOnly()`, `syncDeviceRegistry()` (decommissioned → returns false), `clearDeadQueueItems()`, `resetLastSyncTime(collection?)`, `getLastSyncError()`.
- Diagnostics: `registerSyncTimer`, `markSyncTimerInactive`, `recordAutoSyncEvent`, `traceSyncOperation`, `getSyncRuntimeDiagnostics`, `incrementNetInfoRecoveryCount`, `incrementForegroundRecoveryCount`.
- Pause: `isSyncPaused()`, `pauseSync(reason)`, `resumeSync()`, `getSyncPauseInfo()`.
- Manual: `getRemainingPushes/Pulls(role)`, `incrementPushCount/PullCount()`, `resetPushPullCounts()`, `executeManualPush()`, `executeManualPull()`.
- Restore: `restoreDatabaseFromCloud({mode})`, `restoreUsersOnlyForProfile()`.
- Resync: `getSameDayResyncStatus(date?)`, `resetSameDayResyncLimit(date?)`, `resyncSameDayFromCloud(date?)`.
- History download: `checkHistoryDownloadStatus(type,period)`, `getDailyDownloadCount(type)`, `logHistoryDownload(...)`, `resetHistoryDownloadLimits()`, `fetchHistoricalDateData(date)`, `fetchHistoricalMonthData(month)`, `recoverMenuFromCloud()`.
- Cloud test: `testFirestoreConnection()`, `getFirebaseUsageStats()`.

**Profiles:** `ACTIVE_APP_PROFILE`, `APP_PROFILES`, `getActiveProfileConfig()`, `getSessionUserRole()`, `getRolePriority(role)`.

**Users/auth (local PIN):** `verifyUserLogin(username,pin)`, `checkUserExists(username)`, `getUserByUsername(username)`, `changeUserPin(username,newPin)`, `createUser(username,pin,role,displayName)`, `verifyPinCode(pin)`, `verifyOwnerPin(pin)`, `verifyOwnerOrAdminPin(pin)`.

**Config/KV:** `getAppConfig(key)`, `setAppConfig(key,value)`, `insertNotification(title,message)`.

**Menu:** `getMenuItems()`, `addMenuItem(item)`, `updateMenuPrice(name,price,category?)`, `deleteMenuItem(name,category?)`.

**Tables:** `getTables()`, `updateTableState(id,items,status,startTime)`, `updateTableName(id,newName)`.

**Deliveries:** `getDeliveries()`, `createDelivery(id,name,status,startTime)`, `updateDeliveryState(...)`, `updateDeliveryDetails(id,charge,change)`, `completeDelivery(...)`, `getDeliveryById(id)`, `removeDelivery(id)`.

**Orders:** `getCompletedOrders()`, `addCompletedOrder(record)`, `deleteCompletedOrder(id)`, `updateCompletedOrder(id,items,total)`, `getItemSalesReport(start,end)`, `getQuickFilterDates(filterType)`.

**Expenses/Supplier:** `getDailyExpenses()`, `updateDailyExpenses(expenses)`, `getSupplierDueData()`, `saveSupplierDue(...)`, `getSupplierDueHistory(id)`, `deleteSupplierDueHistory(id)`, `getSupplierPaymentLedger(month)`, `saveSupplierPayment(...)`, `updateSupplierName(id,newName)`.

**Daily submit / ijara:** `getSubmissionHistory()`, `savePastAccount(record)`, `deleteSubmission(date)`, `isTodaySubmitted()`, `submitDailySheet(summary,by,type)`, `calculateAndStoreNextDayIjara(...)`, `rollbackAutoIjara(date?)`, `getLastAutoIjaraDetails()`, `checkAndApplyIjaraRollover()`, `resetDailySubmitLock()`, `resetIjaraExpense()`, `getBusinessDateOffset(date,days)`, `saveDailySubmitPriority(...)`, `getDailySubmitPriority(date)`, `getMonthlyRestaurantDeposits(monthPrefix)`, `getTodayRestaurantDeposit(date)`.

**Analytics:** `calculateAndSaveDailySummary(date)`, `triggerWeatherFetch()`, `triggerWeatherTimelineService()`, `triggerGoogleSheetExportCheck()`.

**AI dataset:** `enqueueAIDatasetExport(date)`, `processAIDatasetQueue()`.

**Deletion/history:** `deleteDataByDate(date)`, `getDeleteHistory(limit?)`, `logDeleteHistory(...)`, `recordDeletion(table,id)`.

**Activity logs:** `fetchActivityLogsForDate(date)`, `getActivityLogsFromDb(date,filters)`, `getDistinctActivityDevices(date?)`.

**Dates:** `getBusinessDate()`, `getBusinessDateFromISO(iso)`, `formatDisplayDate(input)`.

**Inspector:** `inspectDatabaseStats()`, `executeInspectorQuery(sql,params)`.

**Owner module:** `saveOwnerEmployee`, `updateOwnerEmployee`, `getOwnerEmployees`, `getOwnerEmployeeById`, `deleteOwnerEmployee`, `saveSalaryLedgerEntry`, `getEmployeeSalaryLedger`, `deleteSalaryLedgerEntry`, `getEmployeeMonthlySummary`, `getLastEmployeePayment`, `DEFAULT_OWNER_EXPENSE_CATEGORIES`, `getExpenseCategories`, `addExpenseCategory`, `deleteExpenseCategory`, `saveOwnerExpense`, `updateOwnerExpense`, `getOwnerExpenses`, `deleteOwnerExpense`, `getOwnerExpenseSummary`, `getMonthlyTotalSalaryPaid`, `saveOwnerDeposit`, `getTotalOwnerDeposits`, `getOwnerDepositByMonth`, `deleteOwnerDepositByMonth`, `saveHomeDeposit`, `updateHomeDeposit`, `deleteHomeDeposit`, `getHomeDeposits`, `getMonthlyTotalHomeDeposits`.

---

## 11. OTHER SERVICES

### services/activityLogger.js
- `ACTION_TYPES` — `DELETE, SUBMISSION, EXPENSE, IJARA` (+ legacy `ORDER, PAYMENT, MENU, SETTLEMENT, DEVICE, SECURITY, SYSTEM`).
- `logActivity({actionType, actionTitle, description, metadata, businessDate, userRole, userName})` → inserts into `activity_logs` with full device telemetry, then `enqueueSync` + `syncRecordImmediately`. Returns log id.

### services/analyticsService.js
`getAvailableMonthsOverview()`, `getAvailableWeeksOverview()`, `getPeriodAnalytics(mode, key)`, `buildAnalyticsComparison(mode, cur, cmp, labels)`, `getDatesForPeriod(mode, key)`, `getDailyBreakdown(mode, key)`, `getExpenseCategories(mode, key)`.

### services/analyticsHelper.js
`compareExpenseCategories(cur, cmp)`, `analyzeWeatherImpact(dates)`, `compareTopItems(cur, cmp, limit)`, `generateInsights(...)`.

### services/backupRestore.js
Exports `INCLUDED_TABLES`, `EXCLUDED_TABLES`, `EXCLUDED_CONFIG_KEYS`. Functions: `isSensitiveConfigKey(key)`, `toFileUri(path)`, `getBackupDirectory()`, `ensureBackupDirectoryExists()`, `cleanupInspectBackup(name)`, `createBackup()`, `pickAndValidateBackup()`, `restoreBackup(inspectDbName, metadata)`, `getBackupStatus()`. Preserves credentials / excludes sensitive config keys on restore.

### services/printerService.js
Exports `PRINTER_SERVICES`, `showPrinterToast`, `isPrinterConnected`, `getPrinterStatus`, `onPrinterStatusChange`, `syncPrinterStatus`, `connectPrinter`, `parseOrderItems`, `normalizeOrderForReceipt`, `toBengaliNumber`, `translatePaymentMethod`, `formatReceiptText`, `renderReceiptToEscPosBytes`, `printReceipt(order,opts)`, `autoPrintReceiptIfConnected(order)`; internal Web Bluetooth path (`connectWebBluetooth`, `sendBytesToCharacteristic`).

### pdfHelper.js
PDF generation for reports (sales/deposit/monthly). Tested by `tests/pdfHelper.test.js`.

---

## 12. SCREENS INVENTORY

**Core / dashboards / auth:**
- `LoginScreen` — username + 4-digit PIN, Online/Offline toggle, biometric (owner/admin), force-reauth. Uses `checkAppVersion`, `verifyForceReauthLocally`.
- `AdminDB` — admin monitoring dashboard (stats/charts, table + delivery monitor, device fleet widget, version control, many modals). Uses `fetchMinimumVersion`, `setMinimumVersion`, `APP_VERSION`, `compareSemver`.
- `OwnerDashboard` — owner monitoring + side menu.
- `ManagerDashboard` — manager POS dashboard.

**Order/billing:** `TableDetailScreen`, `AddItemScreen` (menu picker + edit mode), `PaymentCheckoutScreen`, `PaymentSuccess`.

**Daily/reports:** `DailySubmitScreen`, `ExpensesScreen`, `SupplierDueScreen`, `DailyItemSalesReport`, `DeleteHistoryScreen`, `SyncDiagnosticsScreen`, `AdminAnalyticsScreen`, `ActivityLogScreen`.

**Owner finance/employees:** `OwnerFinanceDashboard`, `OwnerExpenseScreen`, `EmployeeListScreen`, `AddEmployeeScreen`, `EmployeeDetailScreen`, `AddSalaryPaymentScreen`.

**Device access:** `DevicePendingScreen` (polls Supabase every 10 s), `DeviceBlockedScreen`, `DeviceManagementScreen` (admin fleet; uses `fetchSupabaseDevices`, `subscribeAdminDeviceMonitor`, `formatDeviceActivityStatus`, `APP_VERSION`), `OfflineVerificationScreen`, `AppUpdateRequiredScreen`.

**System tools (ADMIN):** `SystemToolsScreen`, `DatabaseHealthScreen`, `DatabaseStatsScreen`, `SyncStatusScreen`, `SystemInfoScreen`, `DatabaseExplorerScreen`, `TableViewerScreen`, `RowDetailScreen`, `BackupRestoreScreen`, `PrinterSettingsScreen`.

**AI dataset (ADMIN, flagged):** `AIDatasetMonitorScreen`, `AIDatasetAuditCenterScreen`.

**Important:** No screen/component calls `supabase.from(...)` directly or imports `supabaseClient`/`firebaseAuth` — all Supabase goes through `supabaseDeviceControl`, all Firestore through `database.js`. **No `supabase.rpc()` anywhere.**

---

## 13. COMPONENTS INVENTORY

| Component | Purpose |
|---|---|
| `AdminSideMenu` / `OwnerSideMenu` / `ManagerSideMenu` | Role drawers |
| `SidebarIcon` | Lucide icon mapping |
| `StatCard` | Stat cards (`TodaySalesCard`, `TotalCashCard`, `ActiveTablesCard`, `ActiveOrdersCard`, `MonthlyTotalCard`) + `DigitalBreakdownModal` + `VectorGlyph` |
| `OrderDetailModal` | Order detail + print/delete |
| `SalesReportModal` | Sales report + per-row print + PDF |
| `DepositReportModal` | Monthly deposit report + PDF |
| `PastAccountModal` | Back-dated manual account entry |
| `PrintReceiptModal` | Receipt preview → connect → print (384-dot raster) |
| `PrinterStatusBanner` | Printer status banner (explicit connect) |
| `AutoReceiptPrinter` | Silent auto-print host (global) |
| `ReceiptPaper` | 58 mm receipt React view (`DEFAULT_SHOP_PHONE`, `BILL_SHOP_PHONE`) |

---

## 14. PRINTER SUBSYSTEM

Located in `services/printer/` (framework-agnostic manager) and consumed via `services/printerService.js`.

- `printerManager.js` — state machine. Exports `RECEIPT_RASTER_WIDTH=384`, `STATUS`, `MESSAGES`, `getErrorMessage`, `resolveError`, `computeStatus`, `toWireAddress`, `getStatus`, `subscribe`, `refresh`, `scanForDevices`, `getBluetoothDetectionReport`, `connectDevice`, `autoConnectSavedPrinter`, `scanAndConnect`, `connectKnown`, `disconnect`, `forget`, `dismissBanner`, `watchConnection`, `printReceipt`, `printTestReceipt`, `confirmPhysicalTest`.
- `printerTransport.js` — native turbo module + Web Bluetooth fallback. Exports `isAvailable`, `isAudioDevice`, `scan`, `stopScan`, `DEFAULT_CONNECT_TIMEOUT_MS=12000`, `connect`, `disconnect`, `isConnected`, `testConnection`, `printImage`, `printRaw`, `onConnectionChanged`, `sendChunks`, `requestPermissions`, `openAppSettings`.
- `printerSettings.js` — persisted keys `PRINTER_KEYS` (address/name/transport/test flags/banner); `loadSettings`, `savePrinterSelection`, `markTestTransmitted`, `markTestConfirmed`, `markBannerDismissed`, `forgetPrinter`.
- `printerDiagnostic.js` — checkpoints + capped logs (`MAX_LOGS=60`); `maskAddress`, `updateDiagnosticCheckpoint`, `getDiagnosticCheckpoints`, `resetDiagnosticCheckpoints`, `logDiagnosticEvent`, `getDiagnosticLogs`, `clearDiagnosticLogs`, `subscribeDiagnostics`.
- `printerButtonStates.js` — `computeButtonStates`, `getDisabledReason`.
- `receiptData.js` — receipt re-exports.
- `index.js` — public barrel export.

Android permissions (app.config.js): `BLUETOOTH`, `BLUETOOTH_ADMIN`, `BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT`, `ACCESS_FINE_LOCATION`.

---

## 15. AI DATASET SUBSYSTEM

`services/aiDataset/` implements an export pipeline: build → validate → map → queue → transport to Google Sheets.

- `builder.js` — `buildDailyDataset(db,date)`, `buildItemDataset(db,date)`.
- `schema.js` — `DAILY_SALES_DATASET_SCHEMA`, `ITEM_SALES_DATASET_SCHEMA`.
- `validator.js` — `DATASET_VALIDATION_RULES`, `validateDailyDataset(record)`, `validateItemDataset(record)`.
- `mapper.js` — `DAILY_SALES_FIELD_MAPPING`, `ITEM_SALES_FIELD_MAPPING`.
- `preview.js` — `generateDatasetPreview(date,db)`, `printDatasetPreview(date)`.
- `transport/googleSheets.js` — `DEFAULT_BATCH_SIZE=25`, `DEFAULT_MAX_RETRIES=5`, `SPREADSHEET_NAME='Rongdhonu_ML_Dataset'`; `optimizePayloadForTransport`, `buildBatchPayload`, `transmitBatchToGoogleSheets(webappUrl,batchPayload,opts)`, `processStructuredTransportResponse(db,records,result)`.

DB side: `enqueueAIDatasetExport(date)` + `processAIDatasetQueue()` (local-only tables, never pushed to Firestore).

---

## 16. SCRIPTS

| Script | Purpose |
|---|---|
| `select-credentials.js` | Copies `credentials/android/credentials.{profile}.json` → `credentials.json` for a build profile (`admin\|owner\|manager`). |
| `googleAppsScript_Production.js` | Google Apps Script `doPost(e)` web app — receives batched AI dataset payloads and writes rows to Google Sheets (`Rongdhonu_ML_Dataset`), validates payload shape, detailed diagnostics. Deployed as Web App (Execute as Me, Anyone). |
| `googleAppsScript_Weather.js` | Google Apps Script weather endpoint used by `EXPO_PUBLIC_WEATHER_WEBAPP_URL`. |
| `fetch-original-passwords.js` | Migration helper to fetch original user passwords/PINs. |
| `firestore-sync-audit.js` | Audits Firestore sync state/consistency. |
| `runLiveHttpAudit.js` | Live HTTP audit against Firestore/backend endpoints. |

---

## 17. BUILD CONFIGURATION & CREDENTIALS

**`app.config.js`** — dynamic Expo config:
- Validates `EXPO_PUBLIC_APP_PROFILE ∈ {ADMIN,OWNER,MANAGER}`.
- Per-profile `name`, `slug` (`temp-expo`), package/bundle IDs, channel, icon/splash (with `./image/mylogo.png` fallback).
- Version `1.0.7`, `runtimeVersion '1.0.0'`, EAS Update URL + channel.
- Plugins: `expo-splash-screen`, `expo-sharing`, `expo-sqlite`, `react-native-thermal-printer-driver`.
- Syncs matching `credentials/android/credentials.{profile}.json` → `credentials.json` at build time.
- ADMIN package **`com.riajulshakib.rongdhonu`** is preserved so production installs update seamlessly.

**`eas.json`** — build profiles:
- `development` (dev client), `admin`, `owner`, `manager` (each `production` environment, `buildType apk`, `credentialsSource local`), `production`, `submit.production`.
- Each profile injects the full `EXPO_PUBLIC_*` env set (Firebase + Supabase + Apps Script URLs + `EXPO_PUBLIC_AI_DATASET_ENABLED`).

**npm scripts:** `start`, `android`, `ios`, `web`, `build:admin:local`, `build:owner:local`, `build:manager:local`, `build:apk`, `build:previe`, plus one `test:*` per subsystem and `test:all`.

---

## 18. TESTS INVENTORY

Node-based tests (`node tests/<file>.js`). Grouped:

**Data/pipeline core:** `builder`, `validator`, `mapper`, `queue`, `transport`, `e2ePipeline`, `activityLogger`, `sameDayResync`, `adminDashboardMerge`, `deliveryChargePersistence`, `deliveryBill`, `historicalDataRouting`, `operationalBackfill`, `dualCloudSyncDispatcher`, `syncQueueDualPreparation`.

**Supabase:** `supabaseDeviceControl`, `supabaseAuthFoundation`, `supabasePhase1BAdminRpc`, `supabasePhase2OAuthVerification`, `supabasePrimarySync`, `supabaseRetention31Day`, `supabaseSecurityHardening`, `initialRestoreSupabase31Day`.

**Firebase/version:** `firebaseAuth`, `forceLogoutAndMetadataSync`.

**Printer:** `printerManager`, `printerService`, `printerConnectionFlow`, `printerSettingsButtonStates`, `printerAcceptanceDiagnostics`, `bluetoothDetectionTest`, `thermalPrinterCompatibilityProof`, `nativeReceiptPipelineProof`, `auditPrinterProof`.

**Reports/UI redesign:** `salesReportRedesign`, `depositReportRedesign`, `pastAccountModalRedesign`, `ownerDashboardLayout`, `appUsageTracker`, `pdfHelper`, `menuRealtimeConsistency`, `menuReorderSortOrder`, `permanentMenuData`, `managerLoginValidation`, `backupRestore`.

---

## 19. KEY FLOWS END-TO-END

**App launch:**
`index.js` → `App` mounts → `useEffect` → `initDatabase()` → version check `checkAppVersionPolicy()` (non-admin) → device access `verifyDeviceAccessOnStartupOrResume()` → `registerDeviceIfNeeded()` + `startDevicePresence()` → start sync daemon → `LOGIN`.

**Order creation & payment:**
`DASHBOARD` → table tap → `TABLE_DETAIL` → `ADD_ITEM` → items saved via `updateTableState()` (SQLite + enqueueSync) → `PAYMENT_CHECKOUT` → methods/split captured → `PAYMENT_SUCCESS` → `addCompletedOrder()` + `calculateAndSaveDailySummary()` → optional `printReceipt()` → back to `DASHBOARD`.

**EOD submit:**
`DAILY_SUBMIT` → `submitDailySheet(summary, by, type)` (locks today, computes ijara) → `enqueueSync('daily_submit', date, 'INSERT')` → `syncRecordImmediately()` → Firestore (with `daily_submit_priority` conflict resolution).

**Admin device approve:**
`DEVICE_MANAGEMENT` → `updateDeviceStatus(id,'ACTIVE')` → Supabase `update` → Realtime CDC → pending device `onRemoteCommand` → login proceeds.

**Admin force logout:**
`triggerForceLogout(id)` → Supabase `force_logout=true` + token → device receives via `postgres_changes` (<300 ms) or 1 s poll → `checkAndExecuteForceLogout()` → session cleared → `clearForceLogoutIfMatching()` ack.

---

## 20. ERROR HANDLING, TIMEOUTS & RETRIES

| Mechanism | Value |
|---|---|
| Firebase auth fetch timeout | 10 s (`NETWORK_TIMEOUT_MS`) |
| `runAutoPull` watchdog | 25 s (`AUTO_PULL_HANG_MS`) |
| `processSyncQueue` watchdog | 4 s (logs hang; does not abort) |
| Failed queue backoff | `min(10 min, 2^retry × 30 s)` |
| HTTP 401 (any Firestore call) | invalidate token → retry once |
| Offline push/pull | skipped; retried next tick |
| Supabase failure | `safeSupabaseCall` returns fallback; never blocks POS |
| Force-logout check watchdog | 20 s (releases stuck lock) |
| Unfinished initial restore | detected next cold start via `restore_in_progress` flag |

---

## 21. CRITICAL RULES & GOTCHAS

1. **Never use a Firebase SDK** — all Firestore is raw REST `fetch()`.
2. **Firebase tokens must never enter `sync_queue`** — `enqueueSync()` + `processSyncQueue()` enforce `isAuthCredentialKey` guards. Tokens are stored via **direct SQL** only.
3. **Local-only tables** must never be enqueued: `ai_dataset_queue`, `ai_dataset_history`, `weather_timeline_queue`.
4. **`ACTIVE_APP_PROFILE` is compile-time**; a Manager APK can never act as Admin.
5. **ADMIN profile is exempt from version gating.**
6. **Supabase = device control only.** POS data must stay on Firestore.
7. **`fetchSupabaseDevices()` is ADMIN-only** — other callers receive `[]` (client-side security block, not server-side yet).
8. **`deletions` live in the Firestore `app_config` collection** as tombstones (rows with `table_name`), routed back to the local `deletions` table on pull.
9. **`daily_submit` conflict resolution** uses `daily_submit_priority` (higher remote priority wins; local upload skipped).
10. **`restaurant_tables` accepts only** `table_1`…`table_8` on pull.
11. **Delta pull overlap** subtracts 60 s to survive eventual consistency.
12. **RLS is currently permissive** (`USING(true)`); the production RPC/RBAC plan in `RLS_IMPLEMENTATION_PLAN.md` is **not yet deployed** — do not claim server-side protection.
13. **Schema Guardian** — pull-merge only inserts columns that exist locally (`PRAGMA table_info`).
14. **Business date** = Dhaka time with **06:00 AM cutoff** (`getBusinessDate`, `getDhakaBusinessDate`).
15. **Biometrics** (`expo-local-authentication`) gate owner/admin actions.

---

*End of master documentation. For deep code-accuracy on a specific subsystem, cross-reference `ARCHITECTURE_CURRENT_STATE.md` (line-numbered claims) and the source files cited above.*
