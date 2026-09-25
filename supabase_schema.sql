-- =========================================================================
-- RONGDHONU POS: SUPABASE REALTIME DEVICE CONTROL SCHEMA
-- Run this script in the Supabase SQL Editor (https://supabase.com/dashboard)
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.devices (
    device_id TEXT PRIMARY KEY,
    device_name TEXT,
    manufacturer TEXT,
    brand TEXT,
    model TEXT,
    android_version TEXT,
    app_version TEXT,
    first_install_time TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING',  -- 'PENDING', 'ACTIVE', 'BLOCKED'
    allow_login BOOLEAN NOT NULL DEFAULT true,
    allow_offline BOOLEAN NOT NULL DEFAULT true,
    admin_lock BOOLEAN NOT NULL DEFAULT false,
    force_logout BOOLEAN NOT NULL DEFAULT false,
    force_logout_token TEXT,                 -- Unique revocation ID per command
    registered_by TEXT DEFAULT 'SYSTEM_AUTO',
    notes TEXT,
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    deleted_at TIMESTAMPTZ,
    deleted_by TEXT,
    last_seen_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Schema Migration: Ensure force_logout_token exists on pre-existing databases
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS force_logout_token TEXT;

-- Fast lookup indexes
CREATE INDEX IF NOT EXISTS idx_devices_status ON public.devices(status);
CREATE INDEX IF NOT EXISTS idx_devices_is_deleted ON public.devices(is_deleted);
CREATE INDEX IF NOT EXISTS idx_devices_last_seen ON public.devices(last_seen_at);

-- Enable Supabase Realtime replication on public.devices table
-- Note: Check if already added before executing to avoid errors
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

-- Enable Row Level Security (RLS)
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;

-- ═════════════════════════════════════════════════════════════════════════════
-- CURRENT STAGE: CLIENT-SIDE ROLE ENFORCEMENT (PERMISSIVE ANON RLS)
-- ⚠️ IMPORTANT NOTICE: Currently, client applications enforce role restrictions
-- locally. Any client with EXPO_PUBLIC_SUPABASE_ANON_KEY can execute raw queries.
-- DO NOT CLAIM SERVER-SIDE PROTECTION UNTIL THE PRODUCTION MIGRATION PLAN BELOW
-- IS EXECUTED IN SUPABASE SQL EDITOR.
-- ═════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Allow device tracking and control" ON public.devices;
CREATE POLICY "Allow device tracking and control"
    ON public.devices
    FOR ALL
    TO anon, authenticated
    USING (true)
    WITH CHECK (true);

-- ═════════════════════════════════════════════════════════════════════════════
-- PRODUCTION MIGRATION PLAN: SERVER-AUTHORITATIVE RPC & STRICT RLS
-- To deploy true server-side authorization, execute the following block:
-- ═════════════════════════════════════════════════════════════════════════════
/*
-- 1. Tightened Device Policy (Devices can only select/update their own telemetry)
DROP POLICY IF EXISTS "Allow device tracking and control" ON public.devices;

-- Devices can only read their own row (or Admin reads all)
CREATE POLICY "Devices read own status"
    ON public.devices
    FOR SELECT
    TO anon, authenticated
    USING (
        (auth.jwt() ->> 'role' = 'admin') OR
        (device_id = current_setting('request.headers', true)::json->>'x-device-id') OR
        (auth.jwt() ->> 'device_id' = device_id)
    );

-- Devices can only update their own heartbeat / last_seen_at and acknowledge force_logout
CREATE POLICY "Devices update own heartbeat and acknowledge force_logout"
    ON public.devices
    FOR UPDATE
    TO anon, authenticated
    USING (
        (auth.jwt() ->> 'role' = 'admin') OR
        (device_id = current_setting('request.headers', true)::json->>'x-device-id')
    )
    WITH CHECK (
        -- Regular devices CANNOT modify admin_lock, status, or allow_offline
        (auth.jwt() ->> 'role' = 'admin') OR (
            status IS NOT DISTINCT FROM (SELECT d.status FROM public.devices d WHERE d.device_id = devices.device_id) AND
            admin_lock IS NOT DISTINCT FROM (SELECT d.admin_lock FROM public.devices d WHERE d.device_id = devices.device_id) AND
            allow_offline IS NOT DISTINCT FROM (SELECT d.allow_offline FROM public.devices d WHERE d.device_id = devices.device_id)
        )
    );

-- 2. Server-Side Administrative RPC for Sensitive Actions (Lock, Block, Force Logout)
CREATE OR REPLACE FUNCTION public.admin_device_action(
    p_action TEXT,              -- 'FORCE_LOGOUT', 'LOCK', 'UNLOCK', 'BLOCK', 'APPROVE'
    p_target_device_id TEXT,
    p_params JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_admin_role TEXT;
    v_token TEXT;
    v_now TIMESTAMPTZ := now();
BEGIN
    -- Authorize caller via Supabase Auth JWT
    v_admin_role := coalesce(auth.jwt() ->> 'role', '');
    IF v_admin_role != 'admin' THEN
        -- Also check custom claims or admin table
        IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE id = auth.uid()) THEN
            RAISE EXCEPTION 'Unauthorized: Caller is not an authorized administrator';
        END IF;
    END IF;

    IF p_action = 'FORCE_LOGOUT' THEN
        v_token := 'fl_' || floor(extract(epoch from now()) * 1000)::text || '_' || substr(md5(random()::text), 1, 8);
        UPDATE public.devices
        SET force_logout = true,
            force_logout_token = v_token,
            updated_at = v_now
        WHERE device_id = p_target_device_id;
        RETURN jsonb_build_object('success', true, 'action', p_action, 'token', v_token);

    ELSIF p_action = 'LOCK' THEN
        UPDATE public.devices
        SET admin_lock = true,
            updated_at = v_now
        WHERE device_id = p_target_device_id;
        RETURN jsonb_build_object('success', true, 'action', p_action);

    ELSIF p_action = 'UNLOCK' THEN
        UPDATE public.devices
        SET admin_lock = false,
            updated_at = v_now
        WHERE device_id = p_target_device_id;
        RETURN jsonb_build_object('success', true, 'action', p_action);

    ELSIF p_action = 'BLOCK' THEN
        UPDATE public.devices
        SET status = 'BLOCKED',
            allow_login = false,
            updated_at = v_now
        WHERE device_id = p_target_device_id;
        RETURN jsonb_build_object('success', true, 'action', p_action);

    ELSIF p_action = 'APPROVE' THEN
        UPDATE public.devices
        SET status = 'ACTIVE',
            allow_login = true,
            updated_at = v_now
        WHERE device_id = p_target_device_id;
        RETURN jsonb_build_object('success', true, 'action', p_action);

    ELSE
        RAISE EXCEPTION 'Unknown action: %', p_action;
    END IF;
END;
$$;
*/
-- =========================================================================
-- RONGDHONU POS: DAY-WISE APP USAGE TRACKING TABLE
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.device_app_usage (
    id TEXT PRIMARY KEY,                       -- e.g. 'hw_123_2026-09-18_ADMIN'
    device_id TEXT NOT NULL,
    business_date TEXT NOT NULL,              -- YYYY-MM-DD (Dhaka 06:00 AM cutoff)
    role TEXT NOT NULL,                        -- 'ADMIN', 'OWNER', 'MANAGER', 'WAITER'
    app_label TEXT NOT NULL,                   -- 'Admin App', 'Manager App', etc.
    total_seconds INTEGER NOT NULL DEFAULT 0,
    last_heartbeat TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Fast lookup indexes
CREATE INDEX IF NOT EXISTS idx_device_app_usage_date ON public.device_app_usage(business_date);
CREATE INDEX IF NOT EXISTS idx_device_app_usage_device ON public.device_app_usage(device_id);

-- Enable Supabase Realtime replication on public.device_app_usage table
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

-- Enable Row Level Security (RLS)
ALTER TABLE public.device_app_usage ENABLE ROW LEVEL SECURITY;

-- Device App Usage Policy: Allow read, insert, and update using anon and authenticated roles
DROP POLICY IF EXISTS "Allow device app usage tracking" ON public.device_app_usage;
CREATE POLICY "Allow device app usage tracking"
    ON public.device_app_usage
    FOR ALL
    TO anon, authenticated
    USING (true)
    WITH CHECK (true);

