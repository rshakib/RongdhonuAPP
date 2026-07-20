# PROJECT_CONTEXT.md — Rongdhonu Café & Restaurant System

This document serves as the single source of truth for the **Rongdhonu (রংধনু) Café & Restaurant Management System** codebase.

---

## 1. Project Overview

**Rongdhonu (রংধনু)** is an offline-first Point-of-Sale (POS), billing, financial management, daily reconciliation, supplier due ledger, payroll, and business reporting mobile application built for restaurant operations.

### Key Capabilities:
- **Table & Delivery POS Billing**: Manage 8 fixed dining tables (`T-1` to `T-4`, `কাচ`, `গাছ`, `বাহির`, `Extra`) and custom delivery orders (`D-*`). Real-time table item management, split payment checkout (Cash, bKash, Nagad, Rocket), and instant receipt calculation.
- **Offline-First Architecture**: Stores all data locally using `expo-sqlite` (`rongdhonu.db`). Performs background cloud synchronization to Google Cloud Firestore via REST API calls.
- **Daily Reconciliation & Eja Rollover**: End-of-day register closure, vendor expense deduction, net cash calculation, owner deposit entry, and automatic next-day lease (*Eja*) carry-forward.
- **Supplier Due Ledger**: Accounts payable ledger tracking vendor dues (`dudu_store`, `akash_murgi`, `burger_bun`), daily purchases, payments, and historical ledger records.
- **Owner Financial & Payroll Suite**: Staff profiles (`owner_employees`), salary and advance ledgers (`owner_salary_ledger`), owner expenses (`owner_expenses`), and monthly owner deposit tracking.
- **ML Dataset Backup Engine**: Queues hourly weather snapshots and daily itemized sales data, pushing exports to Google Sheets via Google Apps Script WebApp (`Rongdhonu_ML_Dataset`).
- **Audit & Diagnostics**: Comprehensive deletion snapshot auditing (`delete_history`, `deletions`), sync queue health metrics, and raw SQLite database inspection tools for administrators.

---

## 2. Tech Stack

- **Core Framework**: React Native `0.85.3` with Expo SDK `~56.0.11` (React `19.2.3`).
- **Language**: JavaScript (ES6+ / CommonJS/ES Modules).
- **Local Database**: Native SQLite via `expo-sqlite` (`~56.0.5`) using synchronous API methods (`openDatabaseSync`, `getFirstSync`, `getAllSync`, `runSync`, `execSync`).
- **Cloud Database**: Google Cloud Firestore via REST API (`v1` HTTP `PATCH`, `DELETE`, `POST` endpoints).
- **State Management**: React Component Local State (`useState`, `useEffect`) lifted to `App.js` with direct SQLite sync triggers.
- **Network Monitoring**: `@react-native-community/netinfo` (`^12.0.1`).
- **Document & PDF Generation**: `expo-print` (`~56.0.4`) and `expo-sharing` (`~56.0.17`).
- **UI & Layout**: Custom Vanilla React Native Components (`View`, `Text`, `TouchableOpacity`, `TextInput`, `Modal`, `ScrollView`, `FlatList`), `SafeAreaProvider` from `react-native-safe-area-context` (`~5.7.0`), `StatusBar` from `expo-status-bar` (`~56.0.4`).
- **Build & Distribution**: EAS Build (`eas.json`), targeting Android APK (`com.riajulshakib.rongdhonu`, version code 2).

---

## 3. Folder Structure

