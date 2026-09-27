# RONGDHONU POS — QUERY PATTERNS & CONFLICT ANALYSIS

> **Purpose:** Answer two specific pre-migration questions with code-accurate detail.  
> Every claim is backed by file + function/line references.

---

## Table of Contents
1. [Mixed Date-Range Views — Classification](#1-mixed-date-range-views)
2. [Concurrent Edit / Multi-Device Write Conflicts](#2-concurrent-edit--multi-device-write-conflicts)

---

## 1. Mixed Date-Range Views

### Background: The 31-day Boundary

The app locally stores **31 days of recent data** for transactional tables (orders, order_items, payments, expenses, deliveries, daily_submit, daily_summary, etc.) via `restoreDatabaseFromCloud({ mode: 'full' })` at [`database.js` L2530–L2560](database.js#L2530-L2560). Master/reference tables (`users`, `menu_items`, `menu_categories`, `restaurant_tables`, `supplier_due`, `owner_*`) are always fully synced (no date boundary).

A "mixed" view is defined here as: one query or one on-screen dataset that **combines data from within AND beyond the 31-day recent window in a single merged result**.

---

### Category (A) — ALWAYS Recent-Only

These screens only ever query today's data or a short window that never exceeds ~31 days.

---

#### A1. `AdminDB.js` — Main Dashboard

**Screen:** [`screens/AdminDB.js`](screens/AdminDB.js)

| Data | Query | Range |
|---|---|---|
| Today's sales & orders | `getItemSalesReport(todayStr, todayStr)` at [L934](screens/AdminDB.js#L934) | Today only |
| Active tables | `getTables()` at [L4245](database.js#L4245) — all 8 rows always | Always 8 rows |
| Active deliveries | `getDeliveries()` → `status='BUSY'` filter | Today only |
| Monthly total card | `thisMonthSubmissions.filter(item => item.date.startsWith(currentMonthPrefix))` at [L915–L917](screens/AdminDB.js#L915-L917) | Current calendar month only |

**Monthly Total logic in detail** ([L915–L917](screens/AdminDB.js#L915-L917)):
```js
const currentMonthPrefix = todayStr.substring(0, 7);  // e.g. '2026-09'
const thisMonthSubmissions = submissionHistory?.filter(item => item.date?.startsWith(currentMonthPrefix)) || [];
const monthlyTotalSell = thisMonthSubmissions.reduce((sum, item) => sum + (item.sell || 0), 0) + todaySale;
```
`submissionHistory` is fed from the `daily_submit` table — only the current calendar month's rows are used. **No cross-month aggregation.** This card shows "1st of current month → today" only.

**Classification: (A) ALWAYS recent-only.** Never needs data older than the current month.

---

#### A2. `OwnerDashboard.js` / `ManagerDashboard.js` — Role Dashboards

Both share the same `App.js` data layer (tables, deliveries, completedOrders, daily_submit) and show today-only operational data. Classification: **(A) ALWAYS recent-only.**

---

#### A3. `DailySubmitScreen.js` — EOD Submission

Only reads and writes `daily_submit` for `getBusinessDate()` (today). No historical reads.  
Classification: **(A) ALWAYS recent-only.**

---

#### A4. `ExpensesScreen.js` — Daily Expenses

`getDailyExpenses()` at [`database.js` L4630–L4668](database.js#L4630-L4668):
```sql
SELECT * FROM expenses WHERE date(created_at, 'localtime') = ?  -- today only
```
Classification: **(A) ALWAYS recent-only.**

---

#### A5. `OwnerFinanceDashboard.js` — Owner Monthly Finance

**Screen:** [`screens/OwnerFinanceDashboard.js`](screens/OwnerFinanceDashboard.js)

Shows a **month picker** (◀ / ▶ navigation) — users can navigate to any past month. But each view loads **only that one selected month's data** — never two months merged into one result.

Queries executed per month ([L123–L172](screens/OwnerFinanceDashboard.js#L123-L172)):
```js
getMonthlyRestaurantDeposits(currentMonth)   // SUM(net_deposit) WHERE date LIKE '2026-09%'
getMonthlyTotalSalaryPaid(currentMonth)      // SUM WHERE payment_date LIKE '2026-09%'
getOwnerExpenseSummary(currentMonth)         // SUM WHERE expense_date LIKE '2026-09%'
getMonthlyTotalHomeDeposits(currentMonth)    // SUM WHERE month = '2026-09'
getTotalOwnerDeposits()                      // SUM across ALL months — see note below
```

**`getTotalOwnerDeposits()`** ([`database.js` L6825–L6832](database.js#L6825-L6832)):
```sql
SELECT SUM(amount) as total FROM owner_deposits  -- NO date filter: ALL-TIME total
```
This sums every closed month's deposit across the entire app lifetime — it **does** read beyond 31 days. However, this is a **scalar aggregate** (a single number displayed as "মোট জমা"), not a merged row-level dataset.

**Classification: (A) ALWAYS recent-only for row-level data.**  
The `getTotalOwnerDeposits()` all-time aggregate is a scalar rollup — safe as a read-only summary. Each month's detail view is strictly single-month-scoped.

---

#### A6. `EmployeeDetailScreen.js` — Employee Detail + Ledger

**Screen:** [`screens/EmployeeDetailScreen.js`](screens/EmployeeDetailScreen.js)

Queries at [L47–L82](screens/EmployeeDetailScreen.js#L47-L82):
```js
getEmployeeSalaryLedger(employeeId)   // ALL ledger rows: no date filter — ORDER BY payment_date DESC
getEmployeeMonthlySummary(employeeId, currentMonth)  // current month only
getLastEmployeePayment(employeeId)    // LIMIT 1, most recent
```

`getEmployeeSalaryLedger()` at [`database.js` L6492–L6501](database.js#L6492-L6501):
```sql
SELECT * FROM owner_salary_ledger WHERE employee_id = ? ORDER BY payment_date DESC
```
**No date filter** — fetches ALL salary entries for the employee since their first payment, which could easily be older than 31 days for long-tenured employees.

**Classification: (B) ALWAYS historical-only** (full employment history is the purpose of the ledger screen — old records are core to the feature, and no recent transactional data is mixed in).

---

#### A7. `AddSalaryPaymentScreen.js` — Add/Record Salary Payment

Write-only form. No date-range query. Classification: **(A) ALWAYS recent-only.**

---

### Category (B) — ALWAYS Historical-Only

These screens explicitly exist to browse old records with no recent-data mixing.

---

#### B1. `EmployeeDetailScreen.js` — Salary Ledger View

Described above in A6. This screen's ledger list spans the full employment history of an employee. **No recent-data table is mixed in.**  
Classification: **(B) ALWAYS historical-only.**

---

#### B2. `SupplierDueScreen.js` — Supplier Payment Ledger

**Screen:** [`screens/SupplierDueScreen.js`](screens/SupplierDueScreen.js)

Shows a month picker (last 12 months by default, [L56–L65](screens/SupplierDueScreen.js#L56-L65)):
```js
for (let i = 0; i < 12; i++) { /* generate months list going back 12 months */ }
```

Query ([L84](screens/SupplierDueScreen.js#L84)):
```js
getSupplierPaymentLedger(selectedMonthStr)  // WHERE month = '2026-09' — one month only
```

`getSupplierPaymentLedger()` at [`database.js` L4764–L4773](database.js#L4764-L4773):
```sql
SELECT * FROM supplier_payment_ledger WHERE month = ? ORDER BY payment_date ASC
```
Each view is strictly one calendar month. The last 12 months are browseable but only one month is visible at a time.

Classification: **(B) ALWAYS historical-only** (each view is historical; months > 1 ago are older than 31 days but never mixed with recent transactional data).

---

#### B3. `SupplierDueScreen.js` — Supplier Balance History

`getSupplierDueHistory(supplierId)` at [`database.js` L4736–L4742](database.js#L4736-L4742):
```sql
SELECT * FROM supplier_due_history WHERE supplier_id = ? ORDER BY date DESC
```
All-time history for a supplier. No mixing with recent tables. Classification: **(B) ALWAYS historical-only.**

---

### Category (C) — MIXED (Genuinely spans >31 days + recent in one result)

---

#### C1. `AdminAnalyticsScreen.js` — Business Analytics (⚠️ PRIMARY MIXED CASE)

**Screen:** [`screens/AdminAnalyticsScreen.js`](screens/AdminAnalyticsScreen.js)  
**Service:** [`services/analyticsService.js`](services/analyticsService.js)

This is the **main concern** for the dual-DB migration. The screen supports three view modes:

**Monthly comparison mode (default):** User selects any two months from a dropdown. The dropdown includes **every month that has `daily_submit` records** — regardless of age.

`getAvailableMonthsOverview()` at [`analyticsService.js` L77–L120](services/analyticsService.js#L77-L120):
```sql
SELECT
  strftime('%Y-%m', date) as month_key,
  COUNT(DISTINCT date) as submitted_days,
  SUM(total_sell) as total_sales,
  SUM(total_expense) as total_expense,
  SUM(net_deposit) as total_deposit
FROM daily_submit
GROUP BY month_key
ORDER BY month_key ASC
-- NO date filter: spans the ENTIRE lifetime of the restaurant's data
```
This query reads `daily_submit` **across all time** — if the restaurant has been running for 6 months, it returns 6 monthly aggregates. All of them appear in the "current" and "compare" dropdowns simultaneously, allowing the user to select, for example, January 2026 vs. September 2026 in one comparison view.

**Weekly comparison mode:** `getAvailableWeeksOverview()` — same pattern, reads all ISO weeks from `daily_submit` with no date filter.

**Daily detail mode:** `getDailyBreakdown('monthly', currentKey)` — returns all daily rows within a selected month.

**"Why" analysis across two arbitrary periods:**
```js
// AdminAnalyticsScreen.js L132-L160
const curDates = getDatesForPeriod(mode, currentKey);
const cmpDates = getDatesForPeriod(mode, compareKey);
compareExpenseCategories(curDates, cmpDates);  // reads expenses for both periods
analyzeWeatherImpact(curDates);                // reads weather_data for those dates
compareTopItems(curDates, cmpDates, 5);        // reads order_items for both periods
```
These helper functions in `analyticsHelper.js` / `analyticsService.js` query `daily_summary`, `expenses`, `weather_data`, and `order_items` for the specific dates in each selected period — which can be any two months the user picks from the full history.

**Date range: UNBOUNDED.** The user can compare the restaurant's first month of operation with the current month. If that first month is >31 days ago, **this screen will query data that is not in the 31-day local cache**. However, the data IS available locally in `daily_summary` and `daily_submit` (which are `alwaysFull` tables restored completely from Firestore — not date-bounded).

**Note:** `order_items` queries for historical months *would fail* for dates older than 31 days because `order_items` is a `recentOnly` table (only 31 days restored locally). Whether the analytics use `order_items` directly or the pre-aggregated `daily_summary.itemSummary` field needs to be verified for production correctness — but architecturally, `daily_summary` and `daily_submit` are available for all time.

**Classification: (C) MIXED — genuinely queries data spanning any arbitrary historical range in one merged result. This is the only true MIXED screen.**

**Key query functions:**
| Function | File | Line | Data source | Date filter? |
|---|---|---|---|---|
| `getAvailableMonthsOverview()` | `analyticsService.js` | L77 | `daily_submit` | None — all time |
| `getAvailableWeeksOverview()` | `analyticsService.js` | ~L130 | `daily_submit` | None — all time |
| `getDailyBreakdown()` | `analyticsService.js` | ~L200 | `daily_submit` | One month (selected) |
| `compareExpenseCategories()` | `analyticsHelper.js` | — | `expenses` | Two arbitrary periods |
| `analyzeWeatherImpact()` | `analyticsHelper.js` | — | `weather_data` | One arbitrary period |
| `compareTopItems()` | `analyticsHelper.js` | — | `daily_summary.itemSummary` | Two arbitrary periods |

---

#### C2. `DailyItemSalesReport.js` — Item Sales Report (PARTIAL MIXED via cloud download)

**Screen:** [`screens/DailyItemSalesReport.js`](screens/DailyItemSalesReport.js)

The primary query ([L180](screens/DailyItemSalesReport.js#L180)):
```js
const data = getItemSalesReport(startDate, endDate);
```

`getItemSalesReport()` at [`database.js` L3185](database.js#L3185) — reads `order_items` joined with `menu_items` for the given `[startDate, endDate]` window.

**Quick filters available** ([L186–L201](screens/DailyItemSalesReport.js#L186-L201), `getQuickFilterDates()` at [`database.js` L3240–L3265](database.js#L3240-L3265)):
- **Today** → `{start: today, end: today}` ✅ recent-only
- **Yesterday** → yesterday date only ✅ recent (within 31 days)
- **This Week** → start-of-week to today ✅ recent (within 7 days)

**Custom calendar picker** — user can pick ANY historical date. If the date is not in local SQLite, a **cloud download** is triggered (`fetchHistoricalDateData(dateStr)` at [`database.js` L3130](database.js#L3130)):
```js
// DailyItemSalesReport.js L226-L250
const confirmCloudDownload = async () => {
  await fetchHistoricalDateData(pendingDate);  // fetches from Firestore for that date
  // then queries local getItemSalesReport() for that date
};
```
This fetches a **single day's** historical data from Firestore (not a multi-day range). Limit: **7 cloud downloads per day** ([L230](screens/DailyItemSalesReport.js#L230)).

**The query itself is date-range flexible** — `startDate` and `endDate` are user-controlled. A user with the correct downloaded history COULD create a report spanning old and new dates (e.g., "last 6 months" if they downloaded each date), but there is **no built-in multi-date range selection** beyond the 3 quick filters. The calendar only selects a **single day**.

**Classification: (A) ALWAYS recent-only by default.** With manual cloud download, (B) single historical day only — never a true "mixed" dataset from a single query. No UI path produces a combined recent+historical multi-date range in one result.

---

### Summary Table

| Screen | File | Classification | Reason |
|---|---|---|---|
| AdminDB main dashboard | `AdminDB.js` | **(A) Recent-only** | Today + current month only |
| OwnerDashboard / ManagerDashboard | respective `.js` | **(A) Recent-only** | Today only |
| DailySubmitScreen | `DailySubmitScreen.js` | **(A) Recent-only** | Today only |
| ExpensesScreen | `ExpensesScreen.js` | **(A) Recent-only** | Today only |
| OwnerFinanceDashboard | `OwnerFinanceDashboard.js` | **(A) Recent-only** | One month at a time (scalar all-time aggregate is not row-level) |
| DailyItemSalesReport | `DailyItemSalesReport.js` | **(A) Recent-only** (default) | Today/Yesterday/This Week; cloud download adds 1 day at a time |
| EmployeeDetailScreen (ledger tab) | `EmployeeDetailScreen.js` | **(B) Historical-only** | Full employment history, no recent table mixing |
| SupplierDueScreen (payment ledger) | `SupplierDueScreen.js` | **(B) Historical-only** | One month at a time, no recent table mixing |
| **AdminAnalyticsScreen** | **`AdminAnalyticsScreen.js`** | **(C) MIXED ⚠️** | Queries `daily_submit` across ALL time with no date bound; user selects any two arbitrary periods to compare |

> **Migration implication:** Only `AdminAnalyticsScreen` needs cross-time-range read capability. If `daily_submit` and `daily_summary` are migrated to Supabase, the analytics queries must run against a full-history Supabase table — not the 31-day Firebase window. All other screens can be satisfied from the 31-day local cache.

---

## 2. Concurrent Edit / Multi-Device Write Conflicts

### Architecture Context

- There are **3 app profiles** (ADMIN, OWNER, MANAGER) installed on potentially multiple physical devices simultaneously.
- There is **no row-level locking in Firestore** — the sync is optimistic last-write-wins via `updated_at` comparison in `syncCollections()`.
- The sync queue daemon fires every **5 seconds** — meaning two devices writing the same row within 5 seconds is a realistic conflict window.

---

### Category (A) — LOW RISK (Effective Single-Owner Rows)

---

#### A1. `orders` (+ `order_items`, `payments`)

**Schema lock field:** `locked_at TEXT` at [`database.js` L211](database.js#L211).

**Who can write:**
- New orders: created in `App.js` by whichever device is serving that table (`addCompletedOrder()` at [L1694, L1748](App.js#L1694)).
- Order updates: `updateCompletedOrder()` at [`database.js` L5660](database.js#L5660) — only called before `daily_submit`.
- Order delete: `deleteCompletedOrder()` at [`database.js` L5588](database.js#L5588) — Admin only.

**Lock mechanism:** When `submitDailySheet()` runs ([`database.js` L5320](database.js#L5320)):
```sql
UPDATE orders SET locked_at = ? WHERE date(created_at, 'localtime') = ?
```
After the EOD submit, all of today's orders have `locked_at` set. `deleteCompletedOrder()` at [L5606–L5608](database.js#L5606-L5608) checks: if `locked_at IS NOT NULL`, only Admin can delete.

**Conflict risk assessment:** In practice, **orders are session-scoped**. Only the device currently at a table creates that order (the table is marked BUSY on screen, which syncs within 15 seconds to all other devices). There is a narrow race window: two devices could both pick a FREE table simultaneously before the 15s sync delivers the table status update. But `order` rows are distinct per transaction (unique ID = `Date.now()` hex), so the same row is never edited by two devices — the conflict would be two orders for the same table, not two edits to the same order row.

**Classification: (A) LOW RISK.** Rows are effectively single-owner (the device that created the order). Last-write-wins is safe for updates; `locked_at` handles post-submit edit protection.

---

#### A2. `restaurant_tables` (⚠️ HIGHEST OPERATIONAL RISK — but manageable)

**Schema:** `status TEXT`, `items TEXT` (JSON), `startTime TEXT` at [`database.js` L178–L193](database.js#L178-L193).  
No `locked_at` or priority field on `restaurant_tables`.

**Who can write:** All 3 profiles can write table state. `updateTableState()` at [`database.js` L4268](database.js#L4268) is called from `App.js` [L1524, L1773, L1852](App.js#L1524).

**Conflict scenario:**
1. Device A (Admin) and Device B (Manager) both see Table 3 as FREE at the same moment (before B's 15-second pull delivers A's BUSY update).
2. Both devices tap Table 3 → both call `updateTableState('table_3', items, 'BUSY', startTime)`.
3. The later Firestore PATCH wins. The earlier write's items/startTime are silently overwritten.

**No conflict resolution** exists for `restaurant_tables` beyond last-write-wins. The 15-second pull interval limits but does not eliminate this window.

**In practice:** The Admin device is typically the primary POS terminal; Manager devices are used for ordering. Both operate simultaneously. Same-table simultaneous edits are possible but operationally rare because staff coordinate verbally.

**Classification: (A) LOW RISK in practice, last-write-wins is currently acceptable**, but the 15-second sync window is the key vulnerability. Recommend conflict detection (e.g., compare `startTime` before accepting remote updates) when migrating.

---

#### A3. `deliveries`

**Who can write:** Any profile (Admin, Manager) that creates/updates/completes deliveries via `createDelivery()`, `updateDeliveryState()`, `completeDelivery()` at [`database.js` L4329–L4393](database.js#L4329-L4393).

**Conflict risk:** Deliveries have unique IDs (`del_{timestamp}`) and are scoped to a single active delivery session. Two devices could both "complete" the same delivery simultaneously (within 30s high-freq sync window), but each device typically manages its own delivery.

**Classification: (A) LOW RISK.** Rows are effectively device-scoped in practice.

---

#### A4. `users`

**Who can write:** Admin only (user management is Admin-only UI). No scenario where two devices edit the same user concurrently.

**Classification: (A) LOW RISK.** Single writer (Admin device).

---

#### A5. `menu_items`, `menu_categories`

**Who can write:** Admin only (menu management).

**Classification: (A) LOW RISK.** Single writer (Admin device).

---

#### A6. `owner_employees`, `owner_salary_ledger`, `owner_expenses`, `owner_deposits`, `owner_home_deposits`

**Who can write:** Owner only (Owner profile screens). Owner is typically one person on one device.

**Classification: (A) LOW RISK.** Single device in practice.

---

#### A7. `due_payments`

No multi-device write scenario identified. Due payments are created from the checkout flow on the active POS terminal.

**Classification: (A) LOW RISK.**

---

#### A8. `eja_history` (Ijara history)

Created inside `updateDailyExpenses()` / `submitDailySheet()` — only by the device doing the daily submit.

**Classification: (A) LOW RISK.**

---

### Category (B) — NEEDS CONFLICT HANDLING

---

#### B1. `daily_submit` (⚠️ CONFIRMED — Has existing priority system)

**Schema lock fields:**
- `is_locked INTEGER DEFAULT 0` at [`database.js` L305](database.js#L305) — set to `1` after EOD submit; checked by `isDailySubmitLocked()` at [L5035–L5036](database.js#L5035-L5036).

**Who can write:** ALL three profiles (Admin, Manager, Owner) submit daily via `submitDailySheet()` in `App.js`.

**Existing conflict resolution:** `daily_submit_priority` table + remote priority check in `processSyncQueue()`:

**Priority values** ([`database.js` L6372–L6377](database.js#L6372-L6377)):
```js
function getRolePriority(role) {
  if (r === 'owner') return 100;   // Owner submit always wins
  if (r === 'admin') return 50;    // Admin overrides Manager
  if (r === 'manager') return 10;  // Lowest priority
  return 0;
}
```

**Push-time conflict guard** in `processSyncQueue()` at [`database.js` L1729–L1762](database.js#L1729-L1762):
```js
// Before pushing daily_submit to Firestore:
// 1. Fetch remote daily_submit_priority doc for this business_date
// 2. Compare remote priority vs local priority
// 3. If remote priority is HIGHER → skip upload (remote version wins)
// 4. If local priority is HIGHER or equal → push local version
```

**`is_locked` field:** After `submitDailySheet()` runs ([L5291](database.js#L5291)), the local `daily_submit` record is marked but the `is_locked` field is **only checked for today's date** — it prevents re-submission on the same device, not cross-device conflicts.

**Remaining risk after priority system:**
- Two Manager devices (same role, priority=10) can both submit on the same day. Priority check detects equal priority and allows the push — last PATCH to Firestore wins. No winner is declared between two same-role devices.
- Admin can always unlock (`isDailySubmitLocked()` / `is_locked` can be cleared), creating another write opportunity.

**Classification: (B) NEEDS CONFLICT HANDLING.** Existing priority system partially addresses it, but same-role multi-device conflicts are unresolved.

---

#### B2. `expenses` (⚠️ SAME-DAY MULTI-DEVICE WRITE RISK)

**Schema:** No lock field. `id` uses stable pattern `exp_{todayStr}_{category}` at [`database.js` L4850](database.js#L4850).

**Who can write:** Admin and Manager can both write today's expenses via `updateDailyExpenses()` at [`database.js` L4835](database.js#L4835).

**Conflict scenario:**
1. Admin updates "বাজার" expense to ৳500 at 14:00.
2. Manager updates "বাজার" expense to ৳600 at 14:01 (before Admin's write propagates via 30s sync).
3. Both write to the same `id = 'exp_2026-09-27_বাজার'`.
4. Later Firestore PATCH wins silently.

**No conflict detection exists.** The `is_synced = 0` flag only tracks Firestore sync status — it does not detect remote updates that arrive after a local write.

**In practice:** Expenses are typically entered once per day by the Manager during operations and reviewed by Admin. But both can access the screen. The `updateDailyExpenses()` uses `INSERT OR REPLACE` with a **stable ID per date+category** — this means one device's write silently overwrites another's on the same category for the same day.

**Classification: (B) NEEDS CONFLICT HANDLING.** Stable row ID per date+category makes same-row concurrent writes a realistic risk when both Admin and Manager devices are active.

---

#### B3. `supplier_payment_ledger` (PARTIAL PROTECTION — 48h lock exists)

**Schema:** `id = 'spl_{dateStr}'` (one row per date). `created_at` tracked for 48-hour lock. No `locked_at` field per se, but lock enforced in code.

**Who can write:** Admin, Manager, Owner — all can call `saveSupplierPayment()` (accessed via `SupplierDueScreen.js`, available to all roles at [L112](screens/SupplierDueScreen.js#L112)).

**Existing lock** in `saveSupplierPayment()` at [`database.js` L4790–L4796](database.js#L4790-L4796):
```js
const diffHours = (currentTime - createdAt) / (1000 * 60 * 60);
if (diffHours > 48 && userRole !== 'admin') {
  return { success: false, error: "Locked: 48 hours passed since entry creation." };
}
```
Admin can always edit regardless of age.

**Conflict within the 48h window:** Multiple roles can edit the same `spl_2026-09-27` row's individual supplier columns (`variety_store_amount`, `morgir_dokan_amount`, `burger_ban_amount`) — these are partial column updates (`UPDATE ... SET {supplierField} = ?`). Two devices editing different supplier columns on the same row simultaneously is safe (no overlap). Two devices editing the **same supplier column on the same date** would have the last-write-wins outcome.

**Additional conflict path:** `submitDailySheet()` at [`database.js` L5304–L5317](database.js#L5304-L5317) auto-fills `supplier_payment_ledger` from today's expenses at submit time, using `INSERT OR REPLACE`. This could overwrite a manually entered value if EOD submit runs on a different device that has stale expense data.

**Classification: (B) NEEDS CONFLICT HANDLING** (specifically: submit-time auto-fill vs. manual entry conflict). The 48h lock is only a post-edit protection, not a write-conflict guard.

---

#### B4. `supplier_due` (running balance — shared mutable aggregate)

**Schema:** Fixed 3 rows (`dudu_store`, `akash_murgi`, `burger_bun`). `current_due REAL` is a **running total** updated on every supplier transaction.

**Who can write:** Admin, Manager (both use `saveSupplierDue()` via the supplier screen). Owner can also access.

**Conflict scenario:**  
Both Admin and Manager record a purchase for `dudu_store` on the same day:
1. Current due = ৳1000.
2. Admin records purchase ৳200: sets `current_due = 1000 + 200 - payment = 1150`.
3. Manager records purchase ৳300 *before* Admin's sync propagates: reads stale `current_due = 1000`, sets `current_due = 1000 + 300 - payment = 1250`.
4. Later write wins. True running total (1400 before payments) is now wrong.

`saveSupplierDue()` at [`database.js` L4697–L4733](database.js#L4697-L4733) does a direct `UPDATE supplier_due SET current_due = ?` — it reads the current local value, computes the new value, and writes it. **No optimistic lock or compare-and-swap.** Within the 30-second sync window, this is a lost-update race condition.

**Classification: (B) NEEDS CONFLICT HANDLING.** Running-balance aggregates written by multiple roles on the same row are inherently conflict-prone. Recommend converting to append-only ledger + server-side aggregation.

---

### Lock Fields Summary

| Table | Lock Field | Lock Logic |
|---|---|---|
| `orders` | `locked_at TEXT` | Set by `submitDailySheet()` for all today's orders; post-submit delete requires Admin role |
| `daily_submit` | `is_locked INTEGER DEFAULT 0` | Set after EOD submit; prevents re-submit on same device; does NOT prevent cross-device writes |
| `supplier_payment_ledger` | (none explicit, logic in code) | 48h age check in `saveSupplierPayment()` at [L4790–L4796](database.js#L4790-L4796); only blocks non-Admin |
| `devices` (Supabase) | `admin_lock BOOLEAN` | Admin-set device lock preventing login; unrelated to data conflict |
| `owner_deposits` | `isClosed` (derived) | "Month closed" state derived from existence of `owner_deposits` row; prevents new home deposits (UI only) |

---

### Conflict Risk Summary Table

| Table | Writer Roles | Same-Row Risk | Existing Guard | Classification |
|---|---|---|---|---|
| `orders` | All (session-scoped) | Very low (unique ID per transaction) | `locked_at` post-submit | **(A) LOW RISK** |
| `order_items` | All (session-scoped) | Very low | None needed | **(A) LOW RISK** |
| `payments` | All (session-scoped) | Very low | None | **(A) LOW RISK** |
| `restaurant_tables` | All | Moderate (15s window) | None | **(A) LOW RISK in practice** — last-write-wins acceptable; consider optimistic check |
| `deliveries` | Admin + Manager | Low (device-scoped) | None | **(A) LOW RISK** |
| `users` | Admin only | None | N/A | **(A) LOW RISK** |
| `menu_items` | Admin only | None | N/A | **(A) LOW RISK** |
| `owner_employees` | Owner only | None | N/A | **(A) LOW RISK** |
| `owner_salary_ledger` | Owner only | None | N/A | **(A) LOW RISK** |
| `owner_expenses` | Owner only | None | N/A | **(A) LOW RISK** |
| `owner_deposits` | Owner only | None | N/A | **(A) LOW RISK** |
| `due_payments` | Admin + Manager | Low | None | **(A) LOW RISK** |
| `eja_history` | Manager (submit) | None | N/A | **(A) LOW RISK** |
| **`daily_submit`** | **All 3 roles** | **HIGH — same date, all 3 apps** | **Priority system** (owner>admin>manager) — partial | **(B) NEEDS CONFLICT HANDLING** |
| **`expenses`** | **Admin + Manager** | **MODERATE — stable ID per date+category** | **None** | **(B) NEEDS CONFLICT HANDLING** |
| **`supplier_payment_ledger`** | **Admin + Manager + Owner** | **MODERATE — auto-fill + manual edit** | **48h non-Admin lock** (partial) | **(B) NEEDS CONFLICT HANDLING** |
| **`supplier_due`** | **Admin + Manager** | **HIGH — running balance, 3 shared rows** | **None** | **(B) NEEDS CONFLICT HANDLING** |

---

### Migration Recommendations Based on This Analysis

**For §1 (Mixed Date-Range):**
- `daily_submit` and `daily_summary` must be fully migrated to Supabase (no date boundary) to support `AdminAnalyticsScreen` queries across all historical periods.
- All other tables can continue with the 31-day local cache strategy without breaking any screen.

**For §2 (Conflict Handling):**
- **`daily_submit`:** Keep existing priority system; extend to handle same-role conflicts (e.g., last-submit-wins with an audit log, or enforce one-submission-per-day per role rule).
- **`expenses`:** Add a conflict token or version counter (`version INTEGER`). Use Supabase's `SELECT ... FOR UPDATE` or RPC with compare-and-swap before writing. Alternatively, convert categories to individual rows (they already have stable IDs) and use `updated_at` comparison before merge.
- **`supplier_payment_ledger`:** Decouple `submitDailySheet()` auto-fill from manual `saveSupplierPayment()` entries. Consider making the auto-fill additive (only fill if column is currently 0) rather than `INSERT OR REPLACE` which overwrites.
- **`supplier_due`:** Convert from a mutable running balance to an **append-only ledger** pattern. Compute `current_due` as a server-side `SUM()` query instead of storing it as a mutable field. This eliminates the lost-update race entirely.

---

*Document generated: 2026-09-27. Based on full static analysis of `/home/shakib/Downloads/rong`.*
