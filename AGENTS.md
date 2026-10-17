# AGENTS.md — Rongdhonu POS · Agent Guide & Full Setup

> **READ THIS FIRST (new agent / new session).**
> Single source of truth for understanding and working on this repo.
> **Project root:** `rong/` · **Next feature plan:** `rong/website.md` (online ordering — see §21).
> If anything here disagrees with the code, **trust the code** and update this file.
> Secrets (anon keys, audit read secret) intentionally live only in `eas.json` / `.env` — not here.

---

## 0. TL;DR / cheat-sheet

```bash
npm install                              # deps
npm run test:all                         # 72 node test scripts (must stay green)
export ANDROID_HOME="$HOME/Android/sdk"  # needed for LOCAL builds
npm run build:admin:local                # or build:owner:local / build:manager:local
graphify update .                        # rebuild the code graph after code changes
```

**The 6 rules that matter most**
1. **SQLite is the source of truth at runtime.** Every write goes to SQLite first.
2. **All cloud writes go through `enqueueSync()`** — never call Firebase/Supabase directly from a screen.
3. **Reads are Supabase-primary.** Firebase auto-read is OFF (`ALLOW_AUTO_FIREBASE_READ = false`).
4. **Device control is Supabase-only**, RLS-gated by `is_device_active(x-device-id)` on 27 POS tables.
5. **Never** use the Firebase SDK, **never** sync auth tokens, **never** enqueue local-only tables.
6. **Existing flows must not change** — features are added additively.

**3 APKs from one codebase:** `EXPO_PUBLIC_APP_PROFILE` = `ADMIN | OWNER | MANAGER`.

---

## 1. What this project is

**Rongdhonu Café & Restaurant POS** — an offline-first restaurant management system built with
**React Native 0.85.3 + Expo SDK 56 (JavaScript)**.

| Profile | App name | Android package | build script | output |
|---|---|---|---|---|
| `ADMIN` | রংধনু এডমিন | `com.riajulshakib.rongdhonu` | `npm run build:admin:local` | `Admin.apk` |
| `OWNER` | রংধনু ওনার | `com.riajulshakib.rongdhonu.owner` | `npm run build:owner:local` | `Owner.apk` |
| `MANAGER` | রংধনু ম্যানেজার | `com.riajulshakib.rongdhonu.manager` | `npm run build:manager:local` | `Manager.apk` |

- **App version:** `1.0.10` · Android **versionCode 13** (`app.json` = source of truth).
- **Expo name/slug:** `রংধনু` / `temp-expo`; owner `riajulshakib`; icon `./image/mylogo.png`.
- **Runtime roles:** `admin | owner | manager | waiter` (PIN login, local SQLite `users` table).
  Each build profile restricts which roles may log in (MANAGER build → manager only, etc.).
- **UI language:** Bengali; currency ৳; dark theme with gold accent `#FFB703`.
- `android/` is a **gitignored prebuild artifact** — never hand-edit versions there; edit `app.json`.

---

## 2. Tech stack

| Layer | Technology |
|---|---|
| Framework | React Native 0.85.3 + Expo SDK 56, JavaScript |
| Local DB | `expo-sqlite` (synchronous API), file `rongdhonu.db` |
| Cloud A (POS data) | **Firebase Firestore REST API v1** (raw `fetch`, no SDK) + anonymous auth |
| Cloud B (device control) | **Supabase** (`@supabase/supabase-js` v2) — PostgREST + Realtime |
| Cloud C (audit) | a **separate** Supabase project (activity stream only) |
| Printer | `react-native-thermal-printer-driver` (native TurboModule) |
| PDF | `expo-print` + `expo-sharing` |
| Receipt capture | `react-native-view-shot` (rasterise the receipt view) |
| Icons | `lucide-react-native` + `react-native-svg` |
| State | React hooks only (no Redux, **no navigation library**) |
| Build | EAS Build (`eas.json`); local = `eas build --local` |

**Cloud identifiers**
- Supabase main/POS ref: `gdqnfwccohxgaywzoysc` (`https://gdqnfwccohxgaywzoysc.supabase.co`)
- Supabase audit ref: `zdruassdewwjbexximkj`
- Firebase project: `rongdhonu-83b3d`
- EAS projectId: `c0ef37bc-f64e-4a5d-8f68-8296556b722a`

---

## 3. Quick start (fresh machine, step by step)

### 3.1 Prerequisites
- Node.js **18+ / 22**
- **JDK 17** (RN 0.85 requires 17; newer JDKs may fail)
- Android SDK + platform-tools (`adb`), `eas-cli`
- Python 3 (only for `tests/backupRestore.test.js`)

### 3.2 Install + env
```bash
npm install
cp example.env .env
# Fill in .env: Firebase keys/project, Supabase main URL+anon key,
# audit Supabase URL+anon key+read secret, Apps Script URLs.
```
> `eas.json` already injects every `EXPO_PUBLIC_*` value per build profile, so local `.env` matters mainly
> for `expo start` / running from source.

### 3.3 Android SDK for local builds
```bash
export ANDROID_HOME="$HOME/Android/sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
```
Or create `android/local.properties` with `sdk.dir=/home/<user>/Android/sdk`.

### 3.4 Build
```bash
npm run build:admin:local     # runs select-credentials.js admin + eas build --profile admin --local
npm run build:owner:local
npm run build:manager:local
```
- Signing: `credentials/android/` per-profile keystores + `credentials.<profile>.json` (gitignored).
  The npm script runs `node scripts/select-credentials.js <profile>` to copy the right credential JSON
  to `credentials.json` before the build.
- **Never lose the keystores** — in-place updates require the exact same signing key.
- Cloud build (no local SDK): `eas login && eas build -p android --profile <profile>`.

### 3.5 Verify the built APK
```bash
# which Supabase project URL is embedded?
unzip -p Manager.apk assets/index.android.bundle | grep -oaE 'https://[a-z0-9]+\.supabase\.co' | sort -u

# which Supabase project ref does the embedded anon key belong to?
unzip -p Manager.apk assets/index.android.bundle \
  | grep -oaE 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]+' \
  | cut -d. -f2 | while read -r p; do \
      pad=$(( (4 - ${#p} % 4) % 4 )); p="$p$(printf '%*s' $pad | tr ' ' '=')"; \
      echo "$p" | base64 -d 2>/dev/null | tr ',' '\n' | grep '"ref"'; done | sort | uniq -c

# signer fingerprint
apksigner verify --print-certs Manager.apk | grep -E 'SHA-1|SHA-256'
```
Use this when a device behaves oddly: it proves whether the APK bundles the **correct** project URL
(`gdqnfwccohxgaywzoysc`) + a **matching** anon key.