```
/
├── AGENTS.md                          # Strict instruction: Expo SDK v56.0.0 documentation rule
├── CLAUDE.md                          # Reference pointer to AGENTS.md
├── .env                               # Firebase API keys, project ID, Google Sheets WebApp URL
├── app.json                           # Expo project manifest & native android configuration
├── package.json                       # Dependencies, scripts, and package manifests
├── eas.json                           # EAS build profiles (preview, development, production)
├── credentials.json                   # Android keystore reference
├── index.js                           # Root entry point registering App component
├── App.js                             # Root component, router, global modals, sync timers
├── database.js                        # Core SQLite DB engine, schemas, REST sync, business functions (~5.4k lines)
├── pdfHelper.js                       # PDF HTML template generator and sharing helper
├── firestore_count.js                 # Node.js CLI script for Firestore collection document counts
├── scripts/
│   └── firestore-sync-audit.js        # Node.js CLI audit script comparing local/remote cutoffs
├── screens/                           # React Native Screen Components
│   ├── LoginScreen.js                 # PIN & username authentication, sync mode selector
│   ├── OwnerDashboard.js              # Owner role dashboard
│   ├── ManagerDashboard.js            # Manager role operational dashboard
│   ├── AdminDB.js                     # Admin control panel, stats, query runner, lock reset
│   ├── TableDetailScreen.js           # Order management for selected table or delivery
│   ├── AddItemScreen.js               # Menu selector grid & menu management (add/edit/delete)
│   ├── PaymentCheckoutScreen.js       # Split payment checkout screen
│   ├── PaymentSuccess.js              # Payment receipt confirmation
│   ├── DailySubmitScreen.js           # End-of-day register closure & locking
│   ├── ExpensesScreen.js              # Vendor daily expenses entry form
│   ├── SupplierDueScreen.js           # Supplier due ledger & purchase/payment records
│   ├── DailyItemSalesReport.js        # Itemized sales analytics & unsold inventory report
│   ├── SyncDiagnosticsScreen.js        # Sync queue inspector & failure diagnostic log
│   ├── DeleteHistoryScreen.js         # Audit log of deleted records with full JSON snapshots
│   ├── SystemToolsScreen.js           # Admin diagnostic hub landing screen
│   ├── DatabaseHealthScreen.js        # PRAGMA integrity check screen
│   ├── SyncStatusScreen.js            # REST sync status monitoring
│   ├── DatabaseStatsScreen.js         # Record counts across all 20+ tables
│   ├── SystemInfoScreen.js            # Device environment info
│   ├── DatabaseExplorerScreen.js      # Table inspector
│   ├── TableViewerScreen.js           # SQLite table rows browser
│   ├── RowDetailScreen.js             # Single row JSON viewer
│   ├── OwnerFinanceDashboard.js        # Owner financial suite overview
│   ├── EmployeeListScreen.js          # Staff directory
│   ├── AddEmployeeScreen.js           # Employee add/edit form
│   ├── EmployeeDetailScreen.js        # Employee profile & salary history
│   ├── AddSalaryPaymentScreen.js      # Salary & advance payment form
│   └── OwnerExpenseScreen.js          # Owner personal/business expense ledger
├── assets/                            # Application icons & splash screen images
├── credentials/                       # Native Android keystore file (credentials/android/keystore.jks)
└── image/                             # Logos, branding graphics, screenshots
```

---

## 4. Core Modules / Features

### 1. POS Billing & Table Management
- **Files**: `App.js`, `screens/TableDetailScreen.js`, `screens/AddItemScreen.js`, `screens/PaymentCheckoutScreen.js`, `screens/PaymentSuccess.js`, `database.js`.
- **Functions**: `getTables()`, `updateTableState()`, `updateTableName()`, `getDeliveries()`, `createDelivery()`, `updateDeliveryState()`, `addCompletedOrder()`, `updateCompletedOrder()`, `deleteCompletedOrder()`.
- **Data Path**: Reads/writes locally to SQLite tables `restaurant_tables`, `deliveries`, `orders`, `order_items`, `payments`. Synchronizes to Firestore collections via `enqueueSync()`.

