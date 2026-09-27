# RONGDHONU POS — SUPABASE RLS IMPLEMENTATION PLAN

> **Purpose:** Blueprint for implementing Device-Approval-Gated Row Level Security (RLS) in Supabase.  
> **Mechanism:** Every Supabase request carries an `X-Device-Id` HTTP header. A PostgreSQL `SECURITY DEFINER` function validates device state in `public.devices` before permitting read/write operations on POS data tables.

---

## 1. Complete Supabase Table Inventory (30 Tables)

Below is the complete list of all 30 tables that will exist in Supabase after the dual-database migration. Columns match the SQLite schemas ([`database.js` L165–L647](database.js#L165-L647)) and Firestore collections ([`ARCHITECTURE_CURRENT_STATE.md`](ARCHITECTURE_CURRENT_STATE.md)).

> **Note on `is_synced`:** The `is_synced` column is SQLite-local only (marking local dirty records) and is **omitted** from Supabase.

### 1.1. Device Control & Version Policy Tables (3 Tables)

| Table Name | Primary Key | Columns & Data Types | RLS Gate Category |
|---|---|---|---|
| **`devices`** | `device_id TEXT` | `device_id TEXT PRIMARY KEY`, `device_name TEXT`, `manufacturer TEXT`, `brand TEXT`, `model TEXT`, `android_version TEXT`, `app_version TEXT`, `first_install_time TEXT`, `status TEXT DEFAULT 'PENDING'`, `allow_login BOOLEAN DEFAULT true`, `allow_offline BOOLEAN DEFAULT true`, `admin_lock BOOLEAN DEFAULT false`, `force_logout BOOLEAN DEFAULT false`, `force_logout_token TEXT`, `registered_by TEXT`, `notes TEXT`, `is_deleted BOOLEAN DEFAULT false`, `deleted_at TIMESTAMPTZ`, `deleted_by TEXT`, `last_seen_at TIMESTAMPTZ`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ` | **EXCLUDED** (Self-service registration & heartbeat) |
| **`device_app_usage`** | `id TEXT` | `id TEXT PRIMARY KEY`, `device_id TEXT NOT NULL`, `business_date TEXT NOT NULL`, `role TEXT NOT NULL`, `app_label TEXT NOT NULL`, `total_seconds INTEGER DEFAULT 0`, `last_heartbeat TIMESTAMPTZ`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ` | **EXCLUDED** (Foreground telemetry tracker) |
| **`app_version_policy`** | `id TEXT` | `id TEXT PRIMARY KEY DEFAULT 'global'`, `minimum_required_version TEXT NOT NULL`, `minimum_version TEXT NOT NULL`, `latest_version TEXT NOT NULL`, `update_url TEXT NOT NULL`, `force_update_enabled BOOLEAN DEFAULT true`, `update_message TEXT`, `updated_at TIMESTAMPTZ` | **PUBLIC READ** (`SELECT` open to all, `UPDATE` admin only) |

---

### 1.2. Core POS Operational Tables (9 Tables)

All tables in this category are **strictly gated** by `is_device_active()`.

| Table Name | Primary Key | Columns & Data Types |
|---|---|---|
| **`users`** | `id TEXT` | `id TEXT PRIMARY KEY`, `username TEXT UNIQUE`, `pin TEXT`, `role TEXT`, `display_name TEXT`, `created_at TEXT`, `updated_at TEXT` |
| **`restaurant_tables`** | `id TEXT` | `id TEXT PRIMARY KEY`, `table_id TEXT`, `table_name TEXT`, `status TEXT`, `items TEXT`, `startTime TEXT`, `created_at TEXT`, `updated_at TEXT` |
| **`orders`** | `id TEXT` | `id TEXT PRIMARY KEY`, `table_id TEXT`, `items TEXT`, `subtotal REAL`, `discount REAL`, `delivery_charge REAL DEFAULT 0`, `change_money_given REAL DEFAULT 0`, `cash_amount REAL DEFAULT 0`, `bkash_amount REAL DEFAULT 0`, `nagad_amount REAL DEFAULT 0`, `rocket_amount REAL DEFAULT 0`, `due_amount REAL DEFAULT 0`, `grand_total REAL`, `payment_status TEXT`, `payment_method TEXT`, `time TEXT`, `created_at TEXT`, `updated_at TEXT`, `locked_at TEXT` |
| **`order_items`** | `id TEXT` | `id TEXT PRIMARY KEY`, `order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE`, `itemName TEXT NOT NULL`, `quantity INTEGER NOT NULL`, `unit_price REAL DEFAULT 0`, `revenue REAL`, `created_at TEXT`, `updated_at TEXT` |
| **`payments`** | `id TEXT` | `id TEXT PRIMARY KEY`, `order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE`, `total_amount REAL`, `customer_paid REAL`, `discount_amount REAL`, `delivery_charge REAL DEFAULT 0`, `change_money_given REAL DEFAULT 0`, `cash_amount REAL DEFAULT 0`, `bkash_amount REAL DEFAULT 0`, `nagad_amount REAL DEFAULT 0`, `rocket_amount REAL DEFAULT 0`, `due_amount REAL DEFAULT 0`, `payment_method TEXT`, `payment_status TEXT`, `paid_at TEXT`, `created_at TEXT`, `updated_at TEXT` |
| **`expenses`** | `id TEXT` | `id TEXT PRIMARY KEY`, `category TEXT NOT NULL`, `amount REAL NOT NULL`, `note TEXT`, `is_due INTEGER DEFAULT 0`, `given_amount REAL DEFAULT 0`, `used_amount REAL DEFAULT 0`, `returned_amount REAL DEFAULT 0`, `created_at TEXT`, `updated_at TEXT` |
| **`deliveries`** | `id TEXT` | `id TEXT PRIMARY KEY`, `customer_name TEXT`, `amount REAL`, `status TEXT`, `items TEXT`, `startTime TEXT`, `delivery_charge REAL DEFAULT 0`, `change_money_given REAL DEFAULT 0`, `created_at TEXT`, `completed_at TEXT`, `updated_at TEXT` |
| **`menu_categories`** | `id TEXT` | `id TEXT PRIMARY KEY`, `name TEXT UNIQUE NOT NULL`, `created_at TEXT`, `updated_at TEXT` |
| **`menu_items`** | `id TEXT` | `id TEXT PRIMARY KEY`, `name TEXT NOT NULL`, `price REAL NOT NULL`, `category TEXT NOT NULL`, `created_at TEXT`, `updated_at TEXT`, `UNIQUE(name, category)` |

---

### 1.3. Daily Auditing, Closing & Summaries (4 Tables)

| Table Name | Primary Key | Columns & Data Types |
|---|---|---|
| **`daily_submit`** | `id TEXT` | `id TEXT PRIMARY KEY`, `date TEXT UNIQUE NOT NULL`, `total_sell REAL`, `cash_payment REAL`, `bkash_payment REAL`, `nagad_payment REAL`, `rocket_payment REAL DEFAULT 0`, `delivery_sell REAL DEFAULT 0`, `delivery_charge REAL DEFAULT 0`, `eja REAL`, `dudu_store REAL`, `akash_murgi REAL`, `burger_bun REAL`, `bazar REAL`, `others REAL`, `total_expense REAL`, `net_cash REAL DEFAULT 0`, `net_deposit REAL`, `notes TEXT`, `submitted_by TEXT`, `submitted_at TEXT`, `is_locked INTEGER DEFAULT 0`, `submission_type TEXT DEFAULT 'MANUAL'`, `created_at TEXT`, `updated_at TEXT` |
| **`daily_summary`** | `id TEXT` | `id TEXT PRIMARY KEY`, `date TEXT UNIQUE NOT NULL`, `dayOfWeek TEXT`, `weekOfMonth INTEGER`, `isFriday INTEGER`, `isHoliday INTEGER`, `specialDayNote TEXT`, `temperature REAL`, `humidity REAL`, `condition TEXT`, `isRainy INTEGER`, `windSpeed REAL`, `totalOrders INTEGER`, `totalSales REAL`, `totalDiscount REAL`, `totalExpense REAL`, `totalDelivery REAL`, `total_delivery_charge REAL DEFAULT 0`, `averageOrderValue REAL`, `peakHour TEXT`, `firstOrderTime TEXT`, `lastOrderTime TEXT`, `cashTotal REAL`, `bkashTotal REAL`, `nagadTotal REAL`, `rocketTotal REAL DEFAULT 0`, `ejaAmount REAL`, `netCash REAL`, `ownerDeposit REAL`, `itemSummary TEXT`, `created_at TEXT`, `updated_at TEXT` |
| **`daily_submit_priority`** | `business_date TEXT` | `business_date TEXT PRIMARY KEY`, `submitted_by TEXT`, `role TEXT`, `priority INTEGER`, `sync_source_device TEXT`, `created_at TEXT`, `updated_at TEXT` |
| **`activity_logs`** | `id TEXT` | `id TEXT PRIMARY KEY`, `business_date TEXT NOT NULL`, `timestamp TEXT NOT NULL`, `action_type TEXT NOT NULL`, `action_title TEXT NOT NULL`, `description TEXT`, `app_profile TEXT NOT NULL`, `user_role TEXT`, `user_name TEXT`, `device_id TEXT`, `device_name TEXT`, `device_model TEXT`, `device_platform TEXT`, `metadata TEXT`, `created_at TEXT NOT NULL`, `updated_at TEXT NOT NULL` |

---

### 1.4. Vendor, Due & Auxiliary Records (5 Tables)

| Table Name | Primary Key | Columns & Data Types |
|---|---|---|
| **`due_payments`** | `id TEXT` | `id TEXT PRIMARY KEY`, `customer_name TEXT`, `amount REAL`, `order_id TEXT`, `status TEXT`, `created_at TEXT`, `updated_at TEXT` |
| **`eja_history`** | `id TEXT` | `id TEXT PRIMARY KEY`, `date TEXT`, `eja_amount REAL`, `created_at TEXT`, `updated_at TEXT` |
| **`off_days`** | `id TEXT` | `id TEXT PRIMARY KEY`, `date TEXT UNIQUE`, `created_by TEXT`, `reason TEXT`, `status TEXT`, `created_at TEXT`, `updated_at TEXT` |
| **`weather_data`** | `id TEXT` | `id TEXT PRIMARY KEY`, `date TEXT UNIQUE`, `temperature REAL`, `humidity REAL`, `condition TEXT`, `isRainy INTEGER`, `windSpeed REAL`, `created_at TEXT`, `updated_at TEXT` |
| **`supplier_due`** | `id TEXT` | `id TEXT PRIMARY KEY`, `supplier_name TEXT`, `current_due REAL DEFAULT 0`, `note TEXT`, `created_at TEXT`, `updated_at TEXT` |
| **`supplier_due_history`** | `id TEXT` | `id TEXT PRIMARY KEY`, `date TEXT`, `supplier_id TEXT`, `supplier_name TEXT`, `previous_due REAL`, `purchase_amount REAL`, `payment_amount REAL`, `current_due REAL`, `note TEXT`, `created_by TEXT`, `created_at TEXT`, `updated_at TEXT` |
| **`supplier_payment_ledger`** | `id TEXT` | `id TEXT PRIMARY KEY`, `payment_date TEXT UNIQUE`, `month TEXT`, `year TEXT`, `variety_store_amount REAL DEFAULT 0`, `morgir_dokan_amount REAL DEFAULT 0`, `burger_ban_amount REAL DEFAULT 0`, `created_by TEXT`, `created_at TEXT`, `updated_at TEXT` |

---

### 1.5. Owner Financial Management Tables (5 Tables)

| Table Name | Primary Key | Columns & Data Types |
|---|---|---|
| **`owner_employees`** | `id TEXT` | `id TEXT PRIMARY KEY`, `name TEXT NOT NULL`, `phone TEXT`, `designation TEXT`, `monthly_salary REAL NOT NULL`, `joining_date TEXT`, `status TEXT DEFAULT 'ACTIVE'`, `notes TEXT`, `created_at TEXT NOT NULL`, `updated_at TEXT NOT NULL` |
| **`owner_salary_ledger`** | `id TEXT` | `id TEXT PRIMARY KEY`, `employee_id TEXT NOT NULL REFERENCES owner_employees(id) ON DELETE CASCADE`, `amount REAL NOT NULL`, `payment_type TEXT NOT NULL`, `payment_date TEXT NOT NULL`, `notes TEXT`, `created_at TEXT NOT NULL` |
| **`owner_expenses`** | `id TEXT` | `id TEXT PRIMARY KEY`, `category TEXT NOT NULL`, `amount REAL NOT NULL`, `expense_date TEXT NOT NULL`, `notes TEXT`, `created_at TEXT NOT NULL`, `updated_at TEXT NOT NULL` |
| **`owner_deposits`** | `id TEXT` | `id TEXT PRIMARY KEY`, `month TEXT NOT NULL`, `amount REAL NOT NULL`, `created_at TEXT NOT NULL` |
| **`owner_home_deposits`** | `id TEXT` | `id TEXT PRIMARY KEY`, `amount REAL NOT NULL`, `deposit_date TEXT NOT NULL`, `notes TEXT`, `created_at TEXT NOT NULL`, `updated_at TEXT NOT NULL` |

---

### 1.6. Deletion Tombstones & Audit Logs (2 Tables)

| Table Name | Primary Key | Columns & Data Types |
|---|---|---|
| **`deletions`** | `id TEXT` | `id TEXT PRIMARY KEY`, `table_name TEXT NOT NULL`, `record_id TEXT NOT NULL`, `created_at TEXT`, `updated_at TEXT` |
| **`delete_history`** | `id TEXT` | `id TEXT PRIMARY KEY`, `record_type TEXT`, `record_id TEXT`, `deleted_by TEXT`, `deleted_at TEXT`, `created_by TEXT`, `original_created_at TEXT`, `snapshot_data TEXT`, `sync_status INTEGER DEFAULT 0`, `created_at TEXT`, `updated_at TEXT` |

---

## 2. Client Header Injection (`@supabase/supabase-js`)

### 2.1. Current Client Implementation

In [`services/supabaseClient.js`](services/supabaseClient.js), the client is instantiated statically at module load time:
```javascript
supabaseInstance = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  realtime: { params: { eventsPerSecond: 10 } }
});
```

### 2.2. Can We Inject `X-Device-Id` Globally?

**Yes.** `@supabase/supabase-js` provides two clean avenues:

#### Option A: Constructor Global Headers (`createClient`)
```javascript
createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: {
    headers: {
      'x-device-id': deviceId
    }
  },
  auth: { persistSession: false, autoRefreshToken: false }
});
```

#### Option B: Dynamic Header Mutation (`supabase.rest.headers`)
The PostgREST client used internally exposes its default headers map. If the client is already initialized before `device_id` is resolved, headers can be mutated at runtime without destroying Realtime channels:
```javascript
if (supabaseInstance && supabaseInstance.rest) {
  supabaseInstance.rest.headers['x-device-id'] = deviceId;
}
```

### 2.3. Recommended Refactoring for `services/supabaseClient.js`

To support both early offline startup and authenticated PostgREST calls:

```javascript
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

let supabaseInstance = null;
let currentDeviceId = null;

function buildClient(deviceId = null) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_URL.startsWith('http')) {
    return null;
  }
  const headers = {};
  if (deviceId) {
    headers['x-device-id'] = deviceId;
  }
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    },
    realtime: {
      params: { eventsPerSecond: 10 }
    }
  });
}

// Initial instantiation
supabaseInstance = buildClient();

/**
 * Authoritatively configure the active device ID for all future Supabase calls.
 */
export function setSupabaseDeviceId(deviceId) {
  if (!deviceId) return;
  currentDeviceId = String(deviceId).trim();
  if (supabaseInstance) {
    // Mutate PostgREST headers directly
    if (supabaseInstance.rest && supabaseInstance.rest.headers) {
      supabaseInstance.rest.headers['x-device-id'] = currentDeviceId;
    }
  } else {
    supabaseInstance = buildClient(currentDeviceId);
  }
  console.log(`[SupabaseClient] Configured X-Device-Id header: ${currentDeviceId}`);
}

export function getSupabaseClient() {
  // If device ID was saved in SQLite earlier, ensure it is set
  if (!currentDeviceId) {
    try {
      const { getDb } = require('../database');
      const db = getDb();
      const row = db.getFirstSync("SELECT value FROM app_config WHERE key = 'persistent_device_id'");
      if (row && row.value) {
        setSupabaseDeviceId(row.value);
      }
    } catch (_) {}
  }
  return supabaseInstance;
}
```

---

## 3. `device_id` Availability & Initialization Lifecycle

### 3.1. How `device_id` Is Resolved

In [`services/deviceRegistry.js` L156–L228](services/deviceRegistry.js#L156-L228) (`getPersistentDeviceId`):
1. **Priority 1 (Async):** Calls `await Application.getAndroidIdAsync()`. If valid, returns `android_${androidId}`.
2. **Priority 2 (Sync from SQLite):** Checks `SELECT value FROM app_config WHERE key = 'persistent_device_id'`.
3. **Priority 3 (Hardware Hash):** Deterministic hash of `Device.brand` + `Device.modelName`.
4. **Priority 4 (UUID fallback):** `dev_uuid_${Date.now()}_...`.

Once resolved, the ID is immediately saved to SQLite:
```javascript
db.runSync(
  "INSERT OR REPLACE INTO app_config (key, value, updated_at) VALUES ('persistent_device_id', ?, ?)",
  [hardwareId, now]
);
```

### 3.2. Synchronous vs. Asynchronous Timeline

```
[ App Cold Start ]
       │
       ▼
1. initDatabase(true)          ──> SQLite schema created synchronously
       │
       ▼
2. registerDeviceIfNeeded()     ──> ASYNCHRONOUS lookup (await Application.getAndroidIdAsync())
       │                       ──> Saves 'persistent_device_id' into SQLite app_config
       ▼
3. setSupabaseDeviceId(id)     ──> Injects 'x-device-id' into Supabase client headers
       │
       ▼
4. All Subsequent Operations   ──> SYNCHRONOUS access via getAppConfig('persistent_device_id')
```

* **Fresh Install (First Cold Start):** `device_id` is **only available asynchronously** because `Application.getAndroidIdAsync()` is a native async call.
* **Warm Start / Subsequent Launches:** `device_id` is **available synchronously** from SQLite `app_config` at line 1 of app execution.
* **Hook Point:** `setSupabaseDeviceId(deviceId)` must be called directly inside [`App.js` L443](App.js#L443) immediately after `await registerDeviceIfNeeded()` resolves.

---

## 4. RLS Exceptions for `PENDING` Devices

A brand new device starts with `status = 'PENDING'` until an Administrator approves it.

### 4.1. What Must a `PENDING` Device Be Able to Read/Write?

| Table | Operations Needed by `PENDING` Device | Justification & File Reference |
|---|---|---|
| **`devices`** | `INSERT` (New registration)<br>`SELECT` (Own row only)<br>`UPDATE` (Heartbeat/last_seen) | In [`deviceRegistry.js` L401](services/deviceRegistry.js#L401) and [`DevicePendingScreen.js` L51](screens/DevicePendingScreen.js#L51), the device registers itself and polls its own row to detect when Admin approves it. |
| **`device_app_usage`** | `INSERT`, `UPDATE` (Telemetry) | Telemetry logging must not crash if triggered. |
| **`app_version_policy`** | `SELECT` (Public read) | In [`App.js` L425](App.js#L425), version check runs **before** device approval. If a pending device cannot check version, it gets trapped in an error loop. |

### 4.2. What Must Be Strictly BLOCKED for a `PENDING` Device?

A `PENDING` device is parked on [`screens/DevicePendingScreen.js`](screens/DevicePendingScreen.js) and is **strictly prohibited** from reading or writing:
* `orders`, `order_items`, `payments`
* `expenses`, `deliveries`
* `daily_submit`, `daily_summary`
* `restaurant_tables`, `menu_items`, `menu_categories`
* `users`
* `owner_*` financial tables

All 27 business data tables must reject any request if the device is not `ACTIVE`.

---

## 5. Production SQL Script (PostgreSQL Migration)

Run the following SQL script in the Supabase SQL Editor.

### 5.1. The Security Definer Gate Function

```sql
-- =========================================================================
-- FUNCTION: public.is_device_active
-- Validates if the requesting device header corresponds to an active device
-- =========================================================================

CREATE OR REPLACE FUNCTION public.is_device_active(p_device_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.devices
        WHERE device_id = p_device_id
          AND status = 'ACTIVE'
          AND allow_login = true
          AND admin_lock = false
          AND is_deleted = false
    );
$$;

-- Grant execution to API roles
GRANT EXECUTE ON FUNCTION public.is_device_active(TEXT) TO anon, authenticated;
```

---

### 5.2. Policies for Excluded Tables

```sql
-- 1. DEVICES TABLE (Must allow registration and self-check)
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Devices open registration and self telemetry" ON public.devices;
CREATE POLICY "Devices open registration and self telemetry"
ON public.devices
FOR ALL
TO anon, authenticated
USING (
    -- Admins can do anything, or devices can read/update their own row
    (current_setting('request.headers', true)::json->>'x-device-id') IS NOT NULL
)
WITH CHECK (
    (current_setting('request.headers', true)::json->>'x-device-id') IS NOT NULL
);

-- 2. DEVICE APP USAGE TABLE
ALTER TABLE public.device_app_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Device telemetry tracking" ON public.device_app_usage;
CREATE POLICY "Device telemetry tracking"
ON public.device_app_usage
FOR ALL
TO anon, authenticated
USING (true)
WITH CHECK (true);

-- 3. APP VERSION POLICY TABLE
ALTER TABLE public.app_version_policy ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read version policy" ON public.app_version_policy;
CREATE POLICY "Public read version policy"
ON public.app_version_policy
FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "Admin update version policy" ON public.app_version_policy;
CREATE POLICY "Admin update version policy"
ON public.app_version_policy
FOR UPDATE
TO anon, authenticated
USING (
    -- Only active admin devices can update version policy
    public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id')
)
WITH CHECK (
    public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id')
);
```

---

### 5.3. Automated RLS Policy Generator for All 27 POS Tables

Execute this PL/pgSQL block to enable RLS and attach the `is_device_active` gate across all POS tables:

```sql
DO $$
DECLARE
    t TEXT;
    target_tables TEXT[] := ARRAY[
        'users',
        'restaurant_tables',
        'orders',
        'order_items',
        'payments',
        'expenses',
        'deliveries',
        'menu_categories',
        'menu_items',
        'daily_submit',
        'daily_summary',
        'daily_submit_priority',
        'due_payments',
        'eja_history',
        'off_days',
        'weather_data',
        'supplier_due',
        'supplier_due_history',
        'supplier_payment_ledger',
        'owner_employees',
        'owner_salary_ledger',
        'owner_expenses',
        'owner_deposits',
        'owner_home_deposits',
        'activity_logs',
        'deletions',
        'delete_history'
    ];
BEGIN
    FOREACH t IN ARRAY target_tables LOOP
        -- Enable RLS
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
        
        -- Drop existing policy if any
        EXECUTE format('DROP POLICY IF EXISTS "Device gated access on %I" ON public.%I;', t, t);
        
        -- Create strict device-active policy
        EXECUTE format($p$
            CREATE POLICY "Device gated access on %1$I"
            ON public.%1$I
            FOR ALL
            TO anon, authenticated
            USING (
                public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id')
            )
            WITH CHECK (
                public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id')
            );
        $p$, t);
        
        RAISE NOTICE 'Applied device gate RLS to table: %', t;
    END LOOP;
END $$;
```

---

## 6. Implementation Checklist

1. [ ] **Supabase:** Run the table creation DDL for the 28 missing tables (matching schemas in §1).
2. [ ] **Supabase:** Run SQL Script in §5 to create `is_device_active()` and apply RLS across all 30 tables.
3. [ ] **Mobile App:** Update `services/supabaseClient.js` with `setSupabaseDeviceId()` (§2.3).
4. [ ] **Mobile App:** Wire `setSupabaseDeviceId()` inside `App.js` immediately following `registerDeviceIfNeeded()` (§3.2).
5. [ ] **Mobile App:** Verify that on clean install, `DevicePendingScreen` displays without RLS rejection while POS queries fail closed until approved.

---

*Document generated: 2026-09-27. Architecture specification for Rongdhonu POS dual-DB migration.*