### 3.6 Troubleshooting
| Symptom | Cause / fix |
|---|---|
| `SDK location not found` | `ANDROID_HOME` not exported (or missing `android/local.properties`) |
| Gradle fails on `jvmTarget` / records | wrong JDK — use **17** |
| `App installation failed … signatures do not match` (error `-7`) | wrong keystore for that profile; rebuild with the right one. **Never uninstall production** (wipes local SQLite) |
| Build succeeds but app hits the wrong project | check with §3.5 |
| Changes not visible on the phone | the APK is a **build artifact** — JS edits require a rebuild + reinstall |

---

## 4. Directory structure

```
rong/
├── App.js                      # root component: custom string router + all app state + sync orchestration
├── index.js                    # registerRootComponent(App)
├── database.js                 # SQLite schema + ~180 data/sync functions (~7.9k lines)
├── app.json / app.config.js    # Expo config; dynamic per-profile config; version lives here
├── eas.json                    # EAS build profiles + per-profile EXPO_PUBLIC_* env
├── pdfHelper.js                # PDF report generation + sharing
├── printer-test.js             # standalone (desktop) printer pipeline diagnostic
├── website.md                  # PLAN: online-ordering website (not implemented)
├── AGENTS.md                   # THIS FILE
├── components/                 # 15 shared UI components
├── screens/                    # 41 screens
├── services/                   # 25 root services + printer/ (7) + aiDataset/ (7)
├── scripts/                    # 6 build/audit/Apps Script utilities
├── tests/                      # 72 plain-node test scripts
├── docs/                       # 5 signing/feature docs
├── supabase_*.sql              # schema / RLS / cron / audit helpers
├── assets/ image/              # icons, splash, fonts, logos
├── credentials/                # Android keystores + per-profile credential JSON (gitignored)
├── graphify-out/               # code knowledge graph (untracked)
└── android/                    # Expo prebuild (gitignored)
```

Typical `screens/` size ~1.4 MB, `tests/` ~1.1 MB, `database.js` ~308 KB, `App.js` ~188 KB.

---

## 5. Architecture

### 5.1 Navigation (no router library)
`App.js` keeps a `currentScreen` **string** and a `renderScreen()` `switch`. Screens receive
`onBack` / `onNavigateTo*` callbacks. `BackHandler` handles Android hardware back via a hardcoded
`subScreens` list. Several cases are **role/profile guarded** and `return null` when unauthorized
(e.g. `ADMIN_ANALYTICS`, `SYNC_DIAGNOSTICS`) — follow that pattern for any new admin-only screen.

**Gate screens (checked before the main switch, `App.js` ~2758–2870):**
`APP_UPDATE_REQUIRED` → `LOGIN` → `OFFLINE_VERIFICATION` → `DEVICE_BLOCKED` → `DEVICE_PENDING` →
`INITIAL_DATA_FAILED`, then `DASHBOARD`.

**Full route map** (`case` key in `renderScreen()` → screen):

| Route key | Renders | Notes |
|---|---|---|
| `DASHBOARD` | role-based | ADMIN+admin→`AdminDB`; ADMIN+owner / OWNER→`OwnerDashboard`; else `ManagerDashboard` |
| `TABLE_DETAIL` | `TableDetailScreen` | POS cart (extras + service charge live here) |
| `ADD_ITEM` | `AddItemScreen` | add menu item to a table |
| `EDIT_MENU` | `AddItemScreen` | same component, edit mode |
| `PAYMENT_CHECKOUT` | `PaymentCheckoutScreen` | |
| `PAYMENT_SUCCESS` | `PaymentSuccess` | |
| `DAILY_SUBMIT` | `DailySubmitScreen` | |
| `EXPENSES` | `ExpensesScreen` | |
| `SUPPLIER_DUE` | `SupplierDueScreen` | |
| `ITEM_SALES_REPORT` | `DailyItemSalesReport` | |
| `ADMIN_ANALYTICS` | `AdminAnalyticsScreen` (lazy `require`) | ADMIN/OWNER only |
| `SYNC_DIAGNOSTICS` | `SyncDiagnosticsScreen` | ADMIN only |
| `SYNC_STATUS` | `SyncStatusScreen` | |
| `SYNC_HEALTH` | `SyncHealthScreen` | |
| `DB_HEALTH` | `DatabaseHealthScreen` | |
| `DB_STATS` | `DatabaseStatsScreen` | |
| `DB_EXPLORER` | `DatabaseExplorerScreen` | |
| `TABLE_VIEWER` | `TableViewerScreen` | |
| `ROW_DETAIL` | `RowDetailScreen` | |
| `BACKUP_RESTORE` | `BackupRestoreScreen` | |
| `SYSTEM_TOOLS` | `SystemToolsScreen` | |
| `SYSTEM_INFO` | `SystemInfoScreen` | |
| `PRINTER_SETTINGS` | `PrinterSettingsScreen` | |
| `DEVICE_MANAGEMENT` | `DeviceManagementScreen` | ADMIN only |
| `DELETE_HISTORY` | `DeleteHistoryScreen` | |
| `ACTIVITY_LOG` | `ActivityLogScreen` | local + Firestore |
| `ACTIVITY_STREAM` | `ActivityStreamScreen` | remote audit diff stream |
| `AI_DATASET_MONITOR` | `AIDatasetMonitorScreen` | flagged |
| `AI_DATASET_AUDIT_CENTER` | `AIDatasetAuditCenterScreen` | flagged |
| `OWNER_FINANCE_DASHBOARD` | `OwnerFinanceDashboard` | |
| `OWNER_EXPENSE` | `OwnerExpenseScreen` | |
| `EMPLOYEE_LIST` | `EmployeeListScreen` | |
| `ADD_EMPLOYEE` | `AddEmployeeScreen` | |
| `EMPLOYEE_DETAIL` | `EmployeeDetailScreen` | |
| `ADD_SALARY_PAYMENT` | `AddSalaryPaymentScreen` | |

