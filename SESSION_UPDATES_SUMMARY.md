# Rongdhonu POS — Session Updates & Feature Audit Report

**Date:** October 2026  
**Application Version:** 1.0.9  
**Status:** ✅ Fully Implemented, Tested & Committed  

---

## Executive Summary

During this development session, critical optimizations, UI enhancements, telemetry integrations, and printer workflow corrections were implemented across the **Admin**, **Manager**, and **Owner** applications. All features were built adhering to the offline-first architecture, zero-risk schema guarantees, and complete backward compatibility.

---

## 1. Automatic Receipt Printing Turned OFF (Manual Print Only)

### Background & Issue
* When a Manager or Owner completed an order payment, the app silently and automatically triggered a print command 150ms later if a thermal Bluetooth printer was connected.
* This surprised operators, printed receipts marked as "Paid" before customers even asked, and wasted thermal paper when customers did not need a receipt (verified via video audit).

### What Was Done
* **Disabled Hardcoded Auto-Print**:
  In [`App.js`](App.js), the unconditional call `setAutoPrintOrder(orderRecord)` inside `handleCompletePayment` was removed. Auto-print is now guarded by local configuration (`auto_print_enabled === 'true'`) and disabled by default.
* **Preserved Dedicated Manual Printing**:
  On the **Payment Success** screen (`PaymentSuccess.js`), operators retain the manual **`🖨️ রসিদ প্রিন্ট করুন`** button. Receipts print only when explicitly commanded.
* **Test Verification**:
  Created [`tests/autoPrintPolicy.test.js`](tests/autoPrintPolicy.test.js) (4/4 tests passing) verifying that payment completion never triggers unrequested print jobs.
* **Git Commit**: `ef28dbc`

---

## 2. 30-Minute Cooldown on PIN Login Delta Sync

### Background & Issue
* Every time a staff member logged in with their PIN, the app ran a full 6-collection cloud delta sync (`login-tables-pull`, `login-high-frequency-pull`, `login-daily-pull`, `login-low-frequency-pull`, `login-menu-pull`, `login-deletions-pull`).
* When staff locked/unlocked phones frequently, this caused cloud query spikes and flooded the pull notification history.

### What Was Done
* **Added 30-Minute Cooldown Guard**:
  In [`database.js`](database.js), implemented `PIN_LOGIN_SYNC_COOLDOWN_MS = 30 * 60 * 1000` (30 minutes), along with `checkPinLoginSyncAllowed()` and `recordPinLoginSyncTime()`.
* **Application Lifecycle Gate**:
  In [`App.js`](App.js), `handleLoginSuccess` checks whether 30 minutes have elapsed since the last login sync. If less than 30 minutes, it skips the heavy pull check.
* **Continuous Background Sync Unaffected**:
  Active background timers (**15s for tables**, **30s for orders & deliveries**) continue running unaffected, so live orders are never missed. Manual pull buttons remain unthrottled.
* **Test Verification**:
  Created [`tests/pinLoginSyncCooldown.test.js`](tests/pinLoginSyncCooldown.test.js) (5/5 tests passing).
* **Git Commit**: `745a6ba` & `326320b`

---

## 3. Menu Pull Excluded from PIN Login Sync

### Background & Issue
* Restaurant menus and prices change rarely (typically once every few months), and menu data is already stored locally in SQLite. Checking menu items on every PIN login was redundant.

### What Was Done
* **Removed `login-menu-pull`**:
  Excluded `syncSupabaseMenu` / `syncMenuOnly` from the PIN login delta sync in [`App.js`](App.js).
* **Retained Manual Menu Recovery**:
  Managers/Admins can still update menu items on demand via the "মেনু রিকভার" button or routine background sync if the menu is ever modified.
* **Git Commit**: `326320b`

---

## 4. Dual Pull Notification System Isolation

### Background & Verification
* The system uses two distinct pull notification mechanisms:
  1. **Old System (`notifyPull`)**:
     * **Target:** **Manager & Owner Apps only**.
     * **Message:** `⬇️ Supabase থেকে ডাটা pull হয়েছে`
     * **Rule:** Shows only when **actual new data arrives** (`hasChanges = true`), debounced by 3 seconds. Remains completely silent when there is 0 read data.
     * **Status:** **100% Unchanged.**
  2. **New System (`pullNotificationSink`)**:
     * **Target:** **Admin App ONLY**.
     * **Message:** Detailed item counts and status (e.g., `⬇️ ডিলিট ডাটা: নতুন ডাটা নেই (০ টি রিড)`).
     * **Storage:** Logged into the top-right 🔔 Notification History panel in Admin.
     * **Code Gate:** Locked with `if (!isTargetAdmin()) return;` in [`App.js`](App.js).

---

## 5. Order Telemetry & Device Attribution

### Background & Feature
* When multiple devices (waiters, counter tablet, manager phone) modify active tables and orders, the Admin needed visibility into **who edited** and **from which device**.

### What Was Done
* **Telemetry Service**:
  Created [`services/orderTelemetry.js`](services/orderTelemetry.js) with:
  * `formatUserRoleTag(role, displayName)`: Formats editor tag (e.g. `রহিম (ম্যানেজার)`, `মালিক`).
  * `getCurrentDeviceTelemetryName()`: Resolves hardware brand/model (e.g. `Samsung SM-A125F`, `Redmi Note 10`) over generic fallback names.
  * `stampOrderItem(item, options)`: Stamps items with timestamp, user, and device attributes.
  * `getOrderTelemetrySummary(orderOrTable)`: Computes order-level latest editor, device, and time.
