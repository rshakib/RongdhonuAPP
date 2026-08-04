# PROJECT_ARCHITECTURE_LOG.md

> **Rongdhonu POS & Admin Management Suite — Permanent Master Architecture Log**
> 
> *Last Updated: 2026-08-05*  
> *Target Profiles: `ADMIN` (`com.riajulshakib.rongdhonu`), `OWNER` (`com.riajulshakib.rongdhonu.owner`), `MANAGER` (`com.riajulshakib.rongdhonu.manager`)*

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
* `dataset_id` (PK), `business_date`, `calendar_date`, `schema_version`, `dataset_version`, `exported_at`, `year`, `month`, `week_number`, `day_of_month`, `day_of_week`, `day_name`, `is_friday`, `is_weekend`, `temperature`, `humidity`, `weather_condition`, `is_rainy`, `wind_speed`, `is_holiday`, `holiday_name`, `holiday_source`, `is_off_day`, `off_day_reason`, `total_orders`, `total_sales`, `cash_sales`, `bkash_sales`, `nagad_sales`, `rocket_sales`, `card_sales`, `delivery_sales`, `delivery_charge`, `total_discount`, `net_sales`, `average_order_value`, `peak_hour`, `opening_ijara`, `total_expense`, `closing_cash`, `owner_deposit`, `expense_ratio`, `prev_day_sales`, `prev_week_sales`, `sales_7day_avg`, `sales_30day_avg`, `sales_growth_7d`, `is_complete`, `is_valid`, `validation_errors`, `target_sales`, `created_at`, `updated_at`.

### B. `AI_Item_Sales_Dataset`
* `dataset_id` (PK), `business_date`, `item_id`, `item_name`, `category_name`, `schema_version`, `dataset_version`, `exported_at`, `unit_price`, `total_quantity_sold`, `total_item_revenue`, `day_of_week`, `is_friday`, `is_holiday`, `is_rainy`, `item_prev_week_qty`, `item_7day_avg_qty`, `item_30day_avg_qty`, `is_complete`, `is_valid`, `validation_errors`, `target_quantity`, `created_at`, `updated_at`.

---

## 16. Permanent Architecture Rules

1. **Local SQLite is the ONE AND ONLY Source of Truth**.
2. **Zero Additional Firestore Reads Policy** is permanent.
3. **Google Sheets is an OUTPUT destination ONLY**.
4. **AI Dataset Sync is strictly restricted to ADMIN APP**.
5. **AI Dataset payload targets dedicated tabs (`AI_Daily_Sales_Dataset` & `AI_Item_Sales_Dataset`) ONLY**.
6. **No modification of financial calculations or Daily Submit formulas**.
7. **User-facing administrator branding is strictly `সাকিব`**.

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
        └── README.md              # Architectural directives & phase roadmap
```

---

## 19. Feature Timeline / Changelog

| Date | Feature / Refinement | Files Modified | Commit Hash | Summary / Notes |
| :--- | :--- | :--- | :--- | :--- |
| 2026-08-05 | Login UI Refinements | `LoginScreen.js` | `22f6891`, `b25bf8c`, `c2967cf` | Compact logo, top-right mode toggle pill, created by footer, 88% width controls. |
| 2026-08-05 | RNStatusBar Crash Fix | `LoginScreen.js` | `ca9a4c6` | Fixed `ReferenceError: Property 'RNStatusBar' doesn't exist`. |
| 2026-08-05 | System Alert Localization | `App.js`, `pdfHelper.js`, `AdminDB.js`, `DailyItemSalesReport.js`, `DeviceManagementScreen.js` | `760f21b`, `088eb6e` | Localized system alerts and removed parenthetical mixed language text (`(Cancel)`, `(Confirm)`). |
| 2026-08-05 | Bengali Branding `সাকিব` | `App.js`, `DeviceBlockedScreen.js`, `DeviceManagementScreen.js`, `DevicePendingScreen.js`, `LoginScreen.js`, `SystemInfoScreen.js`, `services/deviceRegistry.js` | `5f74b15`, `4ce7c72` | Converted all user-facing `Admin` / `Shakib` references to Bengali spelling **`সাকিব`**. Fixed runtime `handleModeChange` alert. |
| 2026-08-05 | AI Dataset Sync Module Architecture | `services/aiDataset/schema.js`, `mapper.js`, `validator.js`, `README.md` | — | Created isolated AI Dataset module with frozen ML schemas, zero Firestore reads, dedicated AI tabs (`AI_Daily_Sales_Dataset`, `AI_Item_Sales_Dataset`), status lifecycle, and transaction-safe submit triggers. |
| 2026-08-05 | Master Architecture Log Created | `PROJECT_ARCHITECTURE_LOG.md` | — | Established single master architecture log for the project. |

---

## 20. Deprecated Components

* **Legacy ML Export Pipeline**: Retired payload formats (`SUMMARY`, `ITEM_SALES`, `WEATHER`), legacy functions (`enqueueDailyMLExports()`, `processMLExportQueue()`), legacy queue tables (`ml_export_queue`, `ml_export_history`), and legacy sheet targets (`DailySummary`, `ItemSales`, `WeatherTimeline`). Replaced by the isolated **AI Dataset Sync Architecture**.

---

## 21. Future Roadmap

* **Phase 2**: Implement read-only SQL query builders & data exporters inside `services/aiDataset/` (Admin App CSV generator).
* **Phase 3**: Connect Admin App UI export trigger to Google Sheets WebApp using `processAIDatasetQueue()`.