### 5.2 SQLite (local source of truth)
`database.js` `getDb()` opens `rongdhonu.db` synchronously with `PRAGMA foreign_keys = ON`. The exported
`db` is a **Proxy** that lazily opens the DB and sanitizes bind params (null→`""`, numbers→strings) to
dodge an expo-sqlite JNI bug. Schema lives in `TABLE_SCHEMAS` (`database.js` ~L204).

**Full schema (35 tables; `is_synced` on most rows means "already pushed"):**

```js
users                    // id PK, username UQ, pin, role, display_name, created_at, updated_at, is_synced
restaurant_tables        // id PK, table_id, table_name, status, items(JSON), startTime, +stamps
orders                   // id PK, table_id, items, subtotal, discount, delivery_charge,
                         //   change_money_given, cash/bkash/nagad/rocket_amount, due_amount,
                         //   grand_total, payment_status, payment_method, time, locked_at, +stamps
order_items              // id PK, order_id, itemName, quantity, unit_price, revenue, +stamps
payments                 // id PK, order_id, total_amount, customer_paid, discount_amount,
                         //   delivery_charge, change_money_given, cash/bkash/nagad/rocket_amount,
                         //   due_amount, payment_method, payment_status, paid_at, +stamps
expenses                 // id PK, category, amount, note, is_due, given/used/returned_amount, +stamps
deliveries               // id PK, customer_name, amount, status(BUSY|COMPLETED), items(JSON),
                         //   startTime, delivery_charge, change_money_given, completed_at, +stamps
daily_submit             // id PK (=YYYY-MM-DD), date UNIQUE, total_sell, cash/bkash/nagad/rocket_payment,
                         //   delivery_sell, delivery_charge, eja, dudu_store, akash_murgi, burger_bun,
                         //   bazar, others, total_expense, net_cash, net_deposit, notes, submitted_by,
                         //   submitted_at, is_locked, submission_type('MANUAL'|...), +stamps
daily_summary            // id PK (=date), date UQ, dayOfWeek, weekOfMonth, isFriday, isHoliday,
                         //   specialDayNote, temperature, humidity, condition, isRainy, windSpeed,
                         //   totalOrders, totalSales, totalDiscount, totalExpense, totalDelivery,
                         //   total_delivery_charge, averageOrderValue, peakHour, first/lastOrderTime,
                         //   cash/bkash/nagad/rocketTotal, ejaAmount, netCash, ownerDeposit,
                         //   itemSummary(JSON), +stamps
menu_categories          // id PK, name UNIQUE, +stamps
menu_items               // id PK, name, price, category, +stamps, UNIQUE(name, category)
due_payments             // id PK, customer_name, amount, order_id, status, +stamps
eja_history              // id PK, date, eja_amount, +stamps
off_days                 // id PK, date UNIQUE, created_by, reason, status, +stamps
weather_data             // id PK, date UNIQUE, temperature, humidity, condition, isRainy, windSpeed, +stamps
sync_queue               // id AUTOINC, record_id, table_name, action(INSERT|UPDATE|DELETE),
                         //   status(PENDING|SUCCESS|FAILED), retry_count, last_error, last_attempt_at
sync_queue_supabase      // same shape — Supabase push path (created at runtime, L~908)
notifications            // id PK, title, message, read, +stamps
app_config               // id PK, key UNIQUE, value, +stamps   <-- cursors, flags, version cache
ai_dataset_history       // id PK, date, type, exported_at, +stamps           (local-only)
ai_dataset_queue         // id PK, type, business_date, payload(JSON),
                         //   status(PENDING|IN_PROGRESS|SUCCESS|FAILED|RETRY), retry_count,
                         //   last_error, +stamps                               (local-only)
supplier_due             // id PK, supplier_name, current_due, note, +stamps
supplier_due_history     // id PK, date, supplier_id, supplier_name, previous_due, purchase_amount,
                         //   payment_amount, current_due, note, created_by, +stamps
supplier_payment_ledger  // id PK, payment_date UQ, month, year, variety_store_amount,
                         //   morgir_dokan_amount, burger_ban_amount, created_by, +stamps
deletions                // id PK (=tableName_recordId), table_name, record_id, +stamps
delete_history           // id PK, record_type, record_id, deleted_by, deleted_at, created_by,
                         //   original_created_at, snapshot_data, sync_status, +stamps
history_download_log     // id AUTOINC, report_type(ITEM_SALES|DEPOSIT_REPORT|MENU_RECOVERY),
                         //   requested_period, downloaded_at, downloaded_by
daily_submit_priority    // business_date PK, submitted_by, role, priority, sync_source_device,
                         //   device_id, submitted_at, +stamps
owner_employees          // id PK, name NOT NULL, phone, designation, monthly_salary NOT NULL,
                         //   joining_date, status('ACTIVE'), notes, +stamps
owner_salary_ledger      // id PK, employee_id FK→owner_employees ON DELETE CASCADE, amount,
                         //   payment_type, payment_date, notes, created_at, is_synced
owner_expenses           // id PK, category NOT NULL, amount NOT NULL, expense_date NOT NULL, notes, +stamps
owner_deposits           // id PK, month NOT NULL, amount NOT NULL, created_at, is_synced
owner_home_deposits      // id PK, amount NOT NULL, deposit_date NOT NULL, notes, +stamps
activity_logs            // id PK, business_date, timestamp, action_type, action_title, description,
                         //   app_profile, user_role, user_name, device_id/name/model/platform,
                         //   metadata, +stamps
audit_outbox             // id PK, created_at, business_date, app_profile, app_version, user_name,
                         //   user_role, device_* , table_name, action, record_id, changes, snapshot,
                         //   status('PENDING'), retry_count, last_error, sent_at
session_pull_notifications // id AUTOINC, timer_name, group_label, message, has_changes, row_count,
                         //   source, created_at          (also created again at L~1075)
```

Notes: `migrateMenuItemsTable()` (L~727) rebuilds `menu_items` to add `UNIQUE(name, category)` if an old
single-column UNIQUE is detected. `initDatabase` has a one-time `db_wiped_v2` reset gated by `app_config`.

### 5.3 Firebase (POS cloud, REST only)
- **No Firebase SDK.** Firestore REST v1 + Identity Toolkit (anonymous auth) + Secure Token refresh.
- Collections mirror SQLite tables (users, restaurant_tables, orders, order_items, payments, expenses,
  deliveries, daily_submit, daily_summary, menu_*, due_payments, eja_history, off_days, weather_data,
  supplier_*, app_config, daily_submit_priority, owner_*, delete_history, activity_logs).