### 2. Menu Management
- **Files**: `screens/AddItemScreen.js`, `database.js`.
- **Functions**: `getMenuItems()`, `addMenuItem()`, `updateMenuPrice()`, `deleteMenuItem()`, `cleanupDuplicateMenuItems()`, `recoverMenuFromCloud()`.
- **Data Path**: Operates on `menu_items` and `menu_categories` tables in SQLite with automatic compound `UNIQUE(name, category)` migration. Syncs updates and tombstones to Firestore.

### 3. Daily Reconciliation & Eja Rollover
- **Files**: `screens/DailySubmitScreen.js`, `App.js`, `database.js`.
- **Functions**: `submitDailySheet()`, `checkAndApplyIjaraRollover()`, `calculateAndSaveDailySummary()`, `resetDailySubmitLock()`, `resetIjaraExpense()`.
- **Data Path**: Reads from `orders`, `payments`, `expenses`. Writes to `daily_submit`, `daily_summary`, `eja_history`, `app_config`. Automatically rolls over Eja on app startup/timer tick when `todayStr >= pendingDateStr`.

### 4. Vendor Expenses & Supplier Due Ledger
- **Files**: `screens/ExpensesScreen.js`, `screens/SupplierDueScreen.js`, `database.js`.
- **Functions**: `getDailyExpenses()`, `updateDailyExpenses()`, `getSupplierDueData()`, `saveSupplierDue()`, `getSupplierDueHistory()`, `deleteSupplierDueHistory()`, `getSupplierPaymentLedger()`, `saveSupplierPayment()`.
- **Data Path**: Writes to SQLite tables `expenses`, `supplier_due`, `supplier_due_history`, `supplier_payment_ledger`. Enqueues Firestore sync for each transaction.

### 5. Owner Financial & Payroll Suite
- **Files**: `screens/OwnerFinanceDashboard.js`, `screens/EmployeeListScreen.js`, `screens/AddEmployeeScreen.js`, `screens/EmployeeDetailScreen.js`, `screens/AddSalaryPaymentScreen.js`, `screens/OwnerExpenseScreen.js`, `database.js`.
- **Functions**: `getOwnerEmployees()`, `saveOwnerEmployee()`, `updateOwnerEmployee()`, `deleteOwnerEmployee()`, `saveSalaryLedgerEntry()`, `getEmployeeSalaryLedger()`, `deleteSalaryLedgerEntry()`, `saveOwnerExpense()`, `getOwnerExpenses()`, `deleteOwnerExpense()`, `saveOwnerDeposit()`, `getTotalOwnerDeposits()`.
- **Data Path**: Operates on `owner_employees`, `owner_salary_ledger`, `owner_expenses`, `owner_deposits` SQLite tables and syncs to Firestore.

### 6. Cloud Sync Engine & Diagnostics
- **Files**: `App.js`, `database.js`, `screens/SyncDiagnosticsScreen.js`, `scripts/firestore-sync-audit.js`.
- **Functions**: `startSyncService()`, `processSyncQueue()`, `syncRecordImmediately()`, `syncCollections()`, `syncHighFrequencyCollections()`, `syncLowFrequencyCollections()`, `restoreDatabaseFromCloud()`, `getSyncRuntimeDiagnostics()`.
- **Data Path**: Operates on `sync_queue` table. Executes HTTP REST requests to Google Cloud Firestore.

### 7. Audit & Deletion History
- **Files**: `screens/DeleteHistoryScreen.js`, `database.js`.
- **Functions**: `logDeleteHistory()`, `recordDeletion()`, `getDeleteHistory()`.
- **Data Path**: Writes full JSON record snapshots to `delete_history` table and tombstone identifiers to `deletions` table before executing SQLite `DELETE` queries.

---

## 5. Database Schema

The SQLite database (`rongdhonu.db`) contains 22 tables. Master and operational tables are synchronized with corresponding Google Cloud Firestore collections.

