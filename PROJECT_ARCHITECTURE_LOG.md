# PROJECT_ARCHITECTURE_LOG.md

> **Rongdhonu POS & Admin Management Suite — Permanent Master Architecture Log**
> 
> *Last Updated: 2026-08-05*  
> *Target Profiles: `ADMIN` (`com.riajulshakib.rongdhonu`), `OWNER` (`com.riajulshakib.rongdhonu.owner`), `MANAGER` (`com.riajulshakib.rongdhonu.manager`)*
> 
> 📋 **Release History**: See [`CHANGELOG.md`](./CHANGELOG.md) for chronological version history.  
> 📐 **Architecture Decisions**: See [`DECISIONS.md`](./DECISIONS.md) for ADRs.
> 
> **Mandatory Update Policy**: Every commit must update this file, `CHANGELOG.md`, and `DECISIONS.md` (if applicable).

---

## 1. Project Overview

Rongdhonu Cafe & Restaurant POS is a high-availability, multi-profile mobile and desktop restaurant management system built with React Native (Expo SDK v56.0.0) and SQLite. It provides robust offline-first POS order entry, daily financial settlements (Daily Submit), employee management, supplier due ledgers, device access control, and an isolated AI Machine Learning Dataset Sync pipeline.

---

## 2. Current Architecture

* **UI Framework**: React Native (Expo SDK v56.0.0) with Vanilla CSS / StyleSheet design tokens.
* **Local Database (Source of Truth)**: Expo SQLite (`dbInstance` / `db.runSync`, `db.getAllSync`).
* **Cloud Sync Transport**: Firebase Firestore REST API (v1 HTTP PATCH / runQuery queries).
* **AI Dataset Export Transport**: Google Apps Script WebApp REST Endpoint (`EXPO_PUBLIC_GOOGLE_SHEETS_WEBAPP_URL`).
* **Status Bar & Safe Area Engine**: `react-native-safe-area-context` & `import { StatusBar as RNStatusBar } from 'react-native';`.

---

## 3. Database Architecture

The application operates on an offline-first SQLite database containing **22 active tables**:

| Table Name | Primary Key | Description / Purpose |
| :--- | :--- | :--- |
| `users` | `id` | System user accounts (`admin`, `owner`, `manager`) with PIN codes |
| `restaurant_tables` | `id` | Table layouts (`table_1` .. `table_8`) |
| `orders` | `id` | Sales orders log |
| `order_items` | `id` | Order line items containing quantity, unit price, revenue |
| `payments` | `id` | Order payment split breakdown (Cash, bKash, Nagad, Rocket, Card) |
| `expenses` | `id` | Daily operational expense tracking |
| `deliveries` | `id` | Home delivery order logs |
| `daily_submit` | `date` (YYYY-MM-DD) | **Source of Truth for daily financial settlements & owner deposits** |
| `daily_summary` | `date` (YYYY-MM-DD) | Pre-aggregated daily KPIs, weather, and peak hour summaries |
| `menu_categories` | `id` | Food menu categories |
| `menu_items` | `id` | Master catalog items and pricing |
| `due_payments` | `id` | Customer due payment ledger |
| `eja_history` | `date` | Opening Ijara (Cash-in-hand) history |
| `off_days` | `id` / `date` | Restaurant closures log |
| `weather_data` | `id` / `date` | Hourly/daily weather observations |
| `sync_queue` | `id` (AUTOINCREMENT) | Outbound Firestore queue |
| `device_registry` | `device_id` | Approved client device registry & admin locks |
| `supplier_due` | `id` | Supplier credit balance summaries |
| `supplier_payment_ledger` | `id` | Supplier daily auto-fill payment ledger |
| `deletions` | `id` | Local tombstone records for Firestore sync |
| `ai_dataset_queue` | `id` (`dataset_id`) | **AI Dataset transmission queue (`PENDING`, `IN_PROGRESS`, `SUCCESS`, `FAILED`, `RETRY`)** |
| `ai_dataset_history` | `id` (`dataset_id`) | **AI Dataset export audit log preventing duplicate exports** |

---

## 4. Firestore Architecture

* **Sync Model**: Unidirectional and bidirectional REST sync via `services/deviceRegistry.js` and `processSyncQueue()`.
* **Zero Additional Firestore Read Policy**: AI Dataset Sync and reporting services perform **0 Firestore reads**.
* **Forbidden Sync Tables**: Local-only tables (`ai_dataset_queue`, `ai_dataset_history`, `weather_timeline_queue`) are explicitly purged from `sync_queue` to prevent Firestore 403 authorization errors.

---