- **`deletions` tombstones are stored in the Firestore `app_config` collection** (rows carrying
  `table_name`) and routed back into the local `deletions` table on pull.
- Auth tokens live in SQLite `app_config` (`_fb_auth_*`) written via **direct SQL** (never `setAppConfig`,
  never enqueued). On 401 → `invalidateCurrentToken()` → retry once.
- First sync without a cursor is bounded to **31 days** (`FIREBASE_FIRST_SYNC_DAYS`).

### 5.4 Supabase (device control + POS primary read)
**Tables (30):** `devices`, `device_app_usage`, `app_version_policy`, `sync_heartbeat` + 26 POS mirrors.
**RLS:** `is_device_active(current_setting('request.headers')->>'x-device-id')` on **27 POS tables**
(`supabase_rls.sql`). **Never gated:** `devices`, `device_app_usage`, `app_version_policy`, `sync_heartbeat`.
**Realtime:** presence `rongdhonu_device_presence` (25 s heartbeat, 45 s stale), command channel
`device_cmd:<deviceId>` (`postgres_changes` UPDATE), admin monitor, usage.
**Client:** `services/supabaseClient.js` sets `x-device-id` via `Headers.set()` (not bracket assignment)
and wraps every request in a **resilient fetch** (20 s AbortController timeout + 2 retries with backoff).
**Device access:** `services/deviceRegistry.js` — device-id priority Android ID → stored
`persistent_device_id` → brand/model hash → random UUID; register `PENDING` → admin approve/block/lock/
force-logout; **`allow_offline` is authoritative** (admin OFF ⇒ no offline; ADMIN role exempt).

### 5.5 Audit (Cloud C)
`services/auditClient.js` + `auditLog.js` → isolated Supabase project (`activity_events`, secret-gated
`audit_read` RPC, Broadcast `rongdhonu_audit_live`). Hooked fire-and-forget from `enqueueSync` via
`audit_outbox`.

### 5.6 PUSH (writes)
```
screen → SQLite → enqueueSync(table, id, action)          ← the ONLY dual-write choke point
                        ├─ Firebase  sync_queue          → 5 s daemon → Firestore REST PATCH/DELETE
                        └─ Supabase  sync_queue_supabase → 5 s daemon → PostgREST upsert/delete

syncRecordImmediately(table, id)  → both clouds in PARALLEL (used by checkout/carts/menu/submit)
```
- Daemons: `startSyncService()` (Firebase) + `startSupabaseSyncService()` (Supabase), both 5 s, all profiles.
- Backoff: `min(10 min, 2^retry × 30 s)`.
- Guards: `_fb_auth_*` never enqueued; local-only tables never enqueued; `app_config` is **Firebase-only**.
- Supabase queue marks `FAILED` on RLS/denial. `sync_heartbeat` records push/read per backend.
- `enqueueSync` for DELETEs intentionally does **not** reset `is_synced_supabase`.

### 5.7 PULL (reads)
Defined in `services/supabaseSync.js`. **Constants:**
```js
OVERLAP_MS       = 60000   // re-read window (clock drift / eventual consistency)
MARKER_SAFETY_MS = 15000   // never advance a cursor past queryStart - 15 s
PAGE_SIZE        = 1000    // PostgREST default max rows
PULL_TIMEOUT_MS  = EXPO_PUBLIC_SUPABASE_PULL_TIMEOUT_MS || 8000
RESTAURANT_TABLE_IDS = ['table_1' … 'table_8']   // pull accepts only these ids
LOW_FREQ_EXCLUDED    = ['app_config']            // Firebase-only
ALLOW_AUTO_FIREBASE_READ = false                 // OWNER POLICY
```

**`SIGNAL_GROUPS` (single source of truth for table→group, also consumed by `realtimeSignal.js`):**
```js
tables:    ['restaurant_tables']
high:      ['orders','order_items','payments','deliveries']
deletions: ['deletions']
daily:     ['daily_submit','daily_summary','daily_submit_priority','eja_history','expenses']
menu:      ['menu_items','menu_categories']
low:       ['users','due_payments','weather_data','off_days','supplier_due','supplier_due_history',
            'supplier_payment_ledger','delete_history','owner_employees','owner_salary_ledger',
            'owner_expenses','owner_deposits','owner_home_deposits']
```

**Intervals:** tables **5 s** (30 s when the Realtime signal is SUBSCRIBED), high **10 s** (30 s),
deletions **15 s** (30 s), low **60 s**, menu **300 s**. Firebase timers exist but are health-gated by
`runFirebasePullIfSupabaseDown()` in `App.js`.

**Per-profile read scope — `APP_PROFILES` in `database.js` (~L2525):**

| Profile | alwaysFull (never age-limited) | recentOnly (age-limited) | lowFreq additions |
|---|---|---|---|
| ADMIN | users, menu_categories, menu_items, restaurant_tables, app_config, supplier_due, owner_employees, owner_salary_ledger, owner_deposits, owner_home_deposits | orders, order_items, payments, expenses, deliveries, daily_submit, daily_summary, due_payments, eja_history, off_days, weather_data, supplier_payment_ledger, owner_expenses | see §5.7 list |
| OWNER | same as ADMIN | same as ADMIN | same as ADMIN (different order) |
| MANAGER | users, menu_categories, menu_items, restaurant_tables, app_config, supplier_due | orders, order_items, payments, expenses, deliveries, daily_submit, daily_summary, eja_history | users, daily_summary, app_config, expenses, daily_submit, supplier_due, eja_history |

Every profile has `tablesOnly: ['restaurant_tables']`, `highFreq: [orders, order_items, payments,
deliveries]`, `deviceRegistry: []`, and `skipRestoreMarkers` (ADMIN/OWNER: deletions, delete_history,
supplier_due_history; MANAGER: a longer list including all owner_* + due_payments/off_days/weather).
`getActiveProfileConfig()` (L~2585) resolves the active profile.

**Cursors:** `app_config.last_sync_time_<table>` (Firebase) and `last_sync_time_supabase_<table>`.
**Health:** `isSupabasePrimaryHealthy()` = enabled + configured + last read ok + no FAILED Supabase writes
(reason strings: `healthy | killswitch | unconfigured | read-failed | failed-writes:N`).
**Restore:** `restoreHybridDatabaseFromCloud()` — MANAGER = running business day, ADMIN/OWNER = 31 days.
**Trap:** an RLS-denied SELECT returns **HTTP 200 + `[]`**, not an error → can look healthy but return nothing.