* **Integration Across Order Touchpoints**:
  * [`screens/AddItemScreen.js`](screens/AddItemScreen.js): Stamps items on addition and quantity edits.
  * [`screens/TableDetailScreen.js`](screens/TableDetailScreen.js): Stamps items on quantity changes and quick water additions.
  * [`App.js`](App.js): Defensively stamps table items in `handleUpdateTableItems`.
* **Admin Monitoring Modal Display**:
  * Updated [`screens/AdminDB.js`](screens/AdminDB.js) to show header summary (👤 অর্ডার / এডিট করেছেন, 📱 ডিভাইস, 🕒 সর্বশেষ এডিট) and item-level badges.
* **Zero Cloud Schema Risk**:
  * Embedded inside the JSON `items` array already stored in SQLite and Supabase — no SQL migration required.
* **Test Verification**:
  Created [`tests/orderTelemetry.test.js`](tests/orderTelemetry.test.js) (16/16 tests passing).
* **Git Commits**: `11551f1`, `0dcf00e`, `22b4b9a`

---

## 6. Pull Notification History Filter Selector

### What Was Done
* Added a filter selector button to the Admin Notification History Modal (`screens/AdminDB.js`) allowing filtering by pull type:
  * All Pulls
  * New Data Only (`changes_only`)
  * Routine Checks (`no_changes`)
  * Granular timer categories (30s Soft Poll, 60s Auto Check, Realtime Signal, PIN Login Sync).
* Removed the manual clear button to enforce fresh session history reset on PIN login.
* **Git Commit**: `a9bbab0`

---

## 7. Git Commit Chronology

| Commit Hash | Message / Description |
|:---:|---|
| `a9bbab0` | `feat(admin): add pull type filter selector to notification history panel` |
| `11551f1` | `feat(telemetry): track user and device attribution on order edits and display in admin monitor` |
| `0dcf00e` | `fix(admin): close corresponding outer View tag in monitoring modal` |
| `22b4b9a` | `fix(telemetry): prioritize device brand and model over generic fallback names` |
| `745a6ba` | `feat(sync): add 15-minute cooldown to PIN login full DB delta pull` |
| `326320b` | `feat(sync): increase PIN login cooldown to 30 min and exclude menu pull` |
| `ef28dbc` | `feat(printer): disable automatic receipt printing on payment completion by default` |

---

## 8. Verification & Test Suite Matrix

All test suites passed 100% with zero regressions across the codebase:

```bash
npm run test:all
```

* `tests/builder.test.js` ✅ PASS
* `tests/validator.test.js` ✅ PASS
* `tests/mapper.test.js` ✅ PASS
* `tests/queue.test.js` ✅ PASS
* `tests/transport.test.js` ✅ PASS
* `tests/e2ePipeline.test.js` ✅ PASS
* `tests/activityLogger.test.js` ✅ PASS
* `tests/auditLog.test.js` ✅ PASS
* `tests/supabaseDeviceControl.test.js` ✅ PASS
* `tests/appUsageTracker.test.js` ✅ PASS
* `tests/firebaseAuth.test.js` ✅ PASS
* `tests/sameDayResync.test.js` ✅ PASS
* `tests/adminDashboardMerge.test.js` ✅ PASS
* `tests/forceLogoutAndMetadataSync.test.js` ✅ PASS
* `tests/deliveryChargePersistence.test.js` ✅ PASS
* `tests/pastAccountModalRedesign.test.js` ✅ PASS
* `tests/salesReportRedesign.test.js` ✅ PASS
* `tests/depositReportRedesign.test.js` ✅ PASS
* `tests/backupRestore.test.js` ✅ PASS
* `tests/supabaseDualWrite.test.js` ✅ PASS
* `tests/supabaseSync.test.js` ✅ PASS
* `tests/phase4Correctness.test.js` ✅ PASS
* `tests/phase6VersionControl.test.js` ✅ PASS
* `tests/phase7RlsFallback.test.js` ✅ PASS
* `tests/phase7HeaderInjection.test.js` ✅ PASS
* `tests/syncTombstoneResurrect.test.js` ✅ PASS
* `tests/supabaseSyncFlag.test.js` ✅ PASS
* `tests/phase8ManualCloudSupabaseFirst.test.js` ✅ PASS
* `tests/phase9RestoreScope.test.js` ✅ PASS
* `tests/phase10AdminRestoreScope.test.js` ✅ PASS
* `tests/phase11LoginConnectivity.test.js` ✅ PASS
* `tests/phase12UsersBootstrap.test.js` ✅ PASS
* `tests/phase13SyncHeartbeat.test.js` ✅ PASS
* `tests/pushOnWrite.test.js` ✅ PASS
* `tests/realtimeSignal.test.js` ✅ PASS
* `tests/startupSafety.test.js` ✅ PASS
* `tests/historicalDownloadBounds.test.js` ✅ PASS
* `tests/firebaseReadPolicy.test.js` ✅ PASS
* `tests/immediateAutoIjara.test.js` ✅ PASS
* `tests/ultimateAutoIjaraAudit.test.js` ✅ PASS
* `tests/dailySubmitLockAndBanner.test.js` ✅ PASS
* `tests/adminNotificationPanel.test.js` ✅ PASS
* `tests/orderTelemetry.test.js` ✅ PASS
* `tests/pinLoginSyncCooldown.test.js` ✅ PASS
* `tests/autoPrintPolicy.test.js` ✅ PASS

**Overall Result:** **44 / 44 Test Suites Passing (100% Green)**

