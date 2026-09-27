-- ============================================================================
-- RONGDHONU POS — PHASE 7: DEVICE-GATED RLS (OPTION B)
-- ============================================================================
-- Gate  : every POS table requires a valid X-Device-Id header resolving to a
--         device with status='ACTIVE' AND allow_login=true AND admin_lock=false
--         AND is_deleted=false (see public.is_device_active below).
-- Risk  : HIGH — a mistake can lock every device out of Supabase. All Supabase
--         failures fall back to Firebase (Phase 3), so a mistake degrades to
--         Firebase-only rather than an outage — but still, run STAGED.
--
-- ⚠️ RUN THIS FILE STAGED, NOT ALL AT ONCE ⚠️
--   1. Run SECTION 0 (function), SECTION 1 (never-gate tables) and SECTION 2
--      (version policy) once — these are safe/idempotent and lock nothing.
--   2. Then run ONE "STAGE n" block at a time (each block gates exactly one
--      table). Every block is self-contained: comment out the others.
--   3. After each block: verify with SECTION 4, then test in the app with an
--      ACTIVE device (must work) and, if possible, a PENDING/BLOCKED device
--      (must be denied on that table and silently fall back to Firebase).
--   4. Only after the owner confirms a stage works, run the next one. The
--      highest-traffic tables (orders/order_items/payments) are LAST (STAGE 7).
--
-- CRITICAL — WHY WE DROP A PHASE-1 POLICY:
--   Phase 1 (supabase_full_setup.sql PART 4) created a PERMISSIVE policy named
--   "Permissive anon access (Phase 1)" (FOR ALL USING (true)) on every POS table.
--   Postgres combines multiple permissive policies with OR, so merely ADDING a
--   gate policy would have NO effect while that permissive policy exists.
--   Each stage block therefore DROPS "Permissive anon access (Phase 1)" first.
--
-- ROLLBACK: SECTION 5 — revoke a single table's gate (or all of them).
-- ============================================================================


-- ============================================================================
-- SECTION 0 — THE GATE FUNCTION (run once; idempotent; locks nothing)
-- ============================================================================
-- SECURITY DEFINER so it can read public.devices regardless of the caller's RLS.
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

-- Allow the anon (app) role to call it from RLS policy expressions.
GRANT EXECUTE ON FUNCTION public.is_device_active(TEXT) TO anon, authenticated;

-- Sanity check (optional): replace the id with a real ACTIVE device_id.
-- SELECT public.is_device_active('REPLACE_WITH_AN_ACTIVE_DEVICE_ID');  -- expect true
-- SELECT public.is_device_active('does-not-exist');                    -- expect false
-- SELECT public.is_device_active(NULL);                                -- expect false


-- ============================================================================
-- SECTION 1 — NEVER GATED (intentional, FINAL decision — do NOT revisit)
-- ============================================================================
-- devices + device_app_usage MUST stay permissive: a brand-new device has no
-- approved state yet and must be able to register itself, poll its own row,
-- send heartbeats, and emit usage telemetry while PENDING. Gating them would
-- deadlock device approval. This is an owner decision, recorded in
-- MIGRATION_PROGRESS.md. Their permissive policies already exist (created by
-- supabase_full_setup.sql PART 1/2). The statements below are a defensive,
-- idempotent re-assertion of exactly that permissive state — they change nothing.
--
-- DO NOT add an is_device_active() gate to either of these tables.

ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow device tracking and control" ON public.devices;
CREATE POLICY "Allow device tracking and control"
    ON public.devices FOR ALL TO anon, authenticated
    USING (true) WITH CHECK (true);

ALTER TABLE public.device_app_usage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow device app usage tracking" ON public.device_app_usage;
CREATE POLICY "Allow device app usage tracking"
    ON public.device_app_usage FOR ALL TO anon, authenticated
    USING (true) WITH CHECK (true);


-- ============================================================================
-- SECTION 2 — app_version_policy (public READ, permissive WRITE for now)
-- ============================================================================
-- Public SELECT is required: the version check runs BEFORE device registration
-- (App.js cold start), so there is no X-Device-Id yet.
-- WRITE stays permissive: there is no Postgres admin-auth mechanism today, and
-- the Phase-6 dual writer uses UPSERT (INSERT + UPDATE) — so we must keep
-- INSERT and UPDATE open to preserve current behavior (no regression).
-- DELETE is intentionally NOT granted (the app never deletes this row).