## 5. Google Sheets Architecture

* **Transport Mechanism**: Reuses existing Google Apps Script WebApp endpoint (`EXPO_PUBLIC_GOOGLE_SHEETS_WEBAPP_URL`).
* **Target Spreadsheet**: `"Rongdhonu_ML_Dataset"`.
* **Output-Only Rule**: Google Sheets is strictly an **OUTPUT destination**. It is NEVER treated as an input or source of truth.

---

## 6. AI Dataset Sync Architecture

* **Target Profile**: **ADMIN APP ONLY** (`EXPO_PUBLIC_APP_PROFILE=ADMIN`).
* **Target Worksheet Tabs**:
  * `AI_Daily_Sales_Dataset` (Daily sales ML schema)
  * `AI_Item_Sales_Dataset` (Item sales ML schema)
* **Permanent Legacy Deprecation**: The old ML Export implementation (`SUMMARY`, `ITEM_SALES`, `DailySummary`, `ItemSales`, `ml_export_queue`, `ml_export_history`) is permanently retired.
* **Idempotent Retry Safety**: Rows are identified by stable primary key `dataset_id`. Retrying or re-exporting updates existing rows via `dataset_id`; duplicate rows are never appended.
* **Transaction-Safety**: Triggered inside `submitDailySheet()` **ONLY AFTER** all SQLite writes and financial settlements have successfully committed.
* **Status Lifecycle**: `PENDING` $\rightarrow$ `IN_PROGRESS` $\rightarrow$ `SUCCESS` (or `FAILED` $\rightarrow$ `RETRY` $\rightarrow$ `SUCCESS`). Automatic crash recovery resets stale `IN_PROGRESS` (>5 min) records to `RETRY`.

---

## 7. Financial Rules

* **Gross Sales Formula**: `totalSales = cash + bkash + nagad + rocket + card`.
* **Net Deposit (Profit) Formula**: `ownerDeposit = MAX(0, totalSales + openingIjara - totalExpense)`.
* **Next Day Opening Ijara Formula**: `nextDayIjara = MAX(0, (totalSales + currentIjara - totalExpense) - ownerDeposit)`.
* **Financial Protection**: AI Dataset validation rules (`PAYMENT_SUM_CHECK`) flag anomalies in `validation_errors` but **NEVER mutate raw financial data**.

---

## 8. Daily Submit Flow

1. User inputs daily breakdown in `DailySubmitScreen`.
2. `submitDailySheet()` executes within a SQLite transaction.
3. Inserts/updates `daily_submit` (Source of Truth).
4. Inserts/updates `supplier_payment_ledger`.
5. Locks all sales orders for the business date (`orders.locked_at = now`).
6. Calculates and saves `daily_summary`.
7. Calculates next day's opening Ijara and writes fallback keys to `app_config`.
8. Triggers `enqueueAIDatasetExport(todayStr)` **only if all prior steps succeeded**.

---

## 9. Late Submit Flow

* If a business day is submitted after midnight or on a subsequent calendar date, `submitDailySheet()` processes the exact `business_date` string, preserves historical order locks, and enqueues `enqueueAIDatasetExport(business_date)` using the stable `dataset_id`.

---

## 10. Ijara Calculation

* **Carry Forward Mechanism**: Settled automatically at Daily Submit.
* **Idempotent Fallback**: `checkAndApplyIjaraRollover()` reads `pending_ijara_amount` and `pending_ijara_date` from `app_config` and applies expenses/eja history idempotently.

---

## 11. Analytics Rules

* All dashboard analytics, daily sales charts, and financial reports query `daily_submit`, `daily_summary`, and `orders` from the local SQLite database.

---

## 12. Device Control Architecture

* **Device Identification**: Devices are registered using normalized `device_id`.
* **Access Enforcement**: `checkDeviceLoginPermission(role)` returns `{ allowed: boolean, status: string, message: string }`.
* **Admin Security Lock**: Admin PIN verification allows permanently blocking stolen or lost devices (`admin_lock = 1`).

---

## 13. Authentication & Permission Rules

* **Roles**: `admin`, `owner`, `manager`.
* **Branding Directive**: Every user-facing UI text reference to the administrator is strictly branded in Bengali as **`সাকিব`** (e.g. "সাকিব আপনাকে সাইন-আউট করিয়েছেন।", "অফলাইন মোড সাকিব কর্তৃক বন্ধ করা হয়েছে।").

---

## 14. Queue Systems