### 5.8 Version control
`services/firebaseAppConfig.js`: read chain **Supabase `app_version_policy` → Firebase `app_config/global`
→ SQLite cache → default**. ADMIN is exempt. Writes are sequential dual-write.

### 5.9 Dates / business day
- Dhaka local date; the POS day rolls at **00:00**; the app-usage day rolls at **06:00**
  (`services/appUsageTracker.getDhakaBusinessDate`), `services/dhakaTime.getDhakaCalendarDate`.
- `deliveries` daily-summary aggregation applies a `-1 hour` modifier (pre-existing quirk).
- `calculateAndSaveDailySummary` excludes `ijara` from `totalExpense` and adds `ejaAmount` separately.

### 5.10 Printer / receipts
- Receipt = the Web/RN view `components/ReceiptPaper.js`, captured as a **384-dot raster**
  (`react-native-view-shot`) because the thermal printer has no Bengali font.
- `services/printerService.js` also renders text/canvas ESC-POS `formatReceiptText` +
  `normalizeOrderForReceipt` (legacy/web path).
- Native manager: `services/printer/{printerManager,printerTransport,printerSettings,printerDiagnostic,
  printerButtonStates,receiptData}.js`. Status is only "verified" after a **physical test print**.
- Receipt bold uses `THERMAL_BOLD.textShadowRadius` (currently **0.72**).

### 5.11 AI dataset (optional)
`services/aiDataset/*` (schema/mapper/validator/builder/preview + transport/googleSheets) builds frozen
datasets from local SQLite only → `ai_dataset_queue` → Google Apps Script → Sheets. Feature-flagged via
`EXPO_PUBLIC_AI_DATASET_ENABLED` (default false). Its tables are **local-only**.

---

## 6. Screens inventory (41) — by area

**Gate/auth:** LoginScreen, AppUpdateRequiredScreen, OfflineVerificationScreen, DevicePendingScreen,
DeviceBlockedScreen.
**Dashboards:** AdminDB (large admin console), OwnerDashboard, ManagerDashboard.
**POS:** TableDetailScreen, AddItemScreen (also EDIT_MENU), PaymentCheckoutScreen, PaymentSuccess,
ExpensesScreen, DailySubmitScreen.
**Reports:** DailyItemSalesReport, SupplierDueScreen, DeleteHistoryScreen, AdminAnalyticsScreen.
**Owner finance/HR:** OwnerFinanceDashboard, OwnerExpenseScreen, EmployeeListScreen, EmployeeDetailScreen,
AddEmployeeScreen, AddSalaryPaymentScreen.
**Audit/activity:** ActivityLogScreen (local + Firestore), ActivityStreamScreen (remote diff stream).
**Sync/DB tools (ADMIN):** SyncStatusScreen, SyncDiagnosticsScreen, SyncHealthScreen, DatabaseHealthScreen,
DatabaseStatsScreen, DatabaseExplorerScreen, TableViewerScreen, RowDetailScreen, BackupRestoreScreen,
SystemInfoScreen, SystemToolsScreen.
**AI (ADMIN, flagged):** AIDatasetMonitorScreen, AIDatasetAuditCenterScreen.
**Hardware:** PrinterSettingsScreen. **Device control:** DeviceManagementScreen (ADMIN-only).

---

## 7. Services inventory

**Root (`services/`, 25 files):**
`activityLogger` (activity_logs + `ACTION_TYPES`), `analyticsHelper`, `analyticsService`,
`appUsageTracker` (device app usage + 06:00 business date), `auditClient` (isolated audit project),
`auditLog` (`startAuditService`, `flushAuditOutbox`), `backupRestore`, `calendarGrid`,
`dailySubmitPriority`, `deviceRegistry`, `dhakaTime`, `firebaseAppConfig` (version gating),
`firebaseAuth` (anonymous auth), `firebaseDayRestore` (one-day Firebase→Supabase recovery),
`localToSupabase` (row mapping), `orderTelemetry`, `printerService`, `realtimeSignal`,
`supabaseClient` (client + `isSupabaseSyncEnabled`, `isSupabaseConfigured`, `withTimeout`),
`supabaseDeviceControl` (devices/presence/commands), `supabaseHeartbeat` (`recordSyncHeartbeat`),
`supabaseSync` (pull engine + `SIGNAL_GROUPS` + `ALLOW_AUTO_FIREBASE_READ`),
`supabaseSyncQueue` (dual-write queue + daemon), `syncHealthModel`, `tombstoneStore`
(`isTombstoned`, `isResurrectBlocked`, `isTombstoneStale`).

**`services/printer/` (7):** index, printerManager, printerTransport, printerSettings, printerDiagnostic,
printerButtonStates, receiptData.
**`services/aiDataset/` (7):** builder, mapper, schema, validator, preview, transport/googleSheets.

---

## 8. Components (15)

AdminSideMenu, OwnerSideMenu, ManagerSideMenu, SidebarIcon, StatCard, OrderDetailModal, SalesReportModal,
DepositReportModal, PastAccountModal, PrintReceiptModal, PrinterStatusBanner, AutoReceiptPrinter,
ReceiptPaper, CalendarPicker, TimePicker.

---

## 9. Scripts (6)

| Script | Purpose |
|---|---|
| `select-credentials.js` | copy per-profile credential JSON → `credentials.json` before build |
| `fetch-original-passwords.js` | recover original keystore passwords from the old EAS project |
| `firestore-sync-audit.js` | audit Firestore sync state for expenses/eja_history |
| `runLiveHttpAudit.js` | live HTTP audit of the AI-dataset Google Sheets transport |
| `googleAppsScript_Production.js` | Sheets-side Apps Script (dataset ingest) |
| `googleAppsScript_Weather.js` | legacy weather export Apps Script |

---

## 10. Tests (72)

Run all: `npm run test:all` (plain Node — no framework; most are **source-text assertions**, some use DI
seams like `__set...ForTesting`). Run one: `node tests/<name>.test.js`.

- **Sync / dual-cloud / Supabase:** supabaseSync, supabaseSyncFlag, supabaseDualWrite,
  syncQueueDualPreparation, syncTombstoneResurrect, realtimeSignal, pushOnWrite, phase4Correctness,
  phase13SyncHeartbeat, pinLoginSyncCooldown, dailySubmitAutoPullSync, historicalDataRouting,
  historicalDownloadBounds, firebaseReadPolicy, operationalBackfill, startupSafety.