| SQLite Table Name | Primary Key | Key Columns | Sync to Firestore? |
| :--- | :--- | :--- | :--- |
| `users` | `id` | `username`, `pin`, `role`, `display_name`, `created_at`, `updated_at`, `is_synced` | Yes (`users`) |
| `restaurant_tables` | `id` | `table_id`, `table_name`, `status`, `items` (JSON), `startTime`, `updated_at`, `is_synced` | Yes (`restaurant_tables`) |
| `orders` | `id` | `table_id`, `items`, `subtotal`, `discount`, `delivery_charge`, `change_money_given`, `cash_amount`, `bkash_amount`, `nagad_amount`, `rocket_amount`, `grand_total`, `payment_status`, `payment_method`, `time`, `locked_at`, `is_synced` | Yes (`orders`) |
| `order_items` | `id` | `order_id`, `itemName`, `quantity`, `unit_price`, `revenue`, `is_synced` | Yes (`order_items`) |
| `payments` | `id` | `order_id`, `total_amount`, `customer_paid`, `discount_amount`, `cash_amount`, `bkash_amount`, `nagad_amount`, `rocket_amount`, `payment_method`, `paid_at`, `is_synced` | Yes (`payments`) |
| `expenses` | `id` | `category`, `amount`, `note`, `is_due`, `given_amount`, `used_amount`, `returned_amount`, `is_synced` | Yes (`expenses`) |
| `deliveries` | `id` | `customer_name`, `amount`, `status`, `items` (JSON), `startTime`, `delivery_charge`, `change_money_given`, `completed_at`, `is_synced` | Yes (`deliveries`) |
| `daily_submit` | `id` | `date`, `total_sell`, `cash_payment`, `bkash_payment`, `nagad_payment`, `rocket_payment`, `delivery_sell`, `delivery_charge`, `eja`, `dudu_store`, `akash_murgi`, `burger_bun`, `bazar`, `others`, `total_expense`, `net_cash`, `net_deposit`, `notes`, `submitted_by`, `is_locked`, `submission_type`, `is_synced` | Yes (`daily_submit`) |
| `daily_summary` | `id` | `date`, `dayOfWeek`, `weekOfMonth`, `isFriday`, `isHoliday`, `specialDayNote`, `temperature`, `humidity`, `condition`, `totalOrders`, `totalSales`, `totalDiscount`, `totalExpense`, `totalDelivery`, `averageOrderValue`, `peakHour`, `cashTotal`, `bkashTotal`, `nagadTotal`, `rocketTotal`, `ejaAmount`, `netCash`, `ownerDeposit`, `itemSummary` (JSON), `is_synced` | Yes (`daily_summary`) |
| `menu_categories` | `id` | `name`, `is_synced` | Yes (`menu_categories`) |
| `menu_items` | `id` | `name`, `price`, `category`, `is_synced` (Compound `UNIQUE(name, category)`) | Yes (`menu_items`) |
| `due_payments` | `id` | `customer_name`, `amount`, `order_id`, `status`, `is_synced` | Yes (`due_payments`) |
| `eja_history` | `id` | `date`, `eja_amount`, `is_synced` | Yes (`eja_history`) |
| `off_days` | `id` | `date`, `created_by`, `reason`, `status`, `is_synced` | Yes (`off_days`) |
| `weather_data` | `id` | `date`, `temperature`, `humidity`, `condition`, `isRainy`, `windSpeed`, `is_synced` | Yes (`weather_data`) |
| `sync_queue` | `id` (AUTOINCREMENT) | `record_id`, `table_name`, `action` (`INSERT`/`UPDATE`/`DELETE`), `status` (`PENDING`/`SUCCESS`/`FAILED`), `created_at`, `retry_count`, `last_error`, `last_attempt_at` | No (Local Sync Queue) |
| `notifications` | `id` | `title`, `message`, `read`, `is_synced` | Yes (`notifications`) |
| `app_config` | `id` | `key`, `value`, `is_synced` | Yes (`app_config`) |
| `ml_export_history` | `id` | `date`, `type`, `exported_at`, `is_synced` | Yes (`ml_export_history`) |
| `ml_export_queue` | `id` | `type`, `business_date`, `payload` (JSON), `status`, `is_synced` | No (Local Export Queue) |
| `supplier_due` | `id` | `supplier_name`, `current_due`, `note`, `is_synced` | Yes (`supplier_due`) |
| `supplier_due_history` | `id` | `date`, `supplier_id`, `supplier_name`, `previous_due`, `purchase_amount`, `payment_amount`, `current_due`, `note`, `created_by`, `is_synced` | Yes (`supplier_due_history`) |
| `supplier_payment_ledger` | `id` | `payment_date`, `month`, `year`, `variety_store_amount`, `morgir_dokan_amount`, `burger_ban_amount`, `created_by`, `is_synced` | Yes (`supplier_payment_ledger`) |
| `deletions` | `id` | `table_name`, `record_id`, `is_synced` | Yes (`app_config`) |
| `delete_history` | `id` | `record_type`, `record_id`, `deleted_by`, `deleted_at`, `created_by`, `original_created_at`, `snapshot_data` (JSON), `is_synced` | Yes (`delete_history`) |
| `daily_submit_priority` | `business_date` | `submitted_by`, `role`, `priority`, `sync_source_device`, `is_synced` | Yes (`daily_submit_priority`) |
| `owner_employees` | `id` | `name`, `phone`, `designation`, `monthly_salary`, `joining_date`, `status`, `notes`, `is_synced` | Yes (`owner_employees`) |
| `owner_salary_ledger` | `id` | `employee_id` (FK -> `owner_employees.id`), `amount`, `payment_type`, `payment_date`, `notes`, `is_synced` | Yes (`owner_salary_ledger`) |
| `owner_expenses` | `id` | `category`, `amount`, `expense_date`, `notes`, `is_synced` | Yes (`owner_expenses`) |
| `owner_deposits` | `id` | `month`, `amount`, `created_at`, `is_synced` | Yes (`owner_deposits`) |