ALTER TABLE public.app_version_policy ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permissive anon access (Phase 1)" ON public.app_version_policy;
DROP POLICY IF EXISTS "Public read version policy" ON public.app_version_policy;
DROP POLICY IF EXISTS "Permissive version policy insert" ON public.app_version_policy;
DROP POLICY IF EXISTS "Permissive version policy update" ON public.app_version_policy;

CREATE POLICY "Public read version policy"
    ON public.app_version_policy FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Permissive version policy insert"
    ON public.app_version_policy FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE POLICY "Permissive version policy update"
    ON public.app_version_policy FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);


-- ============================================================================
-- SECTION 2b — sync_heartbeat (observability; NEVER device-gated)
-- ============================================================================
-- Same treatment as `devices`/`device_app_usage`: this is a device-STATUS table.
-- It must stay writable BEFORE/independent of the device-active gate (a device may
-- be PENDING, and the heartbeat is exactly how you observe that state).
ALTER TABLE public.sync_heartbeat ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permissive anon access (Phase 1)" ON public.sync_heartbeat;
DROP POLICY IF EXISTS "Public read sync heartbeat" ON public.sync_heartbeat;
DROP POLICY IF EXISTS "Permissive heartbeat insert" ON public.sync_heartbeat;
DROP POLICY IF EXISTS "Permissive heartbeat update" ON public.sync_heartbeat;

CREATE POLICY "Public read sync heartbeat"
    ON public.sync_heartbeat FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Permissive heartbeat insert"
    ON public.sync_heartbeat FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE POLICY "Permissive heartbeat update"
    ON public.sync_heartbeat FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);


-- ============================================================================
-- SECTION 3 — STAGED DEVICE-GATED POLICIES (27 POS TABLES)
-- ----------------------------------------------------------------------------
-- Run ONE block at a time, lowest-risk first. Each block:
--   1. enables RLS on the table,
--   2. DROPS the Phase-1 permissive policy (CRITICAL — see header),
--   3. (re)creates the single strict "Device active gate" policy.
-- To gate only one table for a test, keep just that block uncommented.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- STAGE 1 — lowest traffic, rarely written (safest first test)
-- ────────────────────────────────────────────────────────────────────────────

