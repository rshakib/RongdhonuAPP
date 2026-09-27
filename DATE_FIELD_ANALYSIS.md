# RONGDHONU POS — BUSINESS DATE & FIELD ANALYSIS FOR DATA RETENTION

> **Purpose:** Code-accurate audit of date, timestamp, and business day representations across all 15 transactional tables in Rongdhonu POS.  
> **Target Use Case:** Designing cutoff filter expressions and schema columns for a **31-day rolling data retention job in Supabase** (via `pg_cron`).  
> **Codebase Baseline:** All citations reference exact files and line numbers in `/home/shakib/Downloads/rong`.

---

## Executive Summary & Critical Findings

1. **Two Distinct Types of Transactional Tables Exist:**
   - **Date-First Tables** (`daily_submit`, `daily_summary`, `eja_history`, `off_days`, `weather_data`, `supplier_due_history`, `supplier_payment_ledger`, `owner_expenses`, `activity_logs`): These have an explicit calendar date column (`date`, `payment_date`, `expense_date`, or `business_date`) storing `YYYY-MM-DD`.
   - **Timestamp-Only Tables** (`orders`, `order_items`, `payments`, `expenses`, `deliveries`, `due_payments`): These **lack** a standalone `business_date` column. In local SQLite, their business day is dynamically evaluated via `date(created_at, 'localtime')` or `date(completed_at, 'localtime')`.