---

## 6. Data Flow & Sync Engine

```
[UI Screen]
    │
    ▼
[Database Wrapper Function in database.js]
    │
    ├─► 1. Execute SQL in SQLite (rongdhonu.db) via expo-sqlite sync methods
    │
    └─► 2. Call enqueueSync(tableName, recordId, action)
            │
            ▼
       [sync_queue Table in SQLite] (status = 'PENDING')
            │
            ▼ (Every 5 seconds via Background Daemon in startSyncService())
       [processSyncQueue()]
            │
            ├─► Converts SQLite row to Firestore REST Document Format
            │
            └─► HTTP PATCH / DELETE to Google Cloud Firestore REST API
                    │
                    ├─► SUCCESS: DELETE from sync_queue & UPDATE local is_synced = 1
                    │
                    └─► FAILURE: Mark status = 'FAILED', increment retry_count, save last_error
```

### Cloud-to-Local Pull Sync Flow:
1. `syncCollections(collectionsList)` checks `last_sync_time_<table_name>` in `app_config`.
2. Queries Firestore REST API `runQuery` for documents where `updated_at > lastSyncTime` with a **60-second safety overlap window**.
3. Reconciles incoming remote documents with local rows:
   - If local row does not exist or cloud `updated_at` is newer, executes `INSERT OR REPLACE` into local SQLite with `is_synced = 1`.
   - Preserves valid SQLite schema columns (`PRAGMA table_info`) to prevent crashes on schema drift.

---

## 7. Navigation & App Architecture