1. **`sync_queue`**: Manages outbound Firestore sync.
2. **`ai_dataset_queue`**: Manages outbound AI dataset Google Sheets exports using stable `dataset_id` keys and status lifecycle management (`PENDING`, `IN_PROGRESS`, `SUCCESS`, `FAILED`, `RETRY`).

---

## 15. Dataset Schemas

### A. `AI_Daily_Sales_Dataset`
* `dataset_id` (PK), `business_date`, `calendar_date`, `schema_version`, `dataset_version`, `exported_at`, `year`, `month`, `week_number`, `day_of_month`, `day_of_week`, `day_name`, `is_friday`, `is_weekend`, `is_month_start`, `is_month_end`, `days_until_salary`, `days_after_salary`, `temperature`, `feels_like_temperature`, `humidity`, `rainfall_mm`, `weather_condition`, `is_rainy`, `wind_speed`, `is_holiday`, `holiday_name`, `holiday_source`, `festival_type`, `is_off_day`, `off_day_reason`, `store_open_time`, `store_close_time`, `business_hours`, `promotion_running`, `promotion_name`, `promotion_discount`, `total_orders`, `total_sales`, `cash_sales`, `bkash_sales`, `nagad_sales`, `rocket_sales`, `card_sales`, `delivery_sales`, `delivery_charge`, `total_discount`, `net_sales`, `average_order_value`, `peak_hour`, `opening_ijara`, `total_expense`, `closing_cash`, `owner_deposit`, `expense_ratio`, `is_complete`, `is_valid`, `is_training_ready`, `validation_errors`, `target_sales`, `created_at`, `updated_at`.

### B. `AI_Item_Sales_Dataset`
* `dataset_id` (PK), `business_date`, `item_id`, `item_name`, `category_name`, `schema_version`, `dataset_version`, `exported_at`, `unit_price`, `total_quantity_sold`, `total_item_revenue`, `item_rank_today`, `item_share_percent`, `is_out_of_stock`, `available_quantity`, `day_of_week`, `is_friday`, `is_holiday`, `is_rainy`, `is_complete`, `is_valid`, `is_training_ready`, `validation_errors`, `target_quantity`, `created_at`, `updated_at`.

### C. Raw Dataset Principle & Refinements Reference
* **Raw Dataset Principle**: Window features (`prev_day_sales`, `sales_7day_avg`, `item_7day_avg_qty`, etc.) are excluded from exported SQLite payloads to ensure raw reusable features for any Python ML pipeline.
* **New Fields Documentation**:
  - `is_month_start` (Binary): `1` if 1st of month.
  - `is_month_end` (Binary): `1` if last day of month.
  - `days_until_salary` (Int): Count of days until 1st of next month.
  - `days_after_salary` (Int): Count of days elapsed since 1st of month.
  - `feels_like_temperature` (Float / NULL): Thermal comfort index.
  - `rainfall_mm` (Float / NULL): Precipitation amount in mm.
  - `festival_type` (Enum): `'Religious'`, `'National'`, `'School Holiday'`, `'Local Event'`, `'Weekend'`, `'None'`.
  - `store_open_time`, `store_close_time`, `business_hours` (Nullable): Operational shift timings.
  - `promotion_running`, `promotion_name`, `promotion_discount` (Nullable/Defaults): Marketing campaign signals.
  - `is_out_of_stock`, `available_quantity` (Nullable): Inventory signals.
  - `is_training_ready` (Binary): `1` ONLY if `is_complete == 1` and `is_valid == 1`.
  - `item_rank_today` (Int): Item popularity rank by sales volume.
  - `item_share_percent` (Float): Percentage share of daily items sold.

---

## 16. Permanent Architecture Rules

1. **Local SQLite is the ONE AND ONLY Source of Truth**.
2. **Zero Additional Firestore Reads Policy** is permanent.
3. **Google Sheets is an OUTPUT destination ONLY**.
4. **AI Dataset Sync is strictly restricted to ADMIN APP**.
5. **AI Dataset payload targets dedicated tabs (`AI_Daily_Sales_Dataset` & `AI_Item_Sales_Dataset`) ONLY**.
6. **No modification of financial calculations or Daily Submit formulas**.
7. **User-facing administrator branding is strictly `সাকিব`**.
8. **Raw Dataset Principle**: Export raw unpolluted business metrics; compute rolling time-series features in Python ML preprocessing.

---

## 17. Regression Protection Rules

* Before making any code change, developers and AI agents **MUST read this log completely**.
* Running code edits must be followed by `git status`, runtime verification, and an updated changelog entry.

---

## 18. File Structure

