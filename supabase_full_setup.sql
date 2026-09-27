-- ============================================================================
-- RONGDHONU POS — SUPABASE FULL SETUP (CONSOLIDATED, IDEMPOTENT)
-- ============================================================================
-- Target : BRAND NEW Supabase project (old project discarded).
-- Contents (in correct dependency order):
--   PART 1 : devices           (device control — PERMISSIVE RLS, not gated)
--   PART 2 : device_app_usage  (telemetry      — PERMISSIVE RLS, not gated)
--   PART 3 : app_version_policy + 27 POS tables (reused verbatim from
--            the Phase 1 POS schema DDL)
--   PART 4 : indexes + FK cascades (bundled alongside their tables)
--   PART 5 : RLS — PERMISSIVE ONLY (device-gated RLS is a LATER phase)
--
-- Idempotent: safe to run multiple times. Every statement is guarded with
-- IF NOT EXISTS / ON CONFLICT DO NOTHING / DROP POLICY IF EXISTS.
--
-- NOTE: `users.pin` is synced PLAINTEXT as-is — this mirrors the existing
--       Firestore `users` collection 1:1. Login verification stays entirely
--       local (SQLite PIN check); Supabase `users` is only a synced mirror.
-- ============================================================================


-- ============================================================================
-- PART 1: DEVICE CONTROL — public.devices
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.devices (
    device_id TEXT PRIMARY KEY,
    device_name TEXT,
    manufacturer TEXT,
    brand TEXT,
    model TEXT,
    android_version TEXT,
    app_version TEXT,
    first_install_time TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING',   -- 'PENDING' | 'ACTIVE' | 'BLOCKED'
    allow_login BOOLEAN NOT NULL DEFAULT true,
    allow_offline BOOLEAN NOT NULL DEFAULT true,
    admin_lock BOOLEAN NOT NULL DEFAULT false,
    force_logout BOOLEAN NOT NULL DEFAULT false,
    force_logout_token TEXT,                  -- unique revocation id per command
    registered_by TEXT DEFAULT 'SYSTEM_AUTO',
    notes TEXT,
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    deleted_at TIMESTAMPTZ,
    deleted_by TEXT,
    last_seen_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Migration safety: ensure column exists on pre-existing databases
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS force_logout_token TEXT;

CREATE INDEX IF NOT EXISTS idx_devices_status ON public.devices(status);
CREATE INDEX IF NOT EXISTS idx_devices_is_deleted ON public.devices(is_deleted);
CREATE INDEX IF NOT EXISTS idx_devices_last_seen ON public.devices(last_seen_at);

-- Realtime replication (required by in-app device presence + command channels)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'devices'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.devices;
    END IF;
END $$;

-- RLS: PERMISSIVE — owner decision: this table is intentionally NOT gated
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow device tracking and control" ON public.devices;
CREATE POLICY "Allow device tracking and control"
    ON public.devices
    FOR ALL
    TO anon, authenticated
    USING (true)
    WITH CHECK (true);


-- ============================================================================
-- PART 2: APP USAGE TELEMETRY — public.device_app_usage
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.device_app_usage (
    id TEXT PRIMARY KEY,                       -- '{device_id}_{business_date}_{role}'
    device_id TEXT NOT NULL,
    business_date TEXT NOT NULL,               -- YYYY-MM-DD (Dhaka 06:00 AM cutoff)
    role TEXT NOT NULL,                        -- 'ADMIN' | 'OWNER' | 'MANAGER' | 'WAITER'
    app_label TEXT NOT NULL,
    total_seconds INTEGER NOT NULL DEFAULT 0,
    last_heartbeat TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_device_app_usage_date ON public.device_app_usage(business_date);
CREATE INDEX IF NOT EXISTS idx_device_app_usage_device ON public.device_app_usage(device_id);

-- Realtime replication
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'device_app_usage'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.device_app_usage;
    END IF;
END $$;

-- RLS: PERMISSIVE — owner decision: this table is intentionally NOT gated
ALTER TABLE public.device_app_usage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow device app usage tracking" ON public.device_app_usage;
CREATE POLICY "Allow device app usage tracking"
    ON public.device_app_usage
    FOR ALL
    TO anon, authenticated
    USING (true)
    WITH CHECK (true);


-- ============================================================================
-- PART 3: POS DATA SCHEMA
-- (POS tables, indexes, FK cascades, permissive RLS — Phase 1)
-- ============================================================================
-- =========================================================================
-- =========================================================================
-- SECTION 2: POS DATA SCHEMA (DUAL-DB MIGRATION — PHASE 1)
-- =========================================================================
-- Additive Supabase mirror of all POS Firestore collections.
--   28 new tables + app_version_policy.
--
-- IMPORTANT NOTES:
--  * `is_synced` is SQLite-local only and is intentionally OMITTED here.
--  * Column names are quoted where the app uses camelCase (e.g. "startTime",
--    "itemName", "isRainy", "windSpeed", daily_summary.*) so PostgREST column
--    names EXACTLY match the app's SQLite/Firestore field names for dual-write.
--  * `daily_submit` / `daily_summary` are dual-WRITTEN but NEVER read back from
--    Supabase (pulled/restored from Firebase only) — they back AdminAnalytics.
--  * Supabase uses native DELETE; no tombstone semantics required server-side.
--    Local SQLite `deletions` tracking is retained for Firebase pull compat.
--  * restaurant_tables sync uses 1–2s POLLING (NOT Realtime), so no table is
--    added to the supabase_realtime publication in this phase.
--  * RLS in this phase is PERMISSIVE (matching devices/device_app_usage).
--    Device-gated RLS is Phase 7 and is NOT implemented here.
-- =========================================================================


-- -------------------------------------------------------------------------
-- 2.1 VERSION POLICY (single row, permanent, never rolling-deleted)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_version_policy (
    id TEXT PRIMARY KEY DEFAULT 'global',
    minimum_required_version TEXT NOT NULL DEFAULT '1.0.0',
    minimum_version TEXT NOT NULL DEFAULT '1.0.0',
    latest_version TEXT NOT NULL DEFAULT '1.0.0',
    update_url TEXT NOT NULL DEFAULT 'https://github.com/rshakib/RongdhonuAPP/releases',
    force_update_enabled BOOLEAN NOT NULL DEFAULT true,
    update_message TEXT NOT NULL DEFAULT 'একটি নতুন সংস্করণ পাওয়া গেছে। অ্যাপ্লিকেশন ব্যবহার চালিয়ে যেতে অনুগ্রহ করে আপডেট করুন।',
    updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO public.app_version_policy (id, minimum_required_version, minimum_version, latest_version)
VALUES ('global', '1.0.7', '1.0.7', '1.0.7')
ON CONFLICT (id) DO NOTHING;


-- -------------------------------------------------------------------------
-- 2.1b SYNC HEARTBEAT (observability: per device × backend last push/read)
--   Self-reported by the app so you can verify FROM THE SQL EDITOR that both
--   Firebase and Supabase are actually receiving writes, and which side lags:
--     SELECT device_id, backend, last_push_at, last_push_ok, last_read_at, last_error
--       FROM public.sync_heartbeat ORDER BY device_id, backend;
--   PERMANENT table (never date-pruned). App writes are throttled (~60s).
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sync_heartbeat (
    device_id     TEXT NOT NULL,
    backend       TEXT NOT NULL,          -- 'firebase' | 'supabase'
    app_profile   TEXT,
    app_version   TEXT,
    last_push_at  TIMESTAMPTZ,            -- last successful WRITE to this backend
    last_push_ok  BOOLEAN,
    last_error    TEXT,
    last_read_at  TIMESTAMPTZ,            -- last successful READ/PULL from this backend
    last_rows     INTEGER,
    pending_tables JSONB,                 -- { "orders": 3, ... } unsent rows for THIS backend
    updated_at    TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (device_id, backend)
);

-- Migration for an already-created table:
ALTER TABLE public.sync_heartbeat ADD COLUMN IF NOT EXISTS pending_tables JSONB;

CREATE INDEX IF NOT EXISTS idx_sync_heartbeat_updated ON public.sync_heartbeat(updated_at DESC);


-- -------------------------------------------------------------------------
-- 2.2 CORE POS TABLES
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE,
    pin TEXT,
    role TEXT,
    display_name TEXT,
    created_at TEXT,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS public.restaurant_tables (
    id TEXT PRIMARY KEY,
    table_id TEXT,
    table_name TEXT,
    status TEXT,
    items TEXT,                      -- JSON array of active items
    "startTime" TEXT,
    created_at TEXT,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS public.orders (
    id TEXT PRIMARY KEY,
    table_id TEXT,
    items TEXT,
    subtotal REAL,
    discount REAL,
    delivery_charge REAL DEFAULT 0,
    change_money_given REAL DEFAULT 0,
    cash_amount REAL DEFAULT 0,
    bkash_amount REAL DEFAULT 0,
    nagad_amount REAL DEFAULT 0,
    rocket_amount REAL DEFAULT 0,
    due_amount REAL DEFAULT 0,
    grand_total REAL,
    payment_status TEXT,
    payment_method TEXT,
    time TEXT,
    created_at TEXT,
    updated_at TEXT,
    locked_at TEXT
);

CREATE TABLE IF NOT EXISTS public.order_items (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    "itemName" TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price REAL DEFAULT 0,
    revenue REAL,
    created_at TEXT,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS public.payments (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    total_amount REAL,
    customer_paid REAL,
    discount_amount REAL,
    delivery_charge REAL DEFAULT 0,
    change_money_given REAL DEFAULT 0,
    cash_amount REAL DEFAULT 0,
    bkash_amount REAL DEFAULT 0,
    nagad_amount REAL DEFAULT 0,
    rocket_amount REAL DEFAULT 0,
    due_amount REAL DEFAULT 0,
    payment_method TEXT,
    payment_status TEXT,
    paid_at TEXT,
    created_at TEXT,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS public.expenses (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    amount REAL NOT NULL,
    note TEXT,
    is_due INTEGER DEFAULT 0,
    given_amount REAL DEFAULT 0,
    used_amount REAL DEFAULT 0,
    returned_amount REAL DEFAULT 0,
    created_at TEXT,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS public.deliveries (
    id TEXT PRIMARY KEY,
    customer_name TEXT,
    amount REAL,
    status TEXT,
    items TEXT,
    "startTime" TEXT,
    delivery_charge REAL DEFAULT 0,
    change_money_given REAL DEFAULT 0,
    created_at TEXT,
    completed_at TEXT,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS public.menu_categories (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    created_at TEXT,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS public.menu_items (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    category TEXT NOT NULL,
    created_at TEXT,
    updated_at TEXT,
    UNIQUE (name, category)
);


-- -------------------------------------------------------------------------
-- 2.3 DAILY AUDITING, CLOSING & SUMMARIES
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.daily_submit (
    id TEXT PRIMARY KEY,
    date TEXT UNIQUE NOT NULL,
    total_sell REAL,
    cash_payment REAL,
    bkash_payment REAL,
    nagad_payment REAL,
    rocket_payment REAL DEFAULT 0,
    delivery_sell REAL DEFAULT 0,
    delivery_charge REAL DEFAULT 0,
    eja REAL,
    dudu_store REAL,
    akash_murgi REAL,
    burger_bun REAL,
    bazar REAL,
    others REAL,
    total_expense REAL,
    net_cash REAL DEFAULT 0,
    net_deposit REAL,
    notes TEXT,
    submitted_by TEXT,
    submitted_at TEXT,
    is_locked INTEGER DEFAULT 0,
    submission_type TEXT DEFAULT 'MANUAL',
    created_at TEXT,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS public.daily_summary (
    id TEXT PRIMARY KEY,
    date TEXT UNIQUE NOT NULL,
    "dayOfWeek" TEXT,
    "weekOfMonth" INTEGER,
    "isFriday" INTEGER,
    "isHoliday" INTEGER,
    "specialDayNote" TEXT,
    temperature REAL,
    humidity REAL,
    condition TEXT,
    "isRainy" INTEGER,
    "windSpeed" REAL,
    "totalOrders" INTEGER,
    "totalSales" REAL,
    "totalDiscount" REAL,
    "totalExpense" REAL,
    "totalDelivery" REAL,
    total_delivery_charge REAL DEFAULT 0,
    "averageOrderValue" REAL,
    "peakHour" TEXT,
    "firstOrderTime" TEXT,
    "lastOrderTime" TEXT,
    "cashTotal" REAL,
    "bkashTotal" REAL,
    "nagadTotal" REAL,
    "rocketTotal" REAL DEFAULT 0,
    "ejaAmount" REAL,
    "netCash" REAL,
    "ownerDeposit" REAL,
    "itemSummary" TEXT,
    created_at TEXT,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS public.daily_submit_priority (
    business_date TEXT PRIMARY KEY,
    submitted_by TEXT,
    role TEXT,
    priority INTEGER,
    sync_source_device TEXT,
    device_id TEXT,
    submitted_at TEXT,
    created_at TEXT,
    updated_at TEXT
);

-- Phase 4 migration safety: same-role multi-device tie-breaker columns.
ALTER TABLE public.daily_submit_priority ADD COLUMN IF NOT EXISTS device_id TEXT;
ALTER TABLE public.daily_submit_priority ADD COLUMN IF NOT EXISTS submitted_at TEXT;

CREATE TABLE IF NOT EXISTS public.activity_logs (
    id TEXT PRIMARY KEY,
    business_date TEXT NOT NULL,
    "timestamp" TEXT NOT NULL,
    action_type TEXT NOT NULL,
    action_title TEXT NOT NULL,
    description TEXT,
    app_profile TEXT NOT NULL,
    user_role TEXT,
    user_name TEXT,
    device_id TEXT,
    device_name TEXT,
    device_model TEXT,
    device_platform TEXT,
    metadata TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);


-- -------------------------------------------------------------------------
-- 2.4 VENDOR, DUE & AUXILIARY RECORDS
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.due_payments (
    id TEXT PRIMARY KEY,
    customer_name TEXT,
    amount REAL,
    order_id TEXT,
    status TEXT,
    created_at TEXT,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS public.eja_history (
    id TEXT PRIMARY KEY,
    date TEXT,
    eja_amount REAL,
    created_at TEXT,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS public.off_days (
    id TEXT PRIMARY KEY,
    date TEXT UNIQUE,
    created_by TEXT,
    reason TEXT,
    status TEXT,
    created_at TEXT,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS public.weather_data (
    id TEXT PRIMARY KEY,
    date TEXT UNIQUE,
    temperature REAL,
    humidity REAL,
    condition TEXT,
    "isRainy" INTEGER,
    "windSpeed" REAL,
    created_at TEXT,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS public.supplier_due (
    id TEXT PRIMARY KEY,
    supplier_name TEXT,
    current_due REAL DEFAULT 0,
    note TEXT,
    created_at TEXT,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS public.supplier_due_history (
    id TEXT PRIMARY KEY,
    date TEXT,
    supplier_id TEXT,
    supplier_name TEXT,
    previous_due REAL,
    purchase_amount REAL,
    payment_amount REAL,
    current_due REAL,
    note TEXT,
    created_by TEXT,
    created_at TEXT,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS public.supplier_payment_ledger (
    id TEXT PRIMARY KEY,
    payment_date TEXT UNIQUE,
    month TEXT,
    year TEXT,
    variety_store_amount REAL DEFAULT 0,
    morgir_dokan_amount REAL DEFAULT 0,
    burger_ban_amount REAL DEFAULT 0,
    created_by TEXT,
    created_at TEXT,
    updated_at TEXT
);


-- -------------------------------------------------------------------------
-- 2.5 OWNER FINANCIAL MANAGEMENT
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.owner_employees (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT,
    designation TEXT,
    monthly_salary REAL NOT NULL,
    joining_date TEXT,
    status TEXT DEFAULT 'ACTIVE',
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.owner_salary_ledger (
    id TEXT PRIMARY KEY,
    employee_id TEXT NOT NULL REFERENCES public.owner_employees(id) ON DELETE CASCADE,
    amount REAL NOT NULL,
    payment_type TEXT NOT NULL,
    payment_date TEXT NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.owner_expenses (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    amount REAL NOT NULL,
    expense_date TEXT NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.owner_deposits (
    id TEXT PRIMARY KEY,
    month TEXT NOT NULL,
    amount REAL NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.owner_home_deposits (
    id TEXT PRIMARY KEY,
    amount REAL NOT NULL,
    deposit_date TEXT NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);


-- -------------------------------------------------------------------------
-- 2.6 DELETION TOMBSTONES & AUDIT LOGS
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.deletions (
    id TEXT PRIMARY KEY,
    table_name TEXT NOT NULL,
    record_id TEXT NOT NULL,
    created_at TEXT,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS public.delete_history (
    id TEXT PRIMARY KEY,
    record_type TEXT,
    record_id TEXT,
    deleted_by TEXT,
    deleted_at TEXT,
    created_by TEXT,
    original_created_at TEXT,
    snapshot_data TEXT,
    sync_status INTEGER DEFAULT 0,
    created_at TEXT,
    updated_at TEXT
);


-- =========================================================================
-- 3. INDEXES
-- =========================================================================

-- 3.1 Rolling-window date columns (per DATE_FIELD_ANALYSIS.md §5) — used by pg_cron retention
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON public.orders (created_at);
CREATE INDEX IF NOT EXISTS idx_order_items_created_at ON public.order_items (created_at);
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON public.payments (created_at);
CREATE INDEX IF NOT EXISTS idx_expenses_created_at ON public.expenses (created_at);
CREATE INDEX IF NOT EXISTS idx_deliveries_completed_at ON public.deliveries (completed_at);
CREATE INDEX IF NOT EXISTS idx_deliveries_created_at ON public.deliveries (created_at);
CREATE INDEX IF NOT EXISTS idx_due_payments_created_at ON public.due_payments (created_at);
CREATE INDEX IF NOT EXISTS idx_eja_history_date ON public.eja_history (date);
CREATE INDEX IF NOT EXISTS idx_off_days_date ON public.off_days (date);
CREATE INDEX IF NOT EXISTS idx_weather_data_date ON public.weather_data (date);
CREATE INDEX IF NOT EXISTS idx_supplier_due_history_date ON public.supplier_due_history (date);
CREATE INDEX IF NOT EXISTS idx_supplier_payment_ledger_payment_date ON public.supplier_payment_ledger (payment_date);
CREATE INDEX IF NOT EXISTS idx_owner_expenses_expense_date ON public.owner_expenses (expense_date);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON public.activity_logs (created_at);
CREATE INDEX IF NOT EXISTS idx_activity_logs_business_date ON public.activity_logs (business_date);

-- 3.2 Delta-pull cursors (updated_at) for Supabase-primary pull sync
CREATE INDEX IF NOT EXISTS idx_users_updated_at ON public.users (updated_at);
CREATE INDEX IF NOT EXISTS idx_restaurant_tables_updated_at ON public.restaurant_tables (updated_at);
CREATE INDEX IF NOT EXISTS idx_orders_updated_at ON public.orders (updated_at);
CREATE INDEX IF NOT EXISTS idx_order_items_updated_at ON public.order_items (updated_at);
CREATE INDEX IF NOT EXISTS idx_payments_updated_at ON public.payments (updated_at);
CREATE INDEX IF NOT EXISTS idx_expenses_updated_at ON public.expenses (updated_at);
CREATE INDEX IF NOT EXISTS idx_deliveries_updated_at ON public.deliveries (updated_at);
CREATE INDEX IF NOT EXISTS idx_menu_items_updated_at ON public.menu_items (updated_at);
CREATE INDEX IF NOT EXISTS idx_menu_categories_updated_at ON public.menu_categories (updated_at);
CREATE INDEX IF NOT EXISTS idx_daily_submit_date ON public.daily_submit (date);
CREATE INDEX IF NOT EXISTS idx_daily_summary_date ON public.daily_summary (date);
CREATE INDEX IF NOT EXISTS idx_owner_expenses_updated_at ON public.owner_expenses (updated_at);
CREATE INDEX IF NOT EXISTS idx_owner_employees_updated_at ON public.owner_employees (updated_at);


-- =========================================================================
-- 4. ROW LEVEL SECURITY — PERMISSIVE (PHASE 1 ONLY)
-- -------------------------------------------------------------------------
-- Matches the existing devices / device_app_usage policy style.
-- Device-gated RLS (is_device_active + X-Device-Id) is Phase 7 and is
-- intentionally NOT applied here.
-- =========================================================================
DO $$
DECLARE
    t TEXT;
    phase1_tables TEXT[] := ARRAY[
        'app_version_policy',
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
        'activity_logs',
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
        'deletions',
        'delete_history'
    ];
BEGIN
    FOREACH t IN ARRAY phase1_tables LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
        EXECUTE format('DROP POLICY IF EXISTS "Permissive anon access (Phase 1)" ON public.%I;', t);
        EXECUTE format(
            'CREATE POLICY "Permissive anon access (Phase 1)" ON public.%I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);',
            t
        );
        RAISE NOTICE 'Phase 1 permissive RLS applied to table: %', t;
    END LOOP;
END $$;