Application navigation uses a **Custom State Router** managed at the root component ([App.js](file:///run/media/shaki/2472D89F72D87750/Apps/rong/App.js)).

```
LoginScreen
    │
    ├─► Owner Role ──► OwnerDashboard
    │                     ├─► OwnerFinanceDashboard ──► EmployeeListScreen / AddEmployeeScreen / EmployeeDetailScreen / AddSalaryPaymentScreen / OwnerExpenseScreen
    │                     ├─► TableDetailScreen ──► AddItemScreen / PaymentCheckoutScreen ──► PaymentSuccess
    │                     ├─► DailySubmitScreen
    │                     ├─► ExpensesScreen
    │                     ├─► SupplierDueScreen
    │                     └─► DailyItemSalesReport
    │
    ├─► Manager Role ─► ManagerDashboard
    │                     ├─► TableDetailScreen ──► AddItemScreen / PaymentCheckoutScreen ──► PaymentSuccess
    │                     ├─► DailySubmitScreen
    │                     ├─► ExpensesScreen
    │                     ├─► SupplierDueScreen
    │                     └─► DailyItemSalesReport
    │
    └─► Admin Role ───► AdminDB
                          ├─► SystemToolsScreen ──► DatabaseHealthScreen / SyncStatusScreen / DatabaseStatsScreen / SystemInfoScreen / DatabaseExplorerScreen ──► TableViewerScreen ──► RowDetailScreen
                          ├─► DeleteHistoryScreen
                          ├─► SyncDiagnosticsScreen
                          └─► (All POS & Finance Screens)
```

---

## 8. Authentication

- **Method**: Local Username & 4-Digit PIN Authentication verified against the `users` SQLite table.
- **Default Seeded Accounts**:
  1. `rokib` (PIN: `1111`, Role: `owner`, Display: `মালিক (Owner)`)
  2. `m` (PIN: `1111`, Role: `manager`, Display: `ম্যানেজার (Manager)`)
  3. `a` (PIN: `1323`, Role: `admin`, Display: `অ্যাডমিন (Admin)`)
- **Session State**: Saved locally in `app_config` (`remembered_username`, `login_session_user`).
- **Sync Mode Options**:
  - `Online Only`: Blocks app interaction via a full-screen modal overlay if internet connection is lost.
  - `Online + Offline` (Hybrid): Allows offline POS operations and background queueing.

---

## 9. Known Conventions

1. **Expo Version Directive**: Per [AGENTS.md](file:///run/media/shaki/2472D89F72D87750/Apps/rong/AGENTS.md), all code must strictly follow **Expo SDK v56.0.0** documentation standards.
2. **Database Binding Safety**: `database.js` wraps SQLite query methods with a proxy that replaces `null` or `undefined` binding array values with empty strings `""` to prevent `expo-sqlite` JNI native null pointer crashes.
3. **Deterministic Record IDs**:
   - Expenses: `exp_YYYY-MM-DD_<category_name>`
   - Eja History: `eja_YYYY-MM-DD`
   - Supplier Due Ledger: `spl_YYYY-MM-DD`
   - Daily Submit / Summary: `YYYY-MM-DD`
   - Order Items: `<order_id>_item_<index>`
   - Deletion Tombstones: `<table_name>_<record_id>`
4. **Bangla Text & Currency**: Currency values are rendered with the Bangladeshi Taka symbol (`৳`). Dates are displayed using `formatDisplayDate()` (`DD MMM YYYY`).

---

## 10. Things Unclear or Undocumented

1. **Duplicated Menu Definitions**: Default menu array is defined in both [database.js](file:///run/media/shaki/2472D89F72D87750/Apps/rong/database.js#L78-L153) (`DEFAULT_MENU`) and [App.js](file:///run/media/shaki/2472D89F72D87750/Apps/rong/App.js#L131-L181) (`defaultMenu`).
2. **Environment Variable Storage**: Production Firebase REST API keys and Google Apps Script URLs are stored directly in `.env` inside the repository.
3. **Hardcoded Coordinates in Weather API**: `triggerWeatherFetch()` hardcodes Bangladesh coordinates (`latitude=24.8759&longitude=90.6627` - Netrokona).