- **RLS / device / auth:** supabaseAuthFoundation, supabaseDeviceControl, supabasePhase1BAdminRpc,
  supabasePhase2OAuthVerification, supabaseRetention31Day, supabaseSecurityHardening,
  phase7HeaderInjection, phase7RlsFallback, phase6VersionControl.
- **Restore/backup:** backupRestore, phase8ManualCloudSupabaseFirst, phase9RestoreScope,
  phase10AdminRestoreScope, phase12UsersBootstrap, sameDayResync.
- **Printer:** printerService, printerManager, printerConnectionFlow, printerAcceptanceDiagnostics,
  bluetoothDetectionTest, nativeReceiptPipelineProof, auditPrinterProof, thermalPrinterCompatibilityProof,
  autoPrintPolicy, printerSettingsButtonStates (⚠️ **empty 0-byte file**).
- **Reports/UI:** depositReportRedesign, salesReportRedesign, pastAccountModalRedesign, ownerDashboardLayout,
  adminDashboardMerge, adminNotificationPanel, adminPullToastNotification, pdfHelper, dailySubmitLockAndBanner.
- **Telemetry/audit:** orderTelemetry, appUsageTracker, activityLogger, auditLog.
- **AI dataset:** builder, mapper, validator, queue, transport, e2ePipeline.
- **Menu/delivery/accounting:** menuReorderSortOrder, permanentMenuData, deliveryBill,
  deliveryChargePersistence, immediateAutoIjara, ultimateAutoIjaraAudit.

> **The suite does not parse JSX.** Always Babel-parse edited files (see §14).

---

## 11. SQL files

| File | Purpose | Order |
|---|---|---|
| `supabase_full_setup.sql` | full idempotent schema (devices, telemetry, 27 POS tables, version policy) | 1 |
| `supabase_rls.sql` | Phase-7 device-gated RLS (`is_device_active`) + staged rollout + rollback helper | 2 |
| `supabase_cron.sql` | pg_cron 31-day rolling retention (13 tables) | 3 |
| `supabase_audit_setup.sql` | isolated audit project setup (`activity_events` + `audit_read` RPC) | audit project |
| `supabase_audit_fix_rls.sql` | fix the audit INSERT policy | if needed |
| `supabase_reset_audit_project.sql` | **DESTRUCTIVE** reset — audit project only | emergency |
| `supabase_cleanup_stray_tombstones.sql` | delete tombstones for non-existent tables | maintenance |
| `PG_CRON_CHECK.sql` | check pg_cron availability | diagnostic |

---

## 12. Environment variables

All are `EXPO_PUBLIC_*` (inlined at build time). Per-profile values are already set in `eas.json`:

| Variable | Default / value | Meaning |
|---|---|---|
| `APP_PROFILE` | ADMIN / OWNER / MANAGER | build-time profile (drives package name + role gate) |
| `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`, `FIREBASE_MESSAGING_SENDER_ID`, `FIREBASE_APP_ID` | `rongdhonu-83b3d` … | Firebase config |
| `SUPABASE_URL` | `https://gdqnfwccohxgaywzoysc.supabase.co` | main project |
| `SUPABASE_ANON_KEY` | (in eas.json) | main project anon key |
| `SUPABASE_SYNC_ENABLED` | `true` | kill switch for dual-write + Supabase pull |
| `SUPABASE_TIMEOUT_MS` | 4000 | per-op timeout |
| `SUPABASE_VERSION_TIMEOUT_MS` | 3500 | version-policy read timeout |
| `SUPABASE_PULL_TIMEOUT_MS` | 8000 | per-page pull timeout |
| `SUPABASE_FETCH_TIMEOUT_MS` | 20000 | resilient-fetch timeout (**added this session**) |
| `REALTIME_SIGNAL_ENABLED` | `true` | Broadcast signal + adaptive polling |
| `AUDIT_SUPABASE_URL` / `_ANON_KEY` / `AUDIT_SYNC_ENABLED` / `AUDIT_READ_SECRET` | audit ref `zdruassdewwjbexximkj` | isolated audit project |
| `AI_DATASET_ENABLED` | `false` | AI dataset feature flag |
| `WEATHER_WEBAPP_URL`, `GOOGLE_SHEETS_WEBAPP_URL` | Apps Script `/exec` URLs | Google Apps Script |

`eas.json` build profiles: `development` (dev client), `admin`, `owner`, `manager` (each `buildType: apk`,
`credentialsSource: local`, channel `admin/owner/manager`), `production` (ADMIN env).

---

## 13. Build & release notes

- Versions live in `app.json` (`expo.version`, `expo.android.versionCode`) + `package.json`;
  `app.config.js` mirrors them with fallbacks (`version: config.version || '1.0.10'`,
  `versionCode: config.android?.versionCode || 13`).
- Per-profile package names live in `app.config.js` `PROFILE_CONFIGS`; **ADMIN keeps the original package**
  so production installs update seamlessly instead of installing side-by-side.
- `versionCode` must be **strictly greater** than the installed app's for an in-place update.
- Signer mismatch (`-7`) → rebuild with the correct per-profile keystore. **Never uninstall production**
  (it wipes local SQLite data).

---

## 14. Testing & validation workflow

```bash
# 1. syntax-check every edited JS/JSX file (tests will NOT catch JSX errors)
node -e "const p=require('@babel/parser'),fs=require('fs');p.parse(fs.readFileSync('App.js','utf8'),{sourceType:'module',plugins:['jsx','classProperties','objectRestSpread','optionalChaining','nullishCoalescingOperator']});console.log('ok')"

# 2. full suite
npm run test:all        # must print EXIT 0

# 3. refresh the code graph
graphify update .
```
- `node --check` **fails on JSX** — do not use it for screens/components.
- Some tests assert literal source strings; if you change a wiring string, update the test
  (e.g. `tests/phase7RlsFallback.test.js` checks `global: { headers: globalHeaders`).

---

## 15. Graphify

- Outputs in `graphify-out/`: `graph.json`, `graph.html`, `GRAPH_REPORT.md`, `manifest.json`,
  `.graphify_python`, `.graphify_labels.json`.
- Update after code changes: `graphify update .` (AST-only, free).
- If lost after a reset: `graphify .` or `graphify extract . --code-only`.
- Interpreter: `/home/shaki/.local/share/uv/tools/graphifyy/bin/python`.