```
/
├── App.js                         # Root application navigator & global alerts
├── database.js                    # Core SQLite schemas, migrations, & sync queue engines
├── pdfHelper.js                   # PDF report generator
├── screens/
│   ├── LoginScreen.js             # Authentication, 88% width layout, mode toggle
│   ├── DailySubmitScreen.js       # Daily financial settlement screen
│   ├── DeviceManagementScreen.js  # Client device registry & সাকিব security locks
│   ├── DevicePendingScreen.js     # Pending device access screen
│   ├── DeviceBlockedScreen.js     # Blocked device screen
│   └── SystemInfoScreen.js        # Environment notice screen
└── services/
    ├── deviceRegistry.js          # Device registration & permission checking
    └── aiDataset/                 # ISOLATED AI DATASET MODULE
        ├── schema.js              # Production frozen ML dataset schemas
        ├── mapper.js              # SQL source mappings & window function derivations
        ├── validator.js           # Anomaly checks & cross-field mathematical rules
        ├── builder.js            # Pure Dataset Builder (buildDailyDataset, buildItemDataset)
        └── README.md              # Architectural directives & phase roadmap
```

---

## 19. Rollback & Commit History Reference

> ⚠️ **ROLLBACK EMERGENCY PROTOCOL**
> 
> To restore or revert the repository to any verified feature state, execute `git checkout <commit_hash>` or `git revert <commit_hash>`.

| Commit Hash | Feature / Refinement | Date | Primary Files Modified | Rollback Command |
| :--- | :--- | :---: | :--- | :--- |
| **`5d7a72d`** | Raw Dataset & Calendar Refinements | 2026-08-05 | `services/aiDataset/*`, `database.js` | `git checkout 5d7a72d` |
| **`994bbf9`** | Rollback Reference Section in Master Log | 2026-08-05 | `PROJECT_ARCHITECTURE_LOG.md` | `git checkout 994bbf9` |
| **`eb0fefb`** | Master Architecture Log & AI Dataset Phase 1 | 2026-08-05 | `PROJECT_ARCHITECTURE_LOG.md`, `database.js`, `services/aiDataset/*` | `git checkout eb0fefb` |
| **`4ce7c72`** | Runtime Offline Mode Alert Fix (`সাকিব`) | 2026-08-05 | `screens/LoginScreen.js` | `git checkout 4ce7c72` |
| **`5f74b15`** | Bengali Branding Refinement (`Shakib` $\rightarrow$ `সাকিব`) | 2026-08-05 | `App.js`, `screens/*`, `services/deviceRegistry.js` | `git checkout 5f74b15` |
| **`088eb6e`** | Complete Localization & Parenthetical Cleanup | 2026-08-05 | `App.js`, `pdfHelper.js`, `screens/*` | `git checkout 088eb6e` |
| **`760f21b`** | Initial Bengali Text Localization | 2026-08-05 | `App.js`, `screens/*` | `git checkout 760f21b` |
| **`c2967cf`** | Login UI Centering & 88% Control Width | 2026-08-05 | `screens/LoginScreen.js` | `git checkout c2967cf` |
| **`b25bf8c`** | Compact Restaurant Logo Restoration | 2026-08-05 | `screens/LoginScreen.js` | `git checkout b25bf8c` |
| **`ca9a4c6`** | RNStatusBar Import Crash Fix | 2026-08-05 | `screens/LoginScreen.js` | `git checkout ca9a4c6` |
| **`22f6891`** | Login UI Ring Removal & Top-Right Toggle | 2026-08-05 | `screens/LoginScreen.js` | `git checkout 22f6891` |

---

## 20. Deprecated Components

* **Legacy ML Export Pipeline**: Retired payload formats (`SUMMARY`, `ITEM_SALES`, `WEATHER`), legacy functions (`enqueueDailyMLExports()`, `processMLExportQueue()`), legacy queue tables (`ml_export_queue`, `ml_export_history`), and legacy sheet targets (`DailySummary`, `ItemSales`, `WeatherTimeline`). Replaced by the isolated **AI Dataset Sync Architecture**.

---

## 21. Future Roadmap

* **Phase 2 (Completed)**: Pure Dataset Builder (`services/aiDataset/builder.js` exposing `buildDailyDataset` and `buildItemDataset`).
* **Phase 2.5 (Completed)**: Read-only Verification Suite — 8/8 PASS, zero regressions.
* **Phase Post-2.5 (Completed)**: ISO-8601 week fix, schema version lock, unit test suite (143/143 PASS), preview tool.
* **Phase 3**: Connect Admin App UI export trigger to Google Sheets WebApp using `processAIDatasetQueue()`.

---

## 22. Phase 2.5 — Verification Results

