# RONGDHONU POS — CURRENT ARCHITECTURE STATE

> **Purpose:** Literal, code-accurate snapshot of the app's architecture as of September 2026.  
> This document is the **baseline** for designing a Firebase + Supabase dual-DB migration.  
> Every claim is backed by file + line references.

---

## Table of Contents
1. [Firebase Setup](#1-firebase-setup)
2. [Sync System (current, exactly as it runs)](#2-sync-system)
3. [Device Control System (Supabase-only)](#3-device-control-system)
4. [Version Control System (Firebase-only)](#4-version-control-system)
5. [Menu Items & Tables Data](#5-menu-items--tables-data)
6. [Failure / Error Handling](#6-failure--error-handling)
7. [The 3 Apps — Admin / Manager / Owner](#7-the-3-apps)

---

## 1. Firebase Setup

### 1.1 SDK Used — REST API Only (No Firebase JS SDK)

The app does **not** use `firebase` npm package or any Firebase SDK. Every Firestore call is a raw `fetch()` call against the **Firestore REST API v1**.

| Endpoint pattern | Usage |
|---|---|
| `https://firestore.googleapis.com/v1/projects/{projectId}/databases/(default)/documents/{collection}/{docId}` | GET, PATCH, DELETE single doc |
| `https://firestore.googleapis.com/v1/projects/{projectId}/databases/(default)/documents:runQuery` | Structured query (delta sync) |
| `https://firestore.googleapis.com/v1/projects/{projectId}/databases/(default)/documents/{collection}?pageSize=300` | Full collection fetch (restore) |
| `https://identitytoolkit.googleapis.com/v1/accounts:signUp` | Anonymous token mint |
| `https://securetoken.googleapis.com/v1/token` | Token refresh |

**Config source:** Environment variables — `EXPO_PUBLIC_FIREBASE_PROJECT_ID` and `EXPO_PUBLIC_FIREBASE_API_KEY`, read and sanitized in:
- [`database.js` L65–L71](database.js#L65-L71) — `cleanEnvVar()`
- [`services/firebaseAuth.js` L60–L63](services/firebaseAuth.js#L60-L63) — `getFirebaseAuthConfig()`

### 1.2 Firebase Project Collections

The following collections exist in Firestore (`(default)` database). Each maps 1:1 to a SQLite table of the same name:

| Firestore Collection | Primary Key | Key Fields (SQLite schema) |
|---|---|---|
| `users` | `id` | username, pin, role, display_name, created_at, updated_at |
| `restaurant_tables` | `id` (table_1…table_8) | table_id, table_name, status, items (JSON), startTime |
| `orders` | `id` | table_id, items, subtotal, discount, delivery_charge, cash_amount, bkash_amount, nagad_amount, rocket_amount, due_amount, grand_total, payment_status, payment_method, time, created_at, updated_at, locked_at |
| `order_items` | `id` | order_id, itemName, quantity, unit_price, revenue |
| `payments` | `id` | order_id, total_amount, customer_paid, discount_amount, cash_amount, bkash_amount, nagad_amount, rocket_amount, due_amount, payment_method, payment_status, paid_at |
| `expenses` | `id` | category, amount, note, is_due, given_amount, used_amount, returned_amount |
| `deliveries` | `id` | customer_name, amount, status, items (JSON), startTime, delivery_charge, created_at, completed_at |
| `daily_submit` | `date` (YYYY-MM-DD) | total_sell, cash_payment, bkash_payment, nagad_payment, rocket_payment, delivery_sell, delivery_charge, eja, dudu_store, akash_murgi, burger_bun, bazar, others, total_expense, net_cash, net_deposit, notes, submitted_by, is_locked, submission_type |
| `daily_summary` | `date` (YYYY-MM-DD) | dayOfWeek, totalOrders, totalSales, totalDiscount, totalExpense, totalDelivery, cashTotal, bkashTotal, nagadTotal, rocketTotal, itemSummary (JSON), peakHour, weather fields |
| `menu_categories` | `id` | name |
| `menu_items` | `id` | name, price, category, UNIQUE(name, category) |
| `due_payments` | `id` | customer_name, amount, order_id, status |
| `eja_history` | `id` | date, eja_amount |
| `off_days` | `id` | date, created_by, reason, status |
| `weather_data` | `id` | date, temperature, humidity, condition, isRainy, windSpeed |
| `supplier_due` | `id` | supplier_name, current_due, note |
| `supplier_due_history` | `id` | date, supplier_id, supplier_name, previous_due, purchase_amount, payment_amount, current_due |
| `supplier_payment_ledger` | `id` (`spl_YYYY-MM-DD`) | payment_date, month, year, variety_store_amount, morgir_dokan_amount, burger_ban_amount |
| `app_config` | `key` | value — stores version policy **and** deletion tombstones (dual use) |
| `daily_submit_priority` | `business_date` | submitted_by, role, priority, sync_source_device |
| `owner_employees` | `id` | name, phone, designation, monthly_salary, joining_date, status |
| `owner_salary_ledger` | `id` | employee_id, amount, payment_type, payment_date |
| `owner_expenses` | `id` | category, amount, expense_date, notes |
| `owner_deposits` | `id` | month, amount |
| `owner_home_deposits` | `id` | amount, deposit_date, notes |
| `delete_history` | `id` | record_type, record_id, deleted_by, deleted_at, snapshot_data |
| `activity_logs` | `id` | business_date, timestamp, action_type, action_title, app_profile, user_role, device_id, metadata |
| `deletions` | `id` | table_name, record_id — **tombstone** stored inside `app_config` collection in Firestore (not a separate collection) |

> **Note on `deletions`:** In Firestore, deletion tombstones are written to the `app_config` collection with `table_name` and `record_id` fields. On pull, the sync engine detects these rows (they have `table_name` set) and routes them to the local `deletions` SQLite table. See [`database.js` L2053–L2084](database.js#L2053-L2084).

### 1.3 Firebase Authentication

**Method: Firebase Anonymous Authentication via REST**

Implemented entirely in [`services/firebaseAuth.js`](services/firebaseAuth.js).

**Flow:**
1. On first Firestore call, `getFirestoreAuthHeaders()` checks SQLite `app_config` for cached tokens: `_fb_auth_id_token`, `_fb_auth_refresh_token`, `_fb_auth_expires_at`, `_fb_auth_uid` ([L74–L92](services/firebaseAuth.js#L74-L92)).
2. If token exists and has >5 minutes life → reuse immediately ([L297–L303](services/firebaseAuth.js#L297-L303)).
3. If expired but refresh token exists → call `securetoken.googleapis.com/v1/token` ([L231–L266](services/firebaseAuth.js#L231-L266)).
4. If `INVALID_REFRESH_TOKEN` / HTTP 400 → clear stored credentials, perform fresh anonymous `accounts:signUp` ([L330–L353](services/firebaseAuth.js#L330-L353)).
5. If no credentials at all → `accounts:signUp` ([L361–L377](services/firebaseAuth.js#L361-L377)).
6. All tokens saved to SQLite via **direct SQL** (not `setAppConfig`/`enqueueSync`) to guarantee zero sync leakage ([L104–L135](services/firebaseAuth.js#L104-L135)).
7. A **concurrency mutex** (`authPromiseInProgress`) deduplicates parallel refresh calls ([L280–L284](services/firebaseAuth.js#L280-L284)).
8. Network timeout: **10 seconds** per request ([L29](services/firebaseAuth.js#L29)).
9. On HTTP 401 from Firestore → `invalidateCurrentToken()` → retry once with fresh token ([`database.js` L1673–L1678](database.js#L1673-L1678)).

**App-level user login** is PIN-based (SQLite `users` table), completely separate from Firebase auth. Firebase anonymous auth is purely a machine-to-Firestore transport credential.

---

## 2. Sync System

### 2.1 Architecture Overview

```
App writes → SQLite (local) → sync_queue (PENDING) → [5s daemon] → Firestore REST API
Firestore  → [polling timers] → SQLite (local) → UI refresh
```

The architecture is **offline-first**: every write goes to SQLite first, then a background queue pushes to Firestore asynchronously.

### 2.2 SQLite Local Storage — Full Schema

SQLite database file: `rongdhonu.db` (via `expo-sqlite`, opened with `SQLite.openDatabaseSync` at [`database.js` L23](database.js#L23)).

**All 33 tables:**

| Table | Primary Key | Purpose |
|---|---|---|
| `users` | `id` | User accounts (PIN auth) |
| `restaurant_tables` | `id` | 8 fixed restaurant tables |
| `orders` | `id` | Completed orders |
| `order_items` | `id` | Line items per order |
| `payments` | `id` | Payment records |
| `expenses` | `id` | Daily operational expenses |
| `deliveries` | `id` | Delivery orders |
| `daily_submit` | `id` (= date) | Manager's daily EOD submission |
| `daily_summary` | `id` (= date) | Computed daily analytics |
| `menu_categories` | `id` | Menu category list |
| `menu_items` | `id` | Menu items; UNIQUE(name, category) |
| `due_payments` | `id` | Outstanding customer dues |
| `eja_history` | `id` | Ijara (rent) payment history |
| `off_days` | `id` | Restaurant closure days |
| `weather_data` | `id` | Daily weather records (API-fetched) |
| `sync_queue` | `id` (AUTOINCREMENT) | Outbound write queue |
| `notifications` | `id` | In-app notifications |
| `app_config` | `id` | Key-value config store (also holds Firebase auth tokens, sync markers) |
| `ai_dataset_history` | `id` | AI export log (local-only, never synced) |
| `ai_dataset_queue` | `id` | AI export queue (local-only, never synced) |
| `supplier_due` | `id` | Supplier current balance |
| `supplier_due_history` | `id` | Per-transaction supplier ledger |
| `supplier_payment_ledger` | `id` | Monthly supplier payment summary |
| `deletions` | `id` | Local cache of remote deletion tombstones |
| `delete_history` | `id` | Audit log of admin-initiated deletes |
| `history_download_log` | `id` (AUTOINCREMENT) | Rate-limiting for historical data downloads |
| `daily_submit_priority` | `business_date` | Priority metadata for daily submit conflict resolution |
| `owner_employees` | `id` | Employee records (owner profile only) |
| `owner_salary_ledger` | `id` | Salary payment records |
| `owner_expenses` | `id` | Owner-side expense records |
| `owner_deposits` | `id` | Monthly owner bank deposits |
| `owner_home_deposits` | `id` | Owner home deposit records |
| `activity_logs` | `id` | Full audit trail of all user actions |
| `device_registry` | `id` | Local mirror of Supabase `devices` table |

**`is_synced` column:** All data tables carry `is_synced INTEGER DEFAULT 0`. Set to `1` after successful push to Firestore ([`database.js` L1797–L1802](database.js#L1797-L1802)).

**`sync_queue` schema:**
```sql
CREATE TABLE sync_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id TEXT,
  table_name TEXT,
  action TEXT,       -- 'INSERT', 'UPDATE', 'DELETE'
  status TEXT DEFAULT 'PENDING',  -- 'PENDING', 'SUCCESS', 'FAILED'
  created_at TEXT,
  retry_count INTEGER DEFAULT 0,
  last_error TEXT,
  last_attempt_at TEXT
);
```

### 2.3 Push Logic — Exact Write Flow

**Step 1: Local write + enqueue** (every write operation)

```js
// Example: addCompletedOrder() in database.js
db.runSync("INSERT INTO orders ...", [...values]);
enqueueSync("orders", orderId, "INSERT");
```

**`enqueueSync(tableName, recordId, action)`** at [`database.js` L1288–L1312](database.js#L1288-L1312):
1. Security guard: never enqueue `_fb_auth_*` keys.
2. Guard: never enqueue `ai_dataset_queue`, `ai_dataset_history`, `weather_timeline_queue` (local-only tables).
3. **Idempotent:** `DELETE FROM sync_queue WHERE record_id=? AND table_name=? AND status='PENDING'` — removes any existing pending entry for this record.
4. Inserts fresh `PENDING` row.

**Step 2: Background daemon fires every 5 seconds**

```js
// database.js L1491-L1517 — startSyncService()
syncIntervalId = setInterval(async () => {
  if (AppState.currentState !== 'active') return;  // skip if backgrounded
  if (isProcessingSyncQueue) return;               // skip if already running
  await processSyncQueue();
}, 5000);
```

**Step 3: `processSyncQueue()`** at [`database.js` L1520–L1852](database.js#L1520-L1852):
1. Skip if sync is paused or system is offline.
2. Fetch up to **20 PENDING** items first, then up to **20 FAILED** items (subject to exponential backoff).
3. **Backoff for FAILED items:** `min(10min, 2^retryCount × 30s)` — at [`database.js` L1344–L1356](database.js#L1344-L1356).
4. For each item:
   - Get fresh auth headers (`getFirestoreAuthHeaders()`).
   - If `DELETE`: `fetch(url, { method: 'DELETE' })`.
   - If `INSERT`/`UPDATE`: read row from SQLite → convert to Firestore document format (`toFirestoreDocument()`) → `fetch(url, { method: 'PATCH' })`.
   - **Special case for `daily_submit`:** Before pushing, fetches `daily_submit_priority` from Firestore to check if remote priority is higher. If yes, skips upload ([L1729–L1762](database.js#L1729-L1762)).
5. On HTTP 401: invalidate token → retry once with fresh token.
6. On success: delete from `sync_queue`, update `is_synced = 1`.
7. On HTTP 403: mark `FAILED`, log error.
8. On other error: mark `FAILED`, log error.

**Firestore document format:** [`toFirestoreDocument()` at L1315–L1333](database.js#L1315-L1333) — converts JS flat object to Firestore typed field map (`{ stringValue }`, `{ doubleValue }`, `{ booleanValue }`). The `is_synced` column is excluded.

### 2.4 Delta Pull Logic — How the App Detects "What Changed"

**Mechanism: `updated_at` cursor stored per-collection in SQLite `app_config`.**

Key: `last_sync_time_{tableName}` → value: ISO timestamp of the last successful pull.

**`fetchChangedRecordsFromFirestore(collection, lastSyncTime)`** at [`database.js` L1884–L1956](database.js#L1884-L1956):

```js
// Firestore structured query
{
  structuredQuery: {
    from: [{ collectionId: collectionName }],
    where: {
      fieldFilter: {
        field: { fieldPath: "updated_at" },
        op: "GREATER_THAN",
        value: { stringValue: lastSyncTime }
      }
    }
  }
}
```

**`syncCollections(collectionsList)`** at [`database.js` L1957–L2226](database.js#L1957-L2226) — full delta sync loop:
1. Read `last_sync_time_{table}` from `app_config`.
2. **Overlap safety:** subtract **60 seconds** from marker to guard against eventual consistency gaps.
3. If no marker → full collection fetch (`fetchCollection()` with pagination, pageSize=300).
4. For each returned doc:
   - If `table === 'restaurant_tables'`: only accept IDs `table_1`…`table_8`.
   - Compare cloud `updated_at` vs local `updated_at`. Only write if cloud is newer.
   - If local row has `is_synced=0` (pending local edit) and cloud is not newer → skip (preserve local edit).
   - Use **Schema Guardian:** read `PRAGMA table_info(table)` and only insert columns that exist locally.
   - `INSERT OR REPLACE INTO {table} (..., is_synced) VALUES (..., 1)`.
5. Advance cursor: `max(current marker, max updated_at of received docs)`, but never advance past `queryStartTime - 15s`.

### 2.5 Pull Polling Intervals — Exact Current Values

All intervals are set in [`App.js`](App.js) via `setInterval` inside `useEffect([isLoggedIn])`:

| Timer Name | Interval | Function | Collections Synced |
|---|---|---|---|
| `queue-push-daemon` | **5 seconds** | `processSyncQueue()` | Push (sync_queue → Firestore) |
| `auto-tables-pull` | **15 seconds** | `syncTablesOnly()` | `restaurant_tables` |
| `auto-high-frequency-pull` | **30 seconds** | `syncHighFrequencyCollections()` | `orders`, `order_items`, `payments`, `deliveries` |
| `auto-deletions-pull` | **90 seconds** | `syncDeletionsOnly()` | `deletions` (→ `app_config` in Firestore) |
| `auto-low-frequency-pull` | **180 seconds (3 min)** | `syncLowFrequencyCollections()` | See table below |
| `menu` (manual/startup) | On-demand | `syncMenuOnly()` | `menu_items`, `menu_categories` |

**Low-frequency collections** (per `APP_PROFILES` at [`database.js` L2262–L2320](database.js#L2262-L2320)):

- **ADMIN/OWNER low-freq:** `users`, `daily_summary`, `due_payments`, `weather_data`, `off_days`, `app_config`, `expenses`, `eja_history`, `daily_submit`, `supplier_due`, `supplier_due_history`, `supplier_payment_ledger`, `delete_history`, `owner_employees`, `owner_salary_ledger`, `owner_expenses`, `owner_deposits`, `owner_home_deposits`
- **MANAGER low-freq:** `users`, `daily_summary`, `app_config`, `expenses`, `daily_submit`, `supplier_due`, `eja_history`

**Concurrency guards:** Each sync function has its own `isPullingSyncHigh / Low / Tables / Deletions` boolean flag. If a previous run is still active, the new tick is skipped silently ([`database.js` L2228–L2386](database.js#L2228-L2386)).

**Watchdog:** Each `runAutoPull` call sets a 25-second watchdog timer (`AUTO_PULL_HANG_MS`). If the sync function doesn't return within 25 seconds, the hang is logged to `syncRuntimeDiagnostics` ([`App.js` L8, L26–L29](App.js#L8-L29)).

### 2.6 Full-Restore Flow (Fresh Install / Manual Restore)

`restoreDatabaseFromCloud({ mode })` at [`database.js` L2497–L2644](database.js#L2497-L2644):

1. **Always Full tables** (full `pageSize=300` paginated fetch): `users`, `menu_categories`, `menu_items`, `restaurant_tables`, `app_config`, `supplier_due`, `owner_employees`, `owner_salary_ledger`, `owner_deposits`, `owner_home_deposits`.
2. **Recent Only tables** (last 31 days delta): `orders`, `order_items`, `payments`, `expenses`, `deliveries`, `daily_submit`, `daily_summary`, `due_payments`, `eja_history`, `off_days`, `weather_data`, `supplier_payment_ledger`, `owner_expenses`.
3. **Skip markers** (initialized to `now` to prevent subsequent background full-fetch):  
   - ADMIN/OWNER: `deletions`, `delete_history`, `supplier_due_history`  
   - MANAGER: additionally skips `due_payments`, `off_days`, `weather_data`, `supplier_payment_ledger`, `owner_employees`, `owner_salary_ledger`, `owner_expenses`, `owner_deposits`, `owner_home_deposits`
4. After restore, sync cursor (`last_sync_time_{table}`) is set to `restoreStartTime` for all fetched tables.

### 2.7 Same-Day Emergency Resync

`resyncSameDayFromCloud(targetDate)` at [`database.js` L2808–L3048](database.js#L2808-L3048):
- Rate-limited to **2 times per business day** (tracked in `app_config`).
- Fetches today's records from Firestore (window: midnight BD time − 2h buffer).
- Atomically wipes all local today-records, then re-inserts from cloud.

---

## 3. Device Control System (Supabase-only)

### 3.1 Confirmation: Is ANY Part in Firebase?

**100% Supabase only.** The old Firebase `device_registry` collection was fully decommissioned. Confirmed at:
- [`database.js` L2389–L2393](database.js#L2389-L2393) — `syncDeviceRegistry()` returns `false` immediately: *"Device Registry cloud sync has migrated to Supabase Realtime. Firestore sync for device_registry is fully decommissioned."*
- [`database.js` L2395–L2407](database.js#L2395-L2407) — `clearDeadQueueItems()` actively purges any `device_registry` entries from `sync_queue`.

### 3.2 Supabase Tables Schema

**Table: `public.devices`** ([`supabase_full_setup.sql` L25–L48](supabase_full_setup.sql#L25-L48)):

```sql
CREATE TABLE IF NOT EXISTS public.devices (
    device_id TEXT PRIMARY KEY,          -- e.g. 'android_abc123' or 'hw_xyz_samsung_galaxy'
    device_name TEXT,                    -- Human-readable name (admin can rename)
    manufacturer TEXT,
    brand TEXT,
    model TEXT,
    android_version TEXT,
    app_version TEXT,
    first_install_time TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING',   -- 'PENDING', 'ACTIVE', 'BLOCKED'
    allow_login BOOLEAN NOT NULL DEFAULT true,
    allow_offline BOOLEAN NOT NULL DEFAULT true,
    admin_lock BOOLEAN NOT NULL DEFAULT false, -- Stolen device / emergency lock
    force_logout BOOLEAN NOT NULL DEFAULT false,
    force_logout_token TEXT,             -- Unique revocation ID per force-logout command
    registered_by TEXT DEFAULT 'SYSTEM_AUTO',
    notes TEXT,
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    deleted_at TIMESTAMPTZ,
    deleted_by TEXT,
    last_seen_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
```

**Table: `public.device_app_usage`** ([`supabase_full_setup.sql` L84–L94](supabase_full_setup.sql#L84-L94)):
```sql
CREATE TABLE IF NOT EXISTS public.device_app_usage (
    id TEXT PRIMARY KEY,             -- '{device_id}_{business_date}_{role}'
    device_id TEXT NOT NULL,
    business_date TEXT NOT NULL,     -- YYYY-MM-DD
    role TEXT NOT NULL,              -- 'ADMIN', 'OWNER', 'MANAGER'
    app_label TEXT NOT NULL,
    total_seconds INTEGER NOT NULL DEFAULT 0,
    last_heartbeat TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
```

**Local SQLite mirror: `device_registry`** (schema in [`services/deviceRegistry.js` L304–L330](services/deviceRegistry.js#L304-L330)):
```sql
CREATE TABLE IF NOT EXISTS device_registry (
    id TEXT PRIMARY KEY,
    device_id TEXT UNIQUE NOT NULL,
    device_name TEXT,    manufacturer TEXT,    brand TEXT,    model TEXT,
    android_version TEXT,    app_version TEXT,    first_install_time TEXT,
    last_seen TEXT,
    allow_login INTEGER DEFAULT 0,
    allow_offline INTEGER DEFAULT 0,
    status TEXT DEFAULT 'PENDING',
    registered_by TEXT,    notes TEXT,
    created_at TEXT,    updated_at TEXT,
    is_synced INTEGER DEFAULT 0,
    admin_lock INTEGER DEFAULT 0,
    force_logout INTEGER DEFAULT 0,
    force_logout_token TEXT,
    is_deleted INTEGER DEFAULT 0,
    deleted_at TEXT,    deleted_by TEXT
);
```

### 3.3 Full Device Lifecycle Flow

**Step 1 — New Install: Device Registration**

`registerDeviceIfNeeded()` at [`services/deviceRegistry.js` L291–L502](services/deviceRegistry.js#L291-L502):

1. Generate persistent `device_id` via priority chain ([L156–L228](services/deviceRegistry.js#L156-L228)):
   - P1: `Application.getAndroidIdAsync()` → `android_{androidId}`
   - P2: Stored `persistent_device_id` in SQLite `app_config`
   - P3: Deterministic hash from `brand + model` → `hw_{hash}_{brand_model}`
   - P4: Last resort UUID `dev_uuid_{timestamp}_{random}`
2. Insert into `device_registry` with `status='PENDING'`, `allow_login=0`.
3. `upsertDeviceToSupabase(newRecord)` → HTTP `UPSERT` to `public.devices` with `onConflict: 'device_id'`.

**Step 2 — Startup Auth Check**

`verifyDeviceAccessOnStartupOrResume()` checks local `device_registry.status`:
- `admin_lock=1` → route to `DEVICE_BLOCKED` screen.
- `force_logout=1` → clear session, show force-reauth.
- MANAGER with `status='PENDING'` → route to `DEVICE_PENDING` screen.
- MANAGER with `status='BLOCKED'` → route to `DEVICE_BLOCKED` screen.
- ADMIN/OWNER: bypass device approval (always allowed unless `admin_lock=1` or `BLOCKED`).

**Step 3 — Admin Approves Device** (`updateDeviceStatus()` at [`services/deviceRegistry.js` L769–L830](services/deviceRegistry.js#L769-L830)):
1. `updateSupabaseDevice(deviceId, { status: 'ACTIVE', allow_login: true })` — pushes to Supabase first.
2. If Supabase push fails → return error; local SQLite is NOT updated.
3. If Supabase push succeeds → update local `device_registry`.
4. Pending device sees the status change via Supabase Realtime → `onRemoteCommand` callback → `handleLoginSuccess()`.

### 3.4 Realtime Active/Last-Active Tracking

**Two mechanisms run in parallel:**

**A. Supabase Realtime Presence (WebSocket, in-memory, zero DB writes)**

`startDevicePresence(deviceId, metadataProvider, onRemoteCommand)` at [`services/supabaseDeviceControl.js` L445–L614](services/supabaseDeviceControl.js#L445-L614):

- Subscribes to channel `rongdhonu_device_presence` using Supabase's Phoenix protocol.
- **Heartbeat interval: 25 seconds** (`KEEPALIVE_HEARTBEAT_MS = 25000`, [L17](services/supabaseDeviceControl.js#L17)).
- Each heartbeat calls `activePresenceChannel.track({ device_id, online: true, last_heartbeat: Date.now(), user_role, username })`.
- Stale threshold: **45 seconds** (`STALE_PRESENCE_TIMEOUT_MS = 45000`, [L16](services/supabaseDeviceControl.js#L16)). A device is considered offline if its `last_heartbeat` is older than 45s.
- Admin dashboard subscribes via `subscribeAdminDeviceMonitor()` to receive live presence updates.

**B. Throttled DB Persist (2-minute interval)**

Inside `trackCurrent()` ([L504–L508](services/supabaseDeviceControl.js#L504-L508)):
```js
if (now - lastDbPersistTime >= DB_HEARTBEAT_INTERVAL_MS) { // 120,000 ms
    updateSupabaseDevice(deviceId, { last_seen_at: new Date().toISOString() });
}
```
`DB_HEARTBEAT_INTERVAL_MS = 120000` (2 minutes) — actual `last_seen_at` column in `public.devices` is updated only every 2 minutes to avoid write overhead.

**C. Force Logout (Realtime instant + 60s safety poll, ALL roles)**

In [`App.js` L1102–L1143](App.js#L1102-L1143), a `setInterval(..., 60000)` timer runs while the user is logged in, plus an immediate check on every foreground resume — and Realtime delivers the command instantly:
- `checkAndExecuteForceLogout()` does a local check and, when called without a record, **one Supabase GET** of this device's row. *(The old 1-second variant was removed: it cost ~3,600 REST GET/hr/device for no added safety.)*
- Checks local `device_registry.force_logout` flag.
- If triggered: clears session, navigates to LOGIN, sets `forceReauthRequired=true`.

**D. Realtime Command Channel (`<300ms` latency)**

A `postgres_changes` subscription on `public.devices` filtered by `device_id` ([L562–L606](services/supabaseDeviceControl.js#L562-L606)):
```js
supabase.channel(`device_cmd:${deviceId}`)
  .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'devices', filter: `device_id=eq.${deviceId}` }, onRemoteCommand)
  .subscribe()
```
When Admin changes `force_logout=true` in Supabase, the device receives it sub-second via this channel.

### 3.5 Force Logout Implementation

**Admin triggers force logout** → [`updateSupabaseDevice(deviceId, { force_logout: true, force_logout_token: '...' })`](services/deviceRegistry.js).

**Device receives it via two paths (whichever fires first):**
1. **Realtime (`<300ms`):** Postgres change event → `onRemoteCommand(remoteRecord)` in [`App.js` L652–L678](App.js#L652-L678) → if `remoteRecord.force_logout === true` → `checkAndExecuteForceLogout()`.
2. **Polling (up to 1s lag):** The 1-second `setInterval` in [`App.js` L316](App.js#L316).

**`checkAndExecuteForceLogout()`** in [`services/deviceRegistry.js`]:
1. Reads local `device_registry` for `force_logout=1`.
2. If found → clears local session, sets `force_reauth_required=1` in `app_config`.
3. Calls `clearForceLogoutIfMatching(deviceId, timestamp, token)` → `UPDATE devices SET force_logout=false WHERE device_id=? AND force_logout_token=?` (uses token to avoid race conditions).

### 3.6 Supabase Client Configuration

[`services/supabaseClient.js`](services/supabaseClient.js):
- SDK: `@supabase/supabase-js`
- Config: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `persistSession: false`, `autoRefreshToken: false` — no Supabase auth session.
- RLS policy: currently **permissive** (`USING (true)`) — all `anon` clients can read/write any device row. Production RPC plan exists in schema SQL but is **not yet deployed**.

---

## 4. Version Control System (Firebase-only)

### 4.1 Where Version is Stored in Firebase

**Firestore collection: `app_config`, document: `global`.**

Fields in `app_config/global` ([`services/firebaseAppConfig.js` L134–L140](services/firebaseAppConfig.js#L134-L140)):

| Field | Type | Purpose |
|---|---|---|
| `minimum_required_version` | String | Minimum version allowed to run |
| `minimum_version` | String | Backward-compat alias |
| `latest_version` | String | Latest available version |
| `update_url` | String | Download URL |
| `force_update_enabled` | Boolean | Enable/disable forced blocking |
| `update_message` | String | Bengali message shown to user |
| `updated_at` | Timestamp | Last change time |

### 4.2 App Version Source

Set in `app.json` → `expo.version`. Read at [`services/firebaseAppConfig.js` L7–L11](services/firebaseAppConfig.js#L7-L11):
```js
const appJson = require('../app.json');
appVersion = appJson.expo?.version || '1.0.4';
export const APP_VERSION = appVersion;
```
Current version: **1.0.8** (from [`app.config.js` L78](app.config.js#L78)).

### 4.3 Login-Time Version Check — Exact Code Path

**On cold start** ([`App.js` L421–L434](App.js#L421-L434)):
```js
if (ACTIVE_APP_PROFILE !== 'ADMIN') {
  const verRes = await checkAppVersionPolicy(ACTIVE_APP_PROFILE);
  if (verRes.updateRequired) {
    setUpdatePolicy(verRes.policy);
    setCurrentScreen('APP_UPDATE_REQUIRED');
    return; // Block everything else
  }
}
```

**On foreground resume** ([`App.js` L753–L760](App.js#L753-L760)):
```js
const verPolicyRes = await checkAppVersionPolicy(effectiveCheckRole);
if (verPolicyRes.updateRequired) {
  setUpdatePolicy(verPolicyRes.policy);
  setCurrentScreen('APP_UPDATE_REQUIRED');
  return;
}
```

**`checkAppVersionPolicy(role)`** at [`services/firebaseAppConfig.js` L254–L303](services/firebaseAppConfig.js#L254-L303):
1. Calls `fetchVersionPolicy()` → GET `app_config/global` from Firestore.
2. Compares `APP_VERSION` against `minimum_required_version` using `compareSemver()`.
3. **ADMIN role is always exempt** (`adminExempt: true`, [L269–L281](services/firebaseAppConfig.js#L269-L281)).
4. If offline → uses `cached_version_policy` from SQLite `app_config`.
5. If `force_update_enabled && APP_VERSION < minimum_required_version` → `{ allowed: false, updateRequired: true }`.
6. Result is cached to SQLite `app_config` key `cached_version_policy`.

**What happens on mismatch:** `currentScreen` is set to `'APP_UPDATE_REQUIRED'`, which renders [`screens/AppUpdateRequiredScreen.js`](screens/AppUpdateRequiredScreen.js). The entire app is blocked behind this screen; no navigation is possible.

---

## 5. Menu Items & Tables Data

### 5.1 Menu Items

**Confirmed: 100% Firebase (Firestore).** Local SQLite is the working copy; Firestore is source of truth.

**Schema** (SQLite `menu_items` / Firestore `menu_items` collection):
```
id TEXT PRIMARY KEY
name TEXT                   -- Bengali item name (e.g. 'স্পেশাল বার্গার')
price REAL                  -- Price in BDT
category TEXT               -- e.g. 'বার্গার', 'ফ্রাই', 'ড্রিংকস'
created_at TEXT
updated_at TEXT
is_synced INTEGER DEFAULT 0
UNIQUE(name, category)      -- Compound uniqueness to prevent duplicates
```

**Default menu:** 56 pre-defined items across 8 categories (বার্গার, ফ্রাই, নুডুলস, চিকেন, রাইস, স্ন্যাকস, পিজ্জা, ড্রিংকস) — defined at [`database.js` L87–L162](database.js#L87-L162). Seeding is **disabled** (`seedDefaultMenu()` is commented out at [L1089](database.js#L1089)); the menu is populated only via cloud restore.

**Menu sync flow:**
- Menu is in the **low-frequency pull** (ADMIN/OWNER) at `syncMenuOnly()`.
- On restore: included in `alwaysFull` → full collection fetch.
- **Duplicate cleanup:** `cleanupDuplicateMenuItems()` runs at init time, detects duplicates by `LOWER(name)||LOWER(category)`, deletes from SQLite, and enqueues `DELETE` to Firestore.

### 5.2 Restaurant Tables

**Confirmed: 100% Firebase (Firestore).**

**Fixed 8 tables** (hardcoded in [`database.js` L1041–L1050](database.js#L1041-L1050)):

| ID | Display Name |
|---|---|
| `table_1` | T-1 |
| `table_2` | T-2 |
| `table_3` | T-3 |
| `table_4` | T-4 |
| `table_5` | কাচ |
| `table_6` | গাছ |
| `table_7` | বাহির |
| `table_8` | Extra |

**Schema:**
```
id TEXT PRIMARY KEY         -- 'table_1' … 'table_8'
table_id TEXT               -- Same as id
table_name TEXT             -- Display name
status TEXT                 -- 'FREE' or 'BUSY'
items TEXT                  -- JSON array of current order items
startTime TEXT              -- ISO timestamp when table became BUSY
created_at TEXT
updated_at TEXT
is_synced INTEGER DEFAULT 0
```

**Sync:** `restaurant_tables` is synced at the **15-second** interval (`auto-tables-pull`). On pull, only IDs `table_1`…`table_8` are accepted ([L2046–L2051](database.js#L2046-L2051)); any other ID is discarded.

---

## 6. Failure / Error Handling

### 6.1 Firebase Call Failures

**No circuit breaker exists.** Each failed sync item is marked `FAILED` in `sync_queue` and retried on the next daemon cycle with exponential backoff:

```js
// database.js L1344–L1348
function getFailedQueueRetryDelayMs(retryCount = 0) {
  return Math.min(10 * 60 * 1000, Math.pow(2, retryCount) * 30000);
  // retry 1: 30s, retry 2: 60s, retry 3: 120s ... max: 10min
}
```

**HTTP 403 (Permission Denied):** Marked `FAILED`, logged as `[Queue Audit] FAIL (403 Permission Denied)`. No special handling — will retry forever with backoff.

**HTTP 401:** Handled in-flight:
1. `invalidateCurrentToken()` (deletes `_fb_auth_id_token` from SQLite).
2. `getFirestoreAuthHeaders()` → triggers refresh/re-signup.
3. Retry the request once with fresh token.
If the retry also fails → mark `FAILED`.

**Network offline detection:** `setSystemOnline(false)` called from `NetInfo` listener in [`App.js`](App.js). When offline, `processSyncQueue()` returns immediately ([`database.js` L1552–L1555](database.js#L1552-L1555)).

**`lastSyncError` global:** Tracks the last sync failure message, exposed via `getLastSyncError()`.

### 6.2 Pull Failures

In `syncCollections()`:
- If `!success`: log warning, **skip cursor advancement** for that table. This means on the next poll it will re-attempt from the same timestamp.
- HTTP 403 on pull: treated as empty result (graceful) — cursor IS advanced to prevent infinite retry loops.
- Exceptions are caught at the collection level; a failure in one table does not block others.

### 6.3 Auth Failures

If `getFirestoreAuthHeaders()` fails (no API key, or signup fails after refresh):
- Push: all pending items in the current batch are marked `FAILED`.
- Pull: that collection's sync is skipped.
- No alert to the user; all failures are silent background logs.

### 6.4 Supabase Failures

All Supabase calls go through `safeSupabaseCall()` at [`services/supabaseClient.js` L58–L68](services/supabaseClient.js#L58-L68):
```js
export async function safeSupabaseCall(operationFn, fallbackValue = null) {
  if (!isSupabaseConfigured()) return fallbackValue;
  try {
    return await operationFn(supabaseInstance);
  } catch (err) {
    console.warn('[SupabaseClient] Suppressed background error:', err?.message);
    return fallbackValue;
  }
}
```
**Supabase errors are completely swallowed** and return the `fallbackValue`. POS operations are never blocked by Supabase failures.

### 6.5 Timeouts

| Mechanism | Timeout |
|---|---|
| Firebase auth request (fetch) | 10 seconds (`NETWORK_TIMEOUT_MS`) |
| Individual `runAutoPull` watchdog | 25 seconds (`AUTO_PULL_HANG_MS`) |
| `processSyncQueue` watchdog | 4 seconds (logs "hang" but does not abort) |
| Force-logout check watchdog | 20 seconds (releases stuck lock) |

### 6.6 Existing Retry Mechanisms Summary

| Scenario | Retry Mechanism |
|---|---|
| Failed sync_queue push | Exponential backoff (30s → max 10min) |
| HTTP 401 on any Firestore call | Immediate 1× retry with fresh token |
| Offline push attempt | Skipped; retried on next 5s daemon tick when online |
| Offline pull attempt | Skipped; retried on next poll interval |
| Supabase call failure | `safeSupabaseCall` returns null, no retry |
| Unfinished initial restore | Detected on next cold start via `restore_in_progress` flag |

---

## 7. The 3 Apps — Admin / Manager / Owner

### 7.1 Single Codebase, Profile-Based Builds

**One codebase, three separate APKs** built from the same source by setting `EXPO_PUBLIC_APP_PROFILE` at build time.

Profile is set in `app.config.js` ([L5–L14](app.config.js#L5-L14)) and produces three separate Android packages:

| Profile | Package Name | APK |
|---|---|---|
| `ADMIN` | `com.riajulshakib.rongdhonu` | `Admin.apk` |
| `OWNER` | `com.riajulshakib.rongdhonu.owner` | `owner.apk` |
| `MANAGER` | `com.riajulshakib.rongdhonu.manager` | `manager.apk` |

Credentials are per-profile in `credentials/android/credentials.{profile}.json`. The `app.config.js` build script copies the matching credentials to `credentials.json` at build time.

### 7.2 Where Role/App-Type is Determined

**Build-time constant:**
```js
// database.js L2260
export const ACTIVE_APP_PROFILE = String(process.env.EXPO_PUBLIC_APP_PROFILE || 'ADMIN').toUpperCase().trim();
```
This is a **compile-time constant** — it cannot change at runtime. A Manager APK is always `MANAGER`.

**Runtime user role** is determined at login:
- `verifyUserLogin(username, pin)` → reads local `users` table → returns `{ role: 'manager'|'owner'|'admin' }`.
- Profile guard at login: Manager APK rejects non-manager usernames ([`screens/LoginScreen.js` L159–L168](screens/LoginScreen.js#L159-L168)).
- `userRole` React state drives what UI is shown (`ManagerDashboard`, `OwnerDashboard`, or `AdminDB`).

### 7.3 Sync Differences Per Profile

Defined in `APP_PROFILES` at [`database.js` L2262–L2320](database.js#L2262-L2320):

| Feature | ADMIN | OWNER | MANAGER |
|---|---|---|---|
| High-freq pull | orders, order_items, payments, deliveries | Same | Same |
| Low-freq pull | Full set (all tables) | Full set | Reduced set (no owner_*, no off_days, no weather, no due_payments) |
| Device fleet fetch | Full fleet (`fetchSupabaseDevices()`) | Blocked | Single-device self-check only |
| Device Control screen | ✅ Full | ❌ | ❌ |
| `daily_submit` priority | 10 (lowest, can be overridden by Owner submit) | N/A | 10 |
| Restore: `alwaysFull` | All master tables | Same | Reduced (no owner_*) |
| Restore: `skipRestoreMarkers` | deletions, delete_history, supplier_due_history | Same | + due_payments, off_days, weather, supplier_payment_ledger, owner_* |

**Manager "running-day only" data:**
There is no explicit "only today's data" filter for Manager. The Manager app syncs the **same 31-day window** as Admin/Owner, but with fewer table types. The `recentOnly` tables for Manager are: `orders`, `order_items`, `payments`, `expenses`, `deliveries`, `daily_submit`, `daily_summary`, `eja_history` — no historical owner financial data.

### 7.4 Screen Routing by Role

In [`App.js`](App.js), after login success, the dashboard screen is set based on `userRole`:
- `'admin'` → `AdminDB` screen
- `'owner'` → `OwnerDashboard` screen  
- `'manager'` → `ManagerDashboard` screen

Both `OwnerDashboard` and `ManagerDashboard` share the same underlying `App.js` data layer (`tables`, `deliveries`, `menuItems`, `completedOrders`).

---

## Architecture Summary Diagram

```
┌────────────────────────────────────────────────────────────────────┐
│                         RONGDHONU POS APP                          │
│                    (Single Codebase / 3 APKs)                      │
├────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                    SQLite (rongdhonu.db)                      │  │
│  │  33 local tables · is_synced flag · sync_queue               │  │
│  │  app_config (sync cursors, auth tokens, version cache)       │  │
│  └───────────────────────────┬──────────────────────────────────┘  │
│                              │                                      │
│            ┌─────────────────┼─────────────────┐                   │
│            │                 │                 │                   │
│    ┌───────▼────────┐  ┌────▼──────────┐ ┌───▼──────────────┐    │
│    │  PUSH (5s)     │  │  PULL timers  │ │  Device Control  │    │
│    │ processSyncQueue│  │  15s/30s/     │ │  (Supabase)      │    │
│    │ → Firestore     │  │  90s/180s     │ │  Presence 25s    │    │
│    │   REST API      │  │  → Firestore  │ │  DB persist 2min │    │
│    │   (PATCH/DELETE)│  │   structured  │ │  CMD channel     │    │
│    └────────────────┘  │   query       │ │  <300ms latency  │    │
│                        └───────────────┘ └──────────────────┘    │
│                                                                    │
├────────────────────────────────────────────────────────────────────┤
│                          BACKEND SERVICES                          │
│                                                                    │
│   FIREBASE (Firestore REST API)          SUPABASE (PostgREST)      │
│   ─────────────────────────────          ──────────────────────    │
│   • All POS data (orders, menu,          • public.devices          │
│     tables, payments, expenses,          • public.device_app_usage │
│     daily_submit, users, etc.)           • Realtime presence       │
│   • app_config/global (version)          • Postgres CDC changes    │
│   • Anonymous auth tokens                                          │
│   • NO device control data              NO POS/order data here     │
└────────────────────────────────────────────────────────────────────┘
```

---

*Document generated: 2026-09-27. Based on full static analysis of the codebase at `/home/shakib/Downloads/rong`.*