2. **Late-Night Rollover Rule (12:00 AM Midnight):**
   - For POS transactions (`orders`, `order_items`, `payments`, `expenses`), the app **strictly rolls over at 12:00:00 AM local midnight**. There is **no 4:00 AM or late-night shift grace period** for core POS transactions. An order placed at 12:30 AM is assigned to the new calendar date.
   - **Exception 1 (`deliveries`):** In [`database.js` L3468](database.js#L3468), daily summary queries deliveries using `date(completed_at, 'localtime', '-1 hour')`, creating a 1-hour grace window (up to 01:00 AM) that is **not** present anywhere else.
   - **Exception 2 (`device_app_usage`):** [`services/appUsageTracker.js` L25–L44](services/appUsageTracker.js#L25-L44) implements a **06:00 AM cutoff** exclusively for telemetry.
3. **Timezone Handling Reality:**
   - The app **does not enforce `Asia/Dhaka` via code**.
   - Timestamps are generated in JavaScript via `new Date().toISOString()` (UTC).
   - Local conversion relies on SQLite's `'localtime'` modifier, which resolves to the device OS timezone. The app assumes the POS tablet is set to Bangladesh Standard Time (BST, UTC+6).
4. **Dangerous UTC Date Leak in `activity_logs`:**
   - In [`services/activityLogger.js` L53](services/activityLogger.js#L53), `now.toISOString().split('T')[0]` is used as the default `business_date`. Because this extracts the **UTC** date, actions performed in Bangladesh between 12:00 AM and 05:59 AM BST receive **yesterday's** `business_date`.

---

## 1. Table-by-Table Field Analysis (15 Tables)

### 1.1. `orders`

* **Schema Definition:** [`database.js` L195–L214](database.js#L195-L214)
* **Date / Timestamp Columns:**
  * `time` (`TEXT`): Human-readable display time (e.g. `"10:30 PM"` or `"12:15 AM"`).
  * `created_at` (`TEXT`): ISO 8601 UTC timestamp (`YYYY-MM-DDTHH:mm:ss.sssZ`).
  * `updated_at` (`TEXT`): ISO 8601 UTC timestamp.
  * `locked_at` (`TEXT`): ISO 8601 UTC timestamp set at daily submit or order creation.
* **Actual Business Day Column:**
  * **No explicit business date column exists.**
  * In code, the business day is derived dynamically:
    * In SQLite: `date(created_at, 'localtime')` ([`database.js` L3430](database.js#L3430), [L5320](database.js#L5320), [L5526](database.js#L5526), [L6053](database.js#L6053); [`App.js` L1169](App.js#L1169)).
    * In JS: `getBusinessDateFromISO(r.created_at)` ([`database.js` L4455](database.js#L4455), defined at [L5798](database.js#L5798)).
* **Code Setting Values:**
  * [`database.js` L4467, L4524–L4534](database.js#L4467) (`addCompletedOrder`):
    ```javascript
    const nowIso = new Date().toISOString();
    // Inserted into orders as created_at, updated_at, locked_at
    ```
* **Supabase Retention Cutoff Recommendation:**
  * Use `(created_at AT TIME ZONE 'Asia/Dhaka')::date < cutoff_date` OR add a dedicated `business_date DATE` column populated on insert.

---

### 1.2. `order_items`

* **Schema Definition:** [`database.js` L215–L227](database.js#L215-L227)
* **Date / Timestamp Columns:**
  * `created_at` (`TEXT`): ISO 8601 UTC timestamp.
  * `updated_at` (`TEXT`): ISO 8601 UTC timestamp.
* **Actual Business Day Column:**
  * **No explicit business date column exists.**
  * Derived from `date(created_at, 'localtime')` ([`database.js` L3195](database.js#L3195), [L3526](database.js#L3526)), or joined via `order_id` to `orders.id`.
* **Code Setting Values:**
  * [`database.js` L4575–L4585](database.js#L4575):
    ```javascript
    const nowIso = new Date().toISOString();
    // Inserted into order_items as created_at, updated_at
    ```
* **Supabase Retention Cutoff Recommendation:**
  * Use `(created_at AT TIME ZONE 'Asia/Dhaka')::date < cutoff_date` OR cascade delete via Foreign Key to `orders(id) ON DELETE CASCADE`.

---

### 1.3. `payments`

* **Schema Definition:** [`database.js` L229–L250](database.js#L229-L250)
* **Date / Timestamp Columns:**
  * `paid_at` (`TEXT`): ISO 8601 UTC timestamp.
  * `created_at` (`TEXT`): ISO 8601 UTC timestamp.
  * `updated_at` (`TEXT`): ISO 8601 UTC timestamp.
* **Actual Business Day Column:**
  * **No explicit business date column exists.**
  * Derived from `date(created_at, 'localtime')` ([`database.js` L3474](database.js#L3474); [`App.js` L1170](App.js#L1170)).
* **Code Setting Values:**
  * [`database.js` L4540–L4556](database.js#L4540):
    ```javascript
    const nowIso = new Date().toISOString();
    // Inserted into payments as paid_at, created_at, updated_at
    ```
* **Supabase Retention Cutoff Recommendation:**
  * Use `(created_at AT TIME ZONE 'Asia/Dhaka')::date < cutoff_date` OR cascade delete via FK to `orders(id)`.

---

### 1.4. `expenses`

* **Schema Definition:** [`database.js` L251–L265](database.js#L251-L265)
* **Date / Timestamp Columns:**
  * `created_at` (`TEXT`): ISO 8601 UTC timestamp.
  * `updated_at` (`TEXT`): ISO 8601 UTC timestamp.
* **Actual Business Day Column:**
  * In the schema, there is no `date` column.
  * However, the **business date is embedded directly inside the primary key `id`**:
    * Pattern: `exp_${todayStr}_${categoryName}` (e.g. `exp_2026-09-27_দুদু_স্টোর`).
    * In SQLite queries: `date(created_at, 'localtime') = ?` ([`database.js` L4633](database.js#L4633), [L3462](database.js#L3462), [L6084](database.js#L6084)) OR `id LIKE 'exp_' || ? || '_%'` ([L2981](database.js#L2981)).
* **Code Setting Values:**
  * [`database.js` L4837–L4862](database.js#L4837) (`updateDailyExpenses`):
    ```javascript
    const todayStr = getBusinessDate(); // YYYY-MM-DD local
    const now = new Date().toISOString();
    const stableId = `exp_${todayStr}_${cat.name.replace(/\s+/g, '_')}`;
    // Inserted with id=stableId, created_at=now, updated_at=now
    ```
* **Supabase Retention Cutoff Recommendation:**
  * Use `(created_at AT TIME ZONE 'Asia/Dhaka')::date < cutoff_date`.
  * For Supabase, adding an explicit `expense_date DATE NOT NULL` column during migration is strongly recommended.

---

### 1.5. `deliveries`

* **Schema Definition:** [`database.js` L266–L280](database.js#L266-L280)
* **Date / Timestamp Columns:**
  * `startTime` (`TEXT`): Timestamp/time string when the delivery started.
  * `created_at` (`TEXT`): ISO 8601 UTC timestamp.
  * `completed_at` (`TEXT`): ISO 8601 UTC timestamp populated upon order completion.
  * `updated_at` (`TEXT`): ISO 8601 UTC timestamp.
* **Actual Business Day Column:**
  * **No explicit business date column exists.**
  * In code, the business day is derived from `completed_at` for finished deliveries, and `created_at` for active ones.
  * **Critical Inconsistency:**
    * In `calculateAndSaveDailySummary()` ([`database.js` L3468](database.js#L3468)):
      ```sql
      SELECT * FROM deliveries 
      WHERE date(completed_at, 'localtime', '-1 hour') = ? AND status = 'COMPLETED'
      ```
    * In `App.js` ([L1172, L1192](App.js#L1172)) and cleanup ([`database.js` L6078](database.js#L6078)):
      ```sql
      WHERE date(created_at, 'localtime') < ? OR date(completed_at, 'localtime') < ?
      ```
      (No `-1 hour` modifier!).
* **Code Setting Values:**
  * [`database.js` L4330–L4343](database.js#L4330) (`createDelivery`): `created_at = new Date().toISOString()`.
  * [`database.js` L4393–L4407](database.js#L4393) (`completeDelivery`): `completed_at = new Date().toISOString()`.
* **Supabase Retention Cutoff Recommendation:**
  * Filter on `COALESCE((completed_at AT TIME ZONE 'Asia/Dhaka')::date, (created_at AT TIME ZONE 'Asia/Dhaka')::date) < cutoff_date`.

---

### 1.6. `daily_submit`

* **Schema Definition:** [`database.js` L281–L309](database.js#L281-L309)
* **Date / Timestamp Columns:**
  * `id` (`TEXT PRIMARY KEY`): Stores `YYYY-MM-DD`.
  * `date` (`TEXT UNIQUE`): Stores `YYYY-MM-DD`.
  * `submitted_at` (`TEXT`): ISO 8601 UTC timestamp.
  * `created_at` (`TEXT`): ISO 8601 UTC timestamp.
  * `updated_at` (`TEXT`): ISO 8601 UTC timestamp.
* **Actual Business Day Column:**
  * **`date`** (and `id`). This is the authoritative business date.
* **Code Setting Values:**
  * [`database.js` L5254–L5290](database.js#L5254) (`submitDailySheet`):
    ```javascript
    const todayStr = summary.bizDate || getBusinessDate();
    const now = new Date().toISOString();
    // db.runSync("INSERT OR REPLACE INTO daily_submit (id, date, ..., submitted_at, created_at, updated_at) VALUES (?, ?, ...)", [todayStr, todayStr, ..., now, now, now]);
    ```
* **Supabase Retention Cutoff Recommendation:**
  * Filter on `date::date < cutoff_date`.
  * *Notice:* In dual-DB migration, `daily_submit` is usually **exempt from 31-day deletion** because `AdminAnalyticsScreen` needs all-time history.

---

### 1.7. `daily_summary`

* **Schema Definition:** [`database.js` L310–L346](database.js#L310-L346)
* **Date / Timestamp Columns:**
  * `id` (`TEXT PRIMARY KEY`): Stores `YYYY-MM-DD`.
  * `date` (`TEXT UNIQUE`): Stores `YYYY-MM-DD`.
  * `firstOrderTime` (`TEXT`): Formatted time string.
  * `lastOrderTime` (`TEXT`): Formatted time string.
  * `created_at` (`TEXT`): ISO 8601 UTC timestamp.
  * `updated_at` (`TEXT`): ISO 8601 UTC timestamp.
* **Actual Business Day Column:**
  * **`date`** (and `id`).
* **Code Setting Values:**
  * [`database.js` L3406, L3550](database.js#L3406) (`calculateAndSaveDailySummary`):
    ```javascript
    const todayStr = dateStr || getBusinessDate();
    // Inserted with id = todayStr, date = todayStr
    ```
* **Supabase Retention Cutoff Recommendation:**
  * Filter on `date::date < cutoff_date`. (Also typically exempt from rolling delete for analytics).

---

### 1.8. `due_payments`

* **Schema Definition:** [`database.js` L370–L380](database.js#L370-L380)
* **Date / Timestamp Columns:**
  * `created_at` (`TEXT`): ISO 8601 UTC timestamp.
  * `updated_at` (`TEXT`): ISO 8601 UTC timestamp.
* **Actual Business Day Column:**
  * **No explicit business date column exists.**
  * Derived from `date(created_at, 'localtime')` ([`database.js` L2979, L6075](database.js#L2979)) or via `order_id` relationship.
* **Code Setting Values:**
  * Legacy table restored from Firestore `due_payments` collection or historical records.
* **Supabase Retention Cutoff Recommendation:**
  * Use `(created_at AT TIME ZONE 'Asia/Dhaka')::date < cutoff_date`.

---

### 1.9. `eja_history`

* **Schema Definition:** [`database.js` L381–L391](database.js#L381-L391)
* **Date / Timestamp Columns:**
  * `id` (`TEXT PRIMARY KEY`): Stores `eja_${todayStr}`.
  * `date` (`TEXT`): Stores `YYYY-MM-DD`.
  * `created_at` (`TEXT`): ISO 8601 UTC timestamp.
  * `updated_at` (`TEXT`): ISO 8601 UTC timestamp.
* **Actual Business Day Column:**
  * **`date`** (and prefix of `id`).
* **Code Setting Values:**
  * [`database.js` L4867–L4874](database.js#L4867) (`updateDailyExpenses`):
    ```javascript
    const ejaId = `eja_${todayStr}`;
    // db.runSync("INSERT OR REPLACE INTO eja_history (id, date, eja_amount, created_at, updated_at, is_synced) VALUES (?, ?, ?, ?, ?, 0)", [ejaId, todayStr, expenses.ijara, now, now]);
    ```
* **Supabase Retention Cutoff Recommendation:**
  * Filter on `date::date < cutoff_date`.

---

### 1.10. `off_days`

* **Schema Definition:** [`database.js` L392–L403](database.js#L392-L403)
* **Date / Timestamp Columns:**
  * `date` (`TEXT UNIQUE`): Stores `YYYY-MM-DD`.
  * `created_at` (`TEXT`): ISO 8601 UTC timestamp.
  * `updated_at` (`TEXT`): ISO 8601 UTC timestamp.
* **Actual Business Day Column:**
  * **`date`**.
* **Code Setting Values:**
  * Synced from Firestore document `off_days/{id}` where `date` is a calendar date string.
* **Supabase Retention Cutoff Recommendation:**
  * Filter on `date::date < cutoff_date`.

---

### 1.11. `weather_data`

* **Schema Definition:** [`database.js` L404–L417](database.js#L404-L417)
* **Date / Timestamp Columns:**
  * `id` (`TEXT PRIMARY KEY`): Stores `YYYY-MM-DD`.
  * `date` (`TEXT UNIQUE`): Stores `YYYY-MM-DD`.
  * `created_at` (`TEXT`): ISO 8601 UTC timestamp.
  * `updated_at` (`TEXT`): ISO 8601 UTC timestamp.
* **Actual Business Day Column:**
  * **`date`** (and `id`).
* **Code Setting Values:**
  * [`database.js` L3362, L3388–L3391](database.js#L3362) (`triggerWeatherFetch`):
    ```javascript
    const todayStr = getBusinessDate();
    const now = new Date().toISOString();
    // db.runSync("INSERT OR REPLACE INTO weather_data (id, date, ..., created_at, updated_at, is_synced) VALUES (?, ?, ..., ?, ?, 0)", [todayStr, todayStr, ..., now, now]);
    ```
* **Supabase Retention Cutoff Recommendation:**
  * Filter on `date::date < cutoff_date`.

---

### 1.12. `supplier_due_history`

* **Schema Definition:** [`database.js` L490–L506](database.js#L490-L506)
* **Date / Timestamp Columns:**
  * `date` (`TEXT`): Stores `YYYY-MM-DD`.
  * `created_at` (`TEXT`): ISO 8601 UTC timestamp.
  * `updated_at` (`TEXT`): ISO 8601 UTC timestamp.
* **Actual Business Day Column:**
  * **`date`**.
* **Code Setting Values:**
  * [`database.js` L4699, L4721–L4727](database.js#L4699) (`saveSupplierDue`):
    ```javascript
    const todayStr = getBusinessDate();
    const now = new Date().toISOString();
    // db.runSync("INSERT OR REPLACE INTO supplier_due_history (id, date, ..., created_at, updated_at, is_synced) VALUES (?, ?, ..., ?, ?, 0)", [historyId, todayStr, ..., now, now]);
    ```
* **Supabase Retention Cutoff Recommendation:**
  * Filter on `date::date < cutoff_date`.

---

### 1.13. `supplier_payment_ledger`

* **Schema Definition:** [`database.js` L507–L520](database.js#L507-L520)
* **Date / Timestamp Columns:**
  * `id` (`TEXT PRIMARY KEY`): Stores `spl_${payment_date}`.
  * `payment_date` (`TEXT UNIQUE`): Stores `YYYY-MM-DD`.
  * `month` (`TEXT`): Stores `YYYY-MM`.
  * `year` (`TEXT`): Stores `YYYY`.
  * `created_at` (`TEXT`): ISO 8601 UTC timestamp.
  * `updated_at` (`TEXT`): ISO 8601 UTC timestamp.
* **Actual Business Day Column:**
  * **`payment_date`**.
* **Code Setting Values:**
  * Manual save: [`database.js` L4783, L4814–L4824](database.js#L4783) (`saveSupplierPayment`).
  * Auto-fill at daily submit: [`database.js` L5296, L5304–L5316](database.js#L5296) (`submitDailySheet`).
* **Supabase Retention Cutoff Recommendation:**
  * Filter on `payment_date::date < cutoff_date`.

---

### 1.14. `owner_expenses`

* **Schema Definition:** [`database.js` L595–L606](database.js#L595-L606)
* **Date / Timestamp Columns:**
  * `expense_date` (`TEXT NOT NULL`): Stores `YYYY-MM-DD`.
  * `created_at` (`TEXT NOT NULL`): ISO 8601 UTC timestamp.
  * `updated_at` (`TEXT NOT NULL`): ISO 8601 UTC timestamp.
* **Actual Business Day Column:**
  * **`expense_date`**.
* **Code Setting Values:**
  * [`database.js` L6681–L6684](database.js#L6681) (`saveOwnerExpense`):
    ```javascript
    const now = new Date().toISOString();
    // db.runSync("INSERT OR REPLACE INTO owner_expenses (id, category, amount, expense_date, notes, created_at, updated_at, is_synced) VALUES (?, ?, ?, ?, ?, ?, ?, 0)", [id, expense.category, expense.amount, expense.expense_date, expense.notes, expense.created_at || now, now]);
    ```
* **Supabase Retention Cutoff Recommendation:**
  * Filter on `expense_date::date < cutoff_date`.

---

### 1.15. `activity_logs`

* **Schema Definition:** [`database.js` L631–L647](database.js#L631-L647)
* **Date / Timestamp Columns:**
  * `business_date` (`TEXT NOT NULL`): Date string.
  * `timestamp` (`TEXT NOT NULL`): ISO 8601 UTC timestamp.
  * `created_at` (`TEXT NOT NULL`): ISO 8601 UTC timestamp.
  * `updated_at` (`TEXT NOT NULL`): ISO 8601 UTC timestamp.
* **Actual Business Day Column:**
  * **`business_date`**.
* **Code Setting Values & Discrepancy:**
  * [`services/activityLogger.js` L52–L54, L87–L90](services/activityLogger.js#L52):
    ```javascript
    const now = new Date();
    const resolvedDate = businessDate || now.toISOString().split('T')[0];
    const timestamp = now.toISOString();
    ```
  * **Warning:** If `businessDate` is not passed explicitly, `now.toISOString().split('T')[0]` resolves to the **UTC date**, NOT the local Bangladesh date!
* **Supabase Retention Cutoff Recommendation:**
  * Filter on `business_date::date < cutoff_date` OR `(created_at AT TIME ZONE 'Asia/Dhaka')::date < cutoff_date`.

---

## 2. Timezone Handling Analysis

### 2.1. Hardcoded vs. Device Local vs. UTC

| Aspect | Actual Implementation in Code | File Reference |
|---|---|---|
| **Raw Timestamps** | **UTC** via `new Date().toISOString()`. Formatted as `YYYY-MM-DDTHH:mm:ss.sssZ`. | Everywhere (`database.js`, `App.js`, `activityLogger.js`) |
| **Local Calendar Date** | **Device Local Time** via `new Date().getFullYear()`, `.getMonth() + 1`, `.getDate()`. | [`database.js` L5786–L5792](database.js#L5786) (`getBusinessDate`) |
| **SQLite Date Conversion** | **Device Local Time** via SQLite builtin `date(created_at, 'localtime')`. | [`database.js` L3430, L4633, L5320, L6053](database.js#L3430) |
| **Hardcoded BST (UTC+6)** | **Only in Telemetry Service** (`getDhakaBusinessDate`). Not used by POS orders or accounting! | [`services/appUsageTracker.js` L25–L44](services/appUsageTracker.js#L25) |

### 2.2. Is Bangladesh Time Enforced in Code?

**No.**
There is no `Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Dhaka' })` or timezone offset calculation anywhere in the transaction path.
The entire POS app assumes:
1. The physical Android device has its system timezone configured to **Bangladesh Standard Time (UTC+6 / Asia/Dhaka)**.
2. Under that assumption, `date(created_at, 'localtime')` converts UTC `created_at` to Bangladesh date.
3. If an Android tablet is incorrectly set to UTC or US Pacific, all SQLite date queries will evaluate according to that device's local clock.

---

## 3. Late-Night Orders & Shift Rollover (11 PM – 2 AM)

### 3.1. Core POS Orders, Payments, Items, and Expenses

For orders placed late at night:
* **Order at 11:45 PM (23:45 BST):**
  * `created_at` = `2026-09-27T17:45:00.000Z` (UTC).
  * SQLite `date('2026-09-27T17:45:00.000Z', 'localtime')` -> **`2026-09-27`**.
  * Matches today's business date.
* **Order at 12:15 AM (00:15 BST):**
  * `created_at` = `2026-09-27T18:15:00.000Z` (UTC).
  * SQLite `date('2026-09-27T18:15:00.000Z', 'localtime')` -> **`2026-09-28`**.
  * **Assigned to the NEXT calendar day.**

> **Conclusion:** There is **NO custom late-night cutoff** (e.g. 4:00 AM) for orders. The restaurant day for orders, items, payments, and expenses rolls over at **12:00:00 AM local midnight**.

### 3.2. The Three Documented Exceptions

1. **`deliveries` (`-1 hour` grace period):**
   * Found in [`database.js` L3468](database.js#L3468):
     ```sql
     SELECT * FROM deliveries 
     WHERE date(completed_at, 'localtime', '-1 hour') = ? AND status = 'COMPLETED'
     ```
   * A delivery completed between 12:00:00 AM and 12:59:59 AM has 1 hour subtracted, so SQLite groups it with **yesterday's** daily summary. At 01:00:00 AM, it rolls over to the new date.
2. **Dashboard UI Initializers (`-3600000` / 1 hour):**
   * Found in:
     * [`screens/DailySubmitScreen.js` L41](screens/DailySubmitScreen.js#L41)
     * [`screens/AdminDB.js` L45, L341](screens/AdminDB.js#L45)
     * [`screens/ManagerDashboard.js` L39](screens/ManagerDashboard.js#L39)
     * [`screens/OwnerDashboard.js` L45, L192](screens/OwnerDashboard.js#L45)
     * [`components/StatCard.js` L18](components/StatCard.js#L18)
   * `const d = new Date(Date.now() - 3600000); // 1-hour offset`
   * **Scope:** This is strictly used for month/year dropdown pickers (e.g., if a manager opens the dashboard at 12:30 AM on the 1st of a new month, the dropdown defaults to the previous month). It does **not** change the business date written to orders or expenses.
3. **App Usage Tracking (06:00 AM cutoff):**
   * Found in [`services/appUsageTracker.js` L25–L44](services/appUsageTracker.js#L25).
   * Shifts the day boundary by 6 hours. Covers 06:00 AM through 05:59:59 AM next day. Strictly for `device_app_usage`.

---

## 4. Date Utility Consistency & Audit

Is there a single shared utility across the codebase? **No.** Date logic is divided across several competing implementations:

| Function / Pattern | Location | Mechanism | Rollover Time | Timezone Basis |
|---|---|---|---|---|
| `getBusinessDate()` | [`database.js` L5786](database.js#L5786) | `d = new Date(); d.getFullYear()...` | 12:00 AM Midnight | Device Local Clock |
| `getBusinessDateFromISO(isoStr)` | [`database.js` L5798](database.js#L5798) | `d = new Date(isoStr); d.getFullYear()...` | 12:00 AM Midnight | Device Local Clock |
| `getBusinessDateOffset(dateStr, n)` | [`database.js` L5049](database.js#L5049) | Calendar day addition/subtraction | N/A | Calendar Date |
| `date(col, 'localtime')` | SQLite queries in `database.js` & `App.js` | SQLite internal localtime conversion | 12:00 AM Midnight | Device Local Clock |
| `date(col, 'localtime', '-1 hour')` | [`database.js` L3468](database.js#L3468) | SQLite internal localtime - 1 hour | **01:00 AM** | Device Local Clock |
| `now.toISOString().split('T')[0]` | [`services/activityLogger.js` L53](services/activityLogger.js#L53) | Raw UTC date string | **06:00 AM BST** (UTC 00:00) | **UTC (Discrepancy!)** |
| `getDhakaBusinessDate()` | [`services/appUsageTracker.js` L38](services/appUsageTracker.js#L38) | Subtracts 6 hours from UTC | **06:00 AM BST** | Asia/Dhaka (Fixed) |

---

## 5. Master Reference: Supabase 31-Day Retention Cutoff Filter

For writing a Supabase `pg_cron` daily cleanup procedure:
```sql
-- Example retention cutoff parameter:
-- cutoff_date := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Dhaka')::date - INTERVAL '31 days';
```

Use the exact filter mappings below:

| # | Table Name | Filter Column in Supabase | Recommended `WHERE` Clause for 31-Day Delete | Notes & Caveats |
|---|---|---|---|---|
| 1 | `orders` | `created_at` | `(created_at AT TIME ZONE 'Asia/Dhaka')::date < cutoff_date` | No `date` column. Consider adding `business_date DATE` during migration. |
| 2 | `order_items` | `created_at` (or FK) | `order_id IN (SELECT id FROM orders WHERE ...)` OR `(created_at AT TIME ZONE 'Asia/Dhaka')::date < cutoff_date` | Better to delete via Foreign Key CASCADE from `orders`. |
| 3 | `payments` | `created_at` (or FK) | `order_id IN (SELECT id FROM orders WHERE ...)` OR `(created_at AT TIME ZONE 'Asia/Dhaka')::date < cutoff_date` | Matches order lifecycle. |
| 4 | `expenses` | `created_at` | `(created_at AT TIME ZONE 'Asia/Dhaka')::date < cutoff_date` | In Supabase, extract date from `id` or add `expense_date DATE`. |
| 5 | `deliveries` | `completed_at` / `created_at` | `COALESCE((completed_at AT TIME ZONE 'Asia/Dhaka')::date, (created_at AT TIME ZONE 'Asia/Dhaka')::date) < cutoff_date` | Handles completed vs active/abandoned deliveries. |
| 6 | `daily_submit` | `date` | **DO NOT DELETE (Exempt)** or `date < cutoff_date` | **WARNING:** `AdminAnalyticsScreen` needs all-time history. Deleting breaks multi-month reports! |
| 7 | `daily_summary` | `date` | **DO NOT DELETE (Exempt)** or `date < cutoff_date` | **WARNING:** Used for executive analytics across full history. |
| 8 | `due_payments` | `created_at` | `(created_at AT TIME ZONE 'Asia/Dhaka')::date < cutoff_date` | Legacy table. |
| 9 | `eja_history` | `date` | `date::date < cutoff_date` | Explicit date string. |
| 10 | `off_days` | `date` | `date::date < cutoff_date` | Explicit date string. |
| 11 | `weather_data` | `date` | `date::date < cutoff_date` | Explicit date string. |
| 12 | `supplier_due_history` | `date` | `date::date < cutoff_date` | Explicit date string. |
| 13 | `supplier_payment_ledger` | `payment_date` | `payment_date::date < cutoff_date` | Explicit date string. |
| 14 | `owner_expenses` | `expense_date` | `expense_date::date < cutoff_date` | Explicit date string. |
| 15 | `activity_logs` | `created_at` | `(created_at AT TIME ZONE 'Asia/Dhaka')::date < cutoff_date` | Do NOT use `business_date` due to the UTC bug in `activityLogger.js`. |

---

*Document generated: 2026-09-27. Based on static analysis of `/home/shakib/Downloads/rong`.*