-- ===== STAGE 1 · off_days ====================================================
ALTER TABLE public.off_days ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permissive anon access (Phase 1)" ON public.off_days;   -- CRITICAL
DROP POLICY IF EXISTS "Device active gate" ON public.off_days;
CREATE POLICY "Device active gate" ON public.off_days FOR ALL TO anon, authenticated
    USING (public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id'))
    WITH CHECK (public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id'));

-- ===== STAGE 1 · weather_data ================================================
ALTER TABLE public.weather_data ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permissive anon access (Phase 1)" ON public.weather_data;   -- CRITICAL
DROP POLICY IF EXISTS "Device active gate" ON public.weather_data;
CREATE POLICY "Device active gate" ON public.weather_data FOR ALL TO anon, authenticated
    USING (public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id'))
    WITH CHECK (public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id'));

-- ===== STAGE 1 · eja_history =================================================
ALTER TABLE public.eja_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permissive anon access (Phase 1)" ON public.eja_history;   -- CRITICAL
DROP POLICY IF EXISTS "Device active gate" ON public.eja_history;
CREATE POLICY "Device active gate" ON public.eja_history FOR ALL TO anon, authenticated
    USING (public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id'))
    WITH CHECK (public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id'));


-- ────────────────────────────────────────────────────────────────────────────
-- STAGE 2 — vendor / due records (low traffic)
-- ────────────────────────────────────────────────────────────────────────────

-- ===== STAGE 2 · supplier_due ================================================
ALTER TABLE public.supplier_due ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permissive anon access (Phase 1)" ON public.supplier_due;   -- CRITICAL
DROP POLICY IF EXISTS "Device active gate" ON public.supplier_due;
CREATE POLICY "Device active gate" ON public.supplier_due FOR ALL TO anon, authenticated
    USING (public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id'))
    WITH CHECK (public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id'));

-- ===== STAGE 2 · supplier_due_history ========================================
ALTER TABLE public.supplier_due_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permissive anon access (Phase 1)" ON public.supplier_due_history;   -- CRITICAL
DROP POLICY IF EXISTS "Device active gate" ON public.supplier_due_history;
CREATE POLICY "Device active gate" ON public.supplier_due_history FOR ALL TO anon, authenticated
    USING (public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id'))
    WITH CHECK (public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id'));

-- ===== STAGE 2 · supplier_payment_ledger =====================================
ALTER TABLE public.supplier_payment_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permissive anon access (Phase 1)" ON public.supplier_payment_ledger;   -- CRITICAL
DROP POLICY IF EXISTS "Device active gate" ON public.supplier_payment_ledger;
CREATE POLICY "Device active gate" ON public.supplier_payment_ledger FOR ALL TO anon, authenticated
    USING (public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id'))
    WITH CHECK (public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id'));

-- ===== STAGE 2 · due_payments ================================================
ALTER TABLE public.due_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permissive anon access (Phase 1)" ON public.due_payments;   -- CRITICAL
DROP POLICY IF EXISTS "Device active gate" ON public.due_payments;
CREATE POLICY "Device active gate" ON public.due_payments FOR ALL TO anon, authenticated
    USING (public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id'))
    WITH CHECK (public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id'));


-- ────────────────────────────────────────────────────────────────────────────
-- STAGE 3 — owner financial management (owner devices, low traffic)
-- ────────────────────────────────────────────────────────────────────────────

-- ===== STAGE 3 · owner_home_deposits =========================================
ALTER TABLE public.owner_home_deposits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permissive anon access (Phase 1)" ON public.owner_home_deposits;   -- CRITICAL
DROP POLICY IF EXISTS "Device active gate" ON public.owner_home_deposits;
CREATE POLICY "Device active gate" ON public.owner_home_deposits FOR ALL TO anon, authenticated
    USING (public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id'))
    WITH CHECK (public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id'));

-- ===== STAGE 3 · owner_deposits ==============================================
ALTER TABLE public.owner_deposits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permissive anon access (Phase 1)" ON public.owner_deposits;   -- CRITICAL
DROP POLICY IF EXISTS "Device active gate" ON public.owner_deposits;
CREATE POLICY "Device active gate" ON public.owner_deposits FOR ALL TO anon, authenticated
    USING (public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id'))
    WITH CHECK (public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id'));

-- ===== STAGE 3 · owner_expenses ==============================================
ALTER TABLE public.owner_expenses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permissive anon access (Phase 1)" ON public.owner_expenses;   -- CRITICAL
DROP POLICY IF EXISTS "Device active gate" ON public.owner_expenses;
CREATE POLICY "Device active gate" ON public.owner_expenses FOR ALL TO anon, authenticated
    USING (public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id'))
    WITH CHECK (public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id'));

-- ===== STAGE 3 · owner_salary_ledger =========================================
ALTER TABLE public.owner_salary_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permissive anon access (Phase 1)" ON public.owner_salary_ledger;   -- CRITICAL
DROP POLICY IF EXISTS "Device active gate" ON public.owner_salary_ledger;
CREATE POLICY "Device active gate" ON public.owner_salary_ledger FOR ALL TO anon, authenticated
    USING (public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id'))
    WITH CHECK (public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id'));

-- ===== STAGE 3 · owner_employees =============================================
ALTER TABLE public.owner_employees ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permissive anon access (Phase 1)" ON public.owner_employees;   -- CRITICAL
DROP POLICY IF EXISTS "Device active gate" ON public.owner_employees;
CREATE POLICY "Device active gate" ON public.owner_employees FOR ALL TO anon, authenticated
    USING (public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id'))
    WITH CHECK (public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id'));


-- ────────────────────────────────────────────────────────────────────────────
-- STAGE 4 — audit / tombstones (non-critical: failures are non-fatal)
-- ────────────────────────────────────────────────────────────────────────────

-- ===== STAGE 4 · delete_history ==============================================
ALTER TABLE public.delete_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permissive anon access (Phase 1)" ON public.delete_history;   -- CRITICAL
DROP POLICY IF EXISTS "Device active gate" ON public.delete_history;
CREATE POLICY "Device active gate" ON public.delete_history FOR ALL TO anon, authenticated
    USING (public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id'))
    WITH CHECK (public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id'));

-- ===== STAGE 4 · deletions ===================================================
ALTER TABLE public.deletions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permissive anon access (Phase 1)" ON public.deletions;   -- CRITICAL
DROP POLICY IF EXISTS "Device active gate" ON public.deletions;
CREATE POLICY "Device active gate" ON public.deletions FOR ALL TO anon, authenticated
    USING (public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id'))
    WITH CHECK (public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id'));

-- ===== STAGE 4 · activity_logs ===============================================
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permissive anon access (Phase 1)" ON public.activity_logs;   -- CRITICAL
DROP POLICY IF EXISTS "Device active gate" ON public.activity_logs;
CREATE POLICY "Device active gate" ON public.activity_logs FOR ALL TO anon, authenticated
    USING (public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id'))
    WITH CHECK (public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id'));


-- ────────────────────────────────────────────────────────────────────────────
-- STAGE 5 — catalog / identity / tables (medium traffic)
-- ────────────────────────────────────────────────────────────────────────────

-- ===== STAGE 5 · menu_categories =============================================
ALTER TABLE public.menu_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permissive anon access (Phase 1)" ON public.menu_categories;   -- CRITICAL
DROP POLICY IF EXISTS "Device active gate" ON public.menu_categories;
CREATE POLICY "Device active gate" ON public.menu_categories FOR ALL TO anon, authenticated
    USING (public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id'))
    WITH CHECK (public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id'));

-- ===== STAGE 5 · menu_items ==================================================
ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permissive anon access (Phase 1)" ON public.menu_items;   -- CRITICAL
DROP POLICY IF EXISTS "Device active gate" ON public.menu_items;
CREATE POLICY "Device active gate" ON public.menu_items FOR ALL TO anon, authenticated
    USING (public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id'))
    WITH CHECK (public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id'));

-- ===== STAGE 5 · users =======================================================
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permissive anon access (Phase 1)" ON public.users;   -- CRITICAL
DROP POLICY IF EXISTS "Device active gate" ON public.users;
CREATE POLICY "Device active gate" ON public.users FOR ALL TO anon, authenticated
    USING (public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id'))
    WITH CHECK (public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id'));

-- ===== STAGE 5 · restaurant_tables ===========================================
ALTER TABLE public.restaurant_tables ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permissive anon access (Phase 1)" ON public.restaurant_tables;   -- CRITICAL
DROP POLICY IF EXISTS "Device active gate" ON public.restaurant_tables;
CREATE POLICY "Device active gate" ON public.restaurant_tables FOR ALL TO anon, authenticated
    USING (public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id'))
    WITH CHECK (public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id'));


-- ────────────────────────────────────────────────────────────────────────────
-- STAGE 6 — daily auditing / expenses (medium traffic; business-critical)
-- ────────────────────────────────────────────────────────────────────────────

-- ===== STAGE 6 · daily_submit_priority =======================================
ALTER TABLE public.daily_submit_priority ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permissive anon access (Phase 1)" ON public.daily_submit_priority;   -- CRITICAL
DROP POLICY IF EXISTS "Device active gate" ON public.daily_submit_priority;
CREATE POLICY "Device active gate" ON public.daily_submit_priority FOR ALL TO anon, authenticated
    USING (public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id'))
    WITH CHECK (public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id'));

-- ===== STAGE 6 · daily_summary ===============================================
ALTER TABLE public.daily_summary ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permissive anon access (Phase 1)" ON public.daily_summary;   -- CRITICAL
DROP POLICY IF EXISTS "Device active gate" ON public.daily_summary;
CREATE POLICY "Device active gate" ON public.daily_summary FOR ALL TO anon, authenticated
    USING (public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id'))
    WITH CHECK (public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id'));

-- ===== STAGE 6 · daily_submit ================================================
ALTER TABLE public.daily_submit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permissive anon access (Phase 1)" ON public.daily_submit;   -- CRITICAL
DROP POLICY IF EXISTS "Device active gate" ON public.daily_submit;
CREATE POLICY "Device active gate" ON public.daily_submit FOR ALL TO anon, authenticated
    USING (public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id'))
    WITH CHECK (public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id'));

-- ===== STAGE 6 · expenses ====================================================
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permissive anon access (Phase 1)" ON public.expenses;   -- CRITICAL
DROP POLICY IF EXISTS "Device active gate" ON public.expenses;
CREATE POLICY "Device active gate" ON public.expenses FOR ALL TO anon, authenticated
    USING (public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id'))
    WITH CHECK (public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id'));


-- ────────────────────────────────────────────────────────────────────────────
-- STAGE 7 — HIGHEST TRAFFIC (DO LAST — orders/order_items/payments/deliveries)
-- ────────────────────────────────────────────────────────────────────────────

-- ===== STAGE 7 · deliveries ==================================================
ALTER TABLE public.deliveries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permissive anon access (Phase 1)" ON public.deliveries;   -- CRITICAL
DROP POLICY IF EXISTS "Device active gate" ON public.deliveries;
CREATE POLICY "Device active gate" ON public.deliveries FOR ALL TO anon, authenticated
    USING (public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id'))
    WITH CHECK (public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id'));

-- ===== STAGE 7 · payments ====================================================
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permissive anon access (Phase 1)" ON public.payments;   -- CRITICAL
DROP POLICY IF EXISTS "Device active gate" ON public.payments;
CREATE POLICY "Device active gate" ON public.payments FOR ALL TO anon, authenticated
    USING (public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id'))
    WITH CHECK (public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id'));

-- ===== STAGE 7 · order_items =================================================
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permissive anon access (Phase 1)" ON public.order_items;   -- CRITICAL
DROP POLICY IF EXISTS "Device active gate" ON public.order_items;
CREATE POLICY "Device active gate" ON public.order_items FOR ALL TO anon, authenticated
    USING (public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id'))
    WITH CHECK (public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id'));

-- ===== STAGE 7 · orders ======================================================
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permissive anon access (Phase 1)" ON public.orders;   -- CRITICAL
DROP POLICY IF EXISTS "Device active gate" ON public.orders;
CREATE POLICY "Device active gate" ON public.orders FOR ALL TO anon, authenticated
    USING (public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id'))
    WITH CHECK (public.is_device_active(current_setting('request.headers', true)::json->>'x-device-id'));


-- ============================================================================
-- SECTION 4 — VERIFICATION QUERIES (run after each stage)
-- ============================================================================

-- (a) Policies on ONE table — expect exactly one row: "Device active gate".
-- SELECT policyname, cmd, roles, qual, with_check
--   FROM pg_policies
--  WHERE schemaname = 'public' AND tablename = 'off_days';

-- (b) Any POS table STILL carrying the Phase-1 permissive policy? Expect 0 rows
--     for a fully-gated table (this is the "did I forget to drop it?" check).
-- SELECT tablename, policyname FROM pg_policies
--  WHERE schemaname = 'public' AND policyname = 'Permissive anon access (Phase 1)'
--  ORDER BY tablename;

-- (c) Full gate inventory (one row per gated table once rolled out).
-- SELECT tablename, policyname FROM pg_policies
--  WHERE schemaname = 'public' AND policyname = 'Device active gate'
--  ORDER BY tablename;

-- (d) Confirm the never-gate tables are still permissive (expect both present).
-- SELECT tablename, policyname FROM pg_policies
--  WHERE schemaname = 'public'
--    AND tablename IN ('devices','device_app_usage', 'app_version_policy')
--  ORDER BY tablename;

-- (e) Confirm device state for the device you are testing with.
-- SELECT device_id, status, allow_login, admin_lock, is_deleted
--   FROM public.devices WHERE device_id = 'REPLACE_WITH_DEVICE_ID';


-- ============================================================================
-- SECTION 5 — ROLLBACK
-- ============================================================================
-- To UNGATE a single table (restore Phase-1 permissive behavior), run:
--
--   SELECT public.revoke_device_gate('off_days');
--
-- The helper below drops the gate and restores the Phase-1 permissive policy.

CREATE OR REPLACE FUNCTION public.revoke_device_gate(p_table TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    EXECUTE format('DROP POLICY IF EXISTS "Device active gate" ON public.%I;', p_table);
    EXECUTE format('DROP POLICY IF EXISTS "Permissive anon access (Phase 1)" ON public.%I;', p_table);
    EXECUTE format(
        'CREATE POLICY "Permissive anon access (Phase 1)" ON public.%I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);',
        p_table
    );
    RAISE NOTICE 'Revoked device gate on public.% (back to permissive)', p_table;
END $$;

-- EMERGENCY: ungated everything at once (run only if the rollout goes wrong).
-- DO $$
-- DECLARE t TEXT;
-- BEGIN
--   FOREACH t IN ARRAY ARRAY[
--     'off_days','weather_data','eja_history','supplier_due','supplier_due_history',
--     'supplier_payment_ledger','due_payments','owner_home_deposits','owner_deposits',
--     'owner_expenses','owner_salary_ledger','owner_employees','delete_history',
--     'deletions','activity_logs','menu_categories','menu_items','users',
--     'restaurant_tables','daily_submit_priority','daily_summary','daily_submit',
--     'expenses','deliveries','payments','order_items','orders'
--   ] LOOP
--     PERFORM public.revoke_device_gate(t);
--   END LOOP;
-- END $$;
-- ============================================================================