---

## 16. Conventions & hard invariants

1. **No Firebase SDK** — Firestore via raw `fetch`.
2. Firebase auth tokens **must never** enter `sync_queue`/`sync_queue_supabase`.
3. **Local-only tables** never enqueued: `ai_dataset_queue`, `ai_dataset_history`, `weather_timeline_queue`.
4. `app_config` is **Firebase-only** (version policy + tombstones).
5. Pull accepts only `restaurant_tables` ids `table_1..table_8`.
6. Schema Guardian: merge only writes columns that exist locally (`PRAGMA table_info`).
7. Supabase failures are swallowed (`safeSupabaseCall`); the POS never blocks on Supabase.
8. `enqueueSync` is the **only** place for dual-write behaviour.
9. Deletes write tombstones; merges must respect `tombstoneStore` guards.
10. `ALLOW_AUTO_FIREBASE_READ = false` — no automatic Firebase reads.
11. Theme: gold `#FFB703`; surfaces `#0D0D0D/#161616/#1E1E1E`; borders `#161616/#262626`;
    muted text `#888888`; white values; save/confirm = gold bg + black text.
12. Never gate `devices` / `device_app_usage` / `app_version_policy` / `sync_heartbeat` with RLS.

---

## 17. Session log — changes already made (do not undo blindly)

**Version:** `1.0.9 → 1.0.10`, `versionCode 12 → 13` (app.json, app.config.js, package.json).

**Extras / add-ons** — `screens/TableDetailScreen.js`, `screens/AddItemScreen.js`,
`services/printerService.js`, `components/ReceiptPaper.js`, `App.js`, `database.js`
- Extras are menu items in category **`এক্সট্রা`**.
- Low-key **`➕ এক্সট্রা`** chip → pick extra name → set amount → pick **parent item**.
- Cart item JSON `{ isExtra:true, parentName }`; rendered **nested + smaller** under the parent.
- Serialized to orders/order_items as `"name (parent)"`; receipt renders `↳ name` smaller/indented.
- Orphan extras (parent deleted) render as small rows at the end.

**Service charge** — same files
- Per-order **variable** amount (presets 50/100/200/500 + custom), cart item
  `{ isCharge:true, name:'সার্ভিস চার্জ' }`.
- **Not in the item list**; shown as `সার্ভিস চার্জ ৳X ✎ ❌` (edit/remove).
- **Not written to `order_items`** (skipped in `addCompletedOrder` + `updateCompletedOrder`).
- Receipt: `সার্ভিস চার্জ` line **before** `সর্বমোট`; `সর্বমোট` includes it; then `পরিশোধ` (overall).
- `normalizeOrderForReceipt` exposes `norm.serviceCharge`.

**Receipt bold −20%**
- `components/ReceiptPaper.js` `THERMAL_BOLD.textShadowRadius` **0.9 → 0.72**.
- `services/printerService.js` canvas outline **size*0.09 → size*0.072** (min 0.64).

**Menu recovery fixed** — `database.js`, `services/supabaseSync.js`
- `recoverMenuFromCloud()` = **Supabase-first full snapshot** (`recoverMenuFromSupabase()`) → Firebase
  fallback → **honest boolean** (previously Firebase-only and always `true`).

**Device access robustness** — `services/deviceRegistry.js`, `services/supabaseClient.js`, `App.js`
- Device self-check bounded by an **8 s timeout**.
- **`allow_offline` is authoritative** (admin OFF ⇒ no offline; ADMIN role exempt).
- Visible offline banner + Retry in `App.js`:
  “⚠️ সার্ভারের সাথে সংযোগ করা যাচ্ছে না — অ্যাপ অফলাইনে চলছে (ডেটা পরে sync হবে)”.
- `supabaseClient.js` **resilient fetch**: 20 s timeout + 2 retries.
- Updated `tests/phase7RlsFallback.test.js` to tolerate the added `fetch` option.

**UI theme alignment:** every new element uses the app palette (§16.11).

All verified: Babel parse OK, `npm run test:all` EXIT 0, graphify updated.

---

## 18. Known issues / diagnostics

### 18.1 “সার্ভার সংযোগ প্রয়োজন / Verification Required (Offline)”
Shown when the mandatory Supabase **device self-check** cannot complete and the device is not
offline-permitted. It does **not** mean the device is missing/blocked.

Diagnose in order:
1. On the phone, open in Chrome: `https://gdqnfwccohxgaywzoysc.supabase.co/rest/v1/`
   - `{"message":"No API key found..."}` / 401 → host reachable ⇒ app/env side.
   - “This site can not be reached” → the phone's network/DNS cannot reach Supabase at all.
2. Test a **second phone on the same network**, then the **same phone on another network**.
   - Same-network fails too ⇒ network/router/carrier (DNS, IPv6, Private DNS, VPN, APN).
   - Only this phone fails ⇒ that phone's settings/state.
3. `public.devices` row: `status='ACTIVE'`, `allow_login=true`, `allow_offline=…`, `admin_lock=false`,
   `is_deleted=false`.
4. `public.sync_heartbeat` (per device × backend): `last_push_at`, `last_read_at`, `last_error`.
5. Fixes: Android **Private DNS = `dns.google`**, **APN protocol = IPv4**, Airplane toggle, other network.

There are three places that can trigger `verificationRequired`: missing local `device_id` (L~1128),
remote fetch failure with `allow_offline ≠ 1` (L~1233), and an exception during the check (L~1242).

### 18.2 Realtime warning
`[SupabaseDeviceControl] Presence channel status 'CHANNEL_ERROR': … transport failure` = the Realtime
WebSocket cannot connect (same reachability as §18.1; also appears on background/foreground transitions).
**Non-fatal:** auto-reconnect after 3 s; device control falls back to the DB heartbeat +
60 s force-logout poll.

### 18.3 “No app is pulling”
- Check `isSupabasePrimaryHealthy()` reason: `healthy | killswitch | unconfigured | read-failed | failed-writes:N`.
- A FAILED Supabase write flips health → Firebase reads resume; an empty+healthy read does not.
- RLS-denied reads are silent (200 + empty) → verify `public.devices` is ACTIVE and `x-device-id` is sent.

### 18.4 Log tags to grep
`[SupabaseSync]`, `[SupabaseClient]`, `[SupabaseDeviceControl]`, `[DeviceRegistry]`, `[Firebase-Read]`,
`[Firebase-…]`, `[DB Migration]`, `[Audit]`.