**Date:** 2026-08-05 | **Scope:** Read-only static verification of `services/aiDataset/builder.js`

| # | Test | Result |
|---|------|--------|
| 1 | Schema Completeness (62 daily + 27 item fields) | ✅ PASS |
| 2 | Determinism (3 runs, same date) | ✅ PASS |
| 3 | Financial Consistency (payment sum = total_sales) | ✅ PASS |
| 4 | Immutability (Object.freeze — mutation blocked) | ✅ PASS |
| 5 | Item Rank & Share (1 item / many / zero sales) | ✅ PASS |
| 6 | Calendar Features (month start/end, salary cycle) | ✅ PASS |
| 7 | Missing Data Defaults (weather/holiday/off_day all safe) | ✅ PASS |
| 8 | Performance (365 days @ 0.005ms/record, 0 failures) | ✅ PASS |

**Verdict:** 8/8 PASS — Zero failures — Zero regressions

---

## 23. Phase Post-2.5 — Architecture Refinements

**Date:** 2026-08-05

### 23.1 ISO-8601 Week Number

Replaced the old `ceil(day_of_month / 7)` approximation with the correct ISO-8601 algorithm.

```
ISO-8601 Rule: Week 1 = week containing the first Thursday of the year. Weeks start on Monday.
Algorithm: nearest-Thursday method via UTC Date arithmetic.
Range: 1–53.
```

Verified against 10 reference dates — all pass.

### 23.2 Schema Version Lock

```
schema_version = "1.0.0" — LOCKED
dataset_version = "1.0.0" — LOCKED
```

**Rule:** Any future field change (add/remove/rename/type/default) MUST increment `schema_version`. Historical exported datasets must remain compatible with the schema version they were exported with. Never modify historical datasets.

### 23.3 Unit Test Suite

Three standalone test files — zero external dependencies — run with plain `node`:

```bash
npm run test:builder     # 63 tests
npm run test:validator   # 37 tests
npm run test:mapper      # 43 tests
npm run test:all         # 143 tests total
```

**Result: 143/143 PASS — Zero failures.**

### 23.4 Dataset Preview Tool

Created `services/aiDataset/preview.js` — developer/QA read-only inspection helper.

```javascript
import { generateDatasetPreview, printDatasetPreview } from './services/aiDataset/preview';

const preview = generateDatasetPreview('2026-08-05');
// preview.dailyDataset   → frozen daily dataset
// preview.itemDatasets   → frozen item dataset array
// preview.summary        → frozen summary with top sellers, financial KPIs

printDatasetPreview('2026-08-05'); // Formatted console output
```

**Strict rules:** Read-only. SQLite only. No writes. No queue. No Firestore. No Google Sheets.

---

## 24. Dataset Schema Version History

| Version | Date | Changes |
|---------|------|---------|
| `1.0.0` | 2026-08-05 | Initial production schema. 62 daily fields + 27 item fields. Calendar, weather, festival, financial, quality flags. |

**Versioning Rule:** Increment `schema_version` for any field add/remove/rename/type change. Never mutate historical exported rows.

---

## 25. Updated File Structure

```
/
├── App.js                         # Root application navigator & global alerts
├── database.js                    # Core SQLite schemas, migrations, & sync queue engines
├── pdfHelper.js                   # PDF report generator
├── screens/
│   ├── LoginScreen.js             # Authentication, 88% width layout, mode toggle
│   ├── DailySubmitScreen.js       # Daily financial settlement screen
│   ├── DeviceManagementScreen.js  # Client device registry & সাকিব security locks
│   ├── DevicePendingScreen.js     # Pending device access screen
│   ├── DeviceBlockedScreen.js     # Blocked device screen
│   └── SystemInfoScreen.js        # Environment notice screen
├── services/
│   ├── deviceRegistry.js          # Device registration & permission checking
│   └── aiDataset/                 # ISOLATED AI DATASET MODULE
│       ├── schema.js              # Production frozen ML dataset schemas (v1.0.0)
│       ├── mapper.js              # SQL source mappings & derivation documentation
│       ├── validator.js           # Anomaly checks & cross-field mathematical rules
│       ├── builder.js             # Pure Dataset Builder (buildDailyDataset, buildItemDataset)
│       ├── preview.js             # Read-only Dev/QA Dataset Preview Tool
│       └── README.md              # Architectural directives & phase roadmap
└── tests/
    ├── builder.test.js            # 63 unit tests — builder logic, ISO week, ranking
    ├── validator.test.js          # 37 unit tests — validation rules, immutability
    └── mapper.test.js             # 43 unit tests — mapper coverage, source tables
```