---

## 19. Gotchas discovered so far

- `android/` is gitignored → the version comes from `app.json`; prebuild regenerates native values.
- Tests are source-inspection heavy → **never** rely on them to catch syntax errors.
- `addCompletedOrder` parses `"name xQty @price"` from a comma-joined string (extras: `"name (parent)"`).
- `updateCompletedOrder` rebuilds `orders.items` and recreates `order_items` (preserves extra parents/prices,
  skips the service charge).
- `deliveries` daily-summary aggregation uses `-1 hour`.
- `calculateAndSaveDailySummary` excludes `ijara` from `totalExpense` and adds `ejaAmount` separately.
- `migrateSupplierDue` can DROP/reseed the supplier table if it sees a legacy column.
- `initDatabase` has a one-time `db_wiped_v2` full-DB reset (gated by `app_config`).
- `enqueueSync` for DELETEs intentionally does not reset `is_synced_supabase`.
- `syncDeviceRegistry()` is a decommissioned no-op.
- `executeInspectorQuery` is SELECT-only; `executeInspectorWrite` allows DELETE/UPDATE/INSERT only.
- `defaultMenu` / the `DEFAULT_MENU` seed in `AddMenu` are dead/commented-out code.
- `discount` is **auto-computed** (`grandTotal − paidAmount`), not manually editable.

---

## 20. Common tasks / recipes

### 20.1 Add a new screen
1. Create `screens/YourScreen.js` (default export; accept `onBack` + other callbacks as props).
2. Import it in `App.js` (near L245–284).
3. Add a `case 'YOUR_SCREEN':` to `renderScreen()`; guard by profile/role if admin-only
   (`return null` when unauthorized).
4. Pass `onBack`/`onNavigate*` callbacks from the dashboard that opens it (`setCurrentScreen('YOUR_SCREEN')`).
5. Add a row to the relevant side menu (`components/*SideMenu.js`).
6. Babel-parse → `npm run test:all` → `graphify update .`.

### 20.2 Add a new synced table
1. Add the SQLite `CREATE TABLE` to `TABLE_SCHEMAS` in `database.js` (+ a migration if evolving).
2. Add the Supabase DDL to `supabase_full_setup.sql` (and to `supabase_rls.sql` if it must be gated);
   remember to add it to `supabase_cron.sql` if it needs retention.
3. Map the conflict/PK column in `getSupabaseConflictKey` / `getSupabasePkColumn`.
4. Add the table to the right pull group (`SIGNAL_GROUPS` in `services/supabaseSync.js`) **and** to the
   profile lists (`APP_PROFILES` in `database.js`: `alwaysFull`/`recentOnly`/`lowFreq`).
5. Add the Firebase collection mapping (`syncCollections` / `targetCollection`) if special.
6. Ensure the `enqueueSync` guards (local-only / excluded) are correct.
7. Add a test → run the suite → `graphify update .`.

### 20.3 Add an RLS-gated table
Add `is_device_active(current_setting('request.headers')->>'x-device-id')` policies in `supabase_rls.sql`
for the new table — **except** the never-gated set (§16.12).

### 20.4 Add a menu item (runtime, not code)
Owner/Admin → Edit Menu → "➕ নতুন" → name + price + category. Categories used in-app:
বার্গার / ফ্রাই / নুডুলস / চিকেন / রাইস / স্ন্যাকস / পিজ্জা / ড্রিংকস / **এক্সট্রা**.

### 20.5 Add a receipt line
Update **BOTH** `services/printerService.js` (`formatReceiptText` + `normalizeOrderForReceipt`) and
`components/ReceiptPaper.js` (preview + raster capture). Keep the field order identical between them.

### 20.6 Debug sync
- Admin → System Tools → **Sync Health** (per-device/backend, cursors, queue), **Sync Diagnostics**
  (Firebase read quotas), **Sync Status** (queue/daemon).
- Supabase SQL: `public.sync_heartbeat`, `public.devices`; local SQLite: `sync_queue`,
  `sync_queue_supabase`, `app_config` (cursors).
- Grep the log tags in §18.4.

### 20.7 Change pull behaviour
- Intervals/timers: `App.js` (Supabase pull timers + `runFirebasePullIfSupabaseDown`).
- Which tables are pulled: `SIGNAL_GROUPS` (`services/supabaseSync.js`) + `APP_PROFILES` (`database.js`).
- To temporarily restore automatic Firebase fallback: flip `ALLOW_AUTO_FIREBASE_READ = true`
  (`services/supabaseSync.js` ~L66).

### 20.8 Bump the version
Edit `app.json` (`version`, `android.versionCode`), `package.json`, and the `app.config.js` fallbacks.
`versionCode` must be strictly greater than the installed app's.

### 20.9 Build an APK
`export ANDROID_HOME="$HOME/Android/sdk"` then `npm run build:<profile>:local` (see §3).

### 20.10 Diagnose a device that won't log in
Follow §18.1, then check `public.devices` + `public.sync_heartbeat`.

---

## 21. Pending plan — Online ordering website (`website.md`)

Do **not** start until the user says **“website”**. Phases:
1. **Build the website** (agent builds): static `web/` + a **NEW Supabase project** (`online_menu` with
   pictures, `place_online_order` RPC, RLS).
2. **Deploy it LIVE** (agent deploys; Netlify recommended).
3. **App module**: isolated “Online Orders” inbox (Owner+Manager) + **real push** (`expo-notifications`)
   → **Accept auto-creates an existing-app Delivery** (the ONE bridge; existing app logic untouched).
4. **Online Menu manager** (Owner/Admin/Manager): items + pictures + availability.

Decided: separate/new Supabase project; existing Firebase + old Supabase untouched; ordering window
**11:00–21:30 Asia/Dhaka**; availability persists until changed; management auth = shared passcode RPC;
Admin/Owner/Manager can all set availability; the website is built and deployed by the agent.
Full details: **`website.md`**.

---

## 22. New agent checklist after a reset

1. `git status` and `git log --oneline -5`.
2. `npm run test:all` for a baseline; Babel-parse any file you touch.
3. If the user says **“website”**, read `website.md`.
4. Do not undo §17 (explicitly requested + verified).
5. Match the theme (§16.11) and invariants (§16).
6. After code changes: `graphify update .`.
