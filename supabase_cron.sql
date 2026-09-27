-- ============================================================================
-- RONGDHONU POS — PHASE 5: ROLLING 31-DAY RETENTION (Supabase / pg_cron)
-- ============================================================================
-- Goal   : Server-side delete of rows older than 31 days from the 13 rolling
--          transactional tables. NEVER touches local SQLite or Firebase history.
-- Runs   : Once daily at 03:05 Asia/Dhaka = 21:05 UTC (previous day) -> '5 21 * * *'
-- Target : Supabase SQL Editor (run manually; idempotent, safe to re-run).
--
-- IMPORTANT — text-column cast:
--   In Supabase every timestamp column is TEXT (ISO-8601 UTC, e.g.
--   '2026-09-27T18:15:00.000Z'), NOT timestamptz. So `col AT TIME ZONE 'Asia/Dhaka'`
--   (as written in IMPLEMENTATION_PLAN.md §5.1) would ERROR on a text column; we
--   cast to timestamptz first: `(col::timestamptz AT TIME ZONE 'Asia/Dhaka')::date`.
--   Pure date-string columns (date/payment_date/expense_date) are cast `::date`.
--
-- ROLLING (13 — deleted):  orders, order_items, payments, expenses, deliveries,
--   due_payments, eja_history, off_days, weather_data, supplier_due_history,
--   supplier_payment_ledger, owner_expenses, activity_logs.
-- PERMANENT / NON-WINDOWED (17 — NEVER touched): menu_items, menu_categories,
--   restaurant_tables, devices, device_app_usage, app_version_policy,
--   daily_submit, daily_summary, daily_submit_priority, users, supplier_due,
--   deletions, delete_history, owner_employees, owner_salary_ledger,
--   owner_deposits, owner_home_deposits.
--   (13 + 17 = 30 tables = the full set. This exclusion list is COMPLETE.)
--
-- activity_logs uses created_at (not business_date) on purpose: historical
-- business_date values predate the Phase 4 Dhaka fix and were never backfilled.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 0. Ensure pg_cron is available (no-op if already enabled).
--    pg_cron runs jobs in the UTC timezone.
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron;


-- ---------------------------------------------------------------------------
-- 1. Idempotent (re)registration: drop the existing job (if any), then create it.
--    unschedule-by-name is guarded so a first run does not raise.
-- ---------------------------------------------------------------------------
SELECT cron.unschedule('rongdhonu_retention_31d')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rongdhonu_retention_31d');

SELECT cron.schedule(
  'rongdhonu_retention_31d',
  '5 21 * * *',                      -- 21:05 UTC == 03:05 Asia/Dhaka (UTC+6)
  $job$
  DO $do$
  DECLARE
    cutoff date := ((now() AT TIME ZONE 'Asia/Dhaka')::date - INTERVAL '31 days')::date;
    total  integer := 0;
    n      integer;
  BEGIN
    -- 1. orders
    DELETE FROM public.orders
      WHERE (created_at::timestamptz AT TIME ZONE 'Asia/Dhaka')::date < cutoff;
    GET DIAGNOSTICS n = ROW_COUNT; total := total + n;

    -- 2. order_items
    DELETE FROM public.order_items
      WHERE (created_at::timestamptz AT TIME ZONE 'Asia/Dhaka')::date < cutoff;
    GET DIAGNOSTICS n = ROW_COUNT; total := total + n;

    -- 3. payments
    DELETE FROM public.payments
      WHERE (created_at::timestamptz AT TIME ZONE 'Asia/Dhaka')::date < cutoff;
    GET DIAGNOSTICS n = ROW_COUNT; total := total + n;

    -- 4. expenses
    DELETE FROM public.expenses
      WHERE (created_at::timestamptz AT TIME ZONE 'Asia/Dhaka')::date < cutoff;
    GET DIAGNOSTICS n = ROW_COUNT; total := total + n;

    -- 5. deliveries (completed_at when present, else created_at; '' treated as NULL)
    DELETE FROM public.deliveries
      WHERE COALESCE(
              (NULLIF(completed_at, '')::timestamptz AT TIME ZONE 'Asia/Dhaka')::date,
              (NULLIF(created_at,   '')::timestamptz AT TIME ZONE 'Asia/Dhaka')::date
            ) < cutoff;
    GET DIAGNOSTICS n = ROW_COUNT; total := total + n;

    -- 6. due_payments
    DELETE FROM public.due_payments
      WHERE (created_at::timestamptz AT TIME ZONE 'Asia/Dhaka')::date < cutoff;
    GET DIAGNOSTICS n = ROW_COUNT; total := total + n;

    -- 7. eja_history
    DELETE FROM public.eja_history
      WHERE date::date < cutoff;
    GET DIAGNOSTICS n = ROW_COUNT; total := total + n;

    -- 8. off_days
    DELETE FROM public.off_days
      WHERE date::date < cutoff;
    GET DIAGNOSTICS n = ROW_COUNT; total := total + n;

    -- 9. weather_data
    DELETE FROM public.weather_data
      WHERE date::date < cutoff;
    GET DIAGNOSTICS n = ROW_COUNT; total := total + n;

    -- 10. supplier_due_history
    DELETE FROM public.supplier_due_history
      WHERE date::date < cutoff;
    GET DIAGNOSTICS n = ROW_COUNT; total := total + n;

    -- 11. supplier_payment_ledger
    DELETE FROM public.supplier_payment_ledger
      WHERE payment_date::date < cutoff;
    GET DIAGNOSTICS n = ROW_COUNT; total := total + n;

    -- 12. owner_expenses
    DELETE FROM public.owner_expenses
      WHERE expense_date::date < cutoff;
    GET DIAGNOSTICS n = ROW_COUNT; total := total + n;

    -- 13. activity_logs (by created_at — see header note)
    DELETE FROM public.activity_logs
      WHERE (created_at::timestamptz AT TIME ZONE 'Asia/Dhaka')::date < cutoff;
    GET DIAGNOSTICS n = ROW_COUNT; total := total + n;

    RAISE NOTICE '[rongdhonu-retention] cutoff=% deleted_rows=%', cutoff, total;
  END
  $do$;
  $job$
);


-- ============================================================================
-- VERIFICATION QUERIES — run these manually AFTER the schedule above.
-- ============================================================================

-- (a) Confirm the job is registered with the right name/schedule/command.
-- SELECT jobid, jobname, schedule, active, command
--   FROM cron.job
--  WHERE jobname = 'rongdhonu_retention_31d';

-- (b) Confirm the schedule is '5 21 * * *' (21:05 UTC = 03:05 Asia/Dhaka).
-- SELECT jobid, jobname, schedule,
--        (now() AT TIME ZONE 'Asia/Dhaka')                       AS now_dhaka,
--        (now() AT TIME ZONE 'Asia/Dhaka')::date + INTERVAL '1 day' AS next_dhaka_day
--   FROM cron.job WHERE jobname = 'rongdhonu_retention_31d';

-- (c) Check the most recent run outcomes (populated after the first execution).
-- SELECT jobid, runid, status, return_message, start_time, end_time
--   FROM cron.job_run_details
--  WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'rongdhonu_retention_31d')
--  ORDER BY start_time DESC
--  LIMIT 5;


-- ============================================================================
-- OPTIONAL DRY-RUN PREVIEW — how many rows WOULD be deleted right now.
-- Run manually; changes nothing.
-- ============================================================================
-- WITH cutoff AS (SELECT ((now() AT TIME ZONE 'Asia/Dhaka')::date - INTERVAL '31 days')::date AS c)
-- SELECT 'orders' AS tbl, COUNT(*) FROM public.orders, cutoff WHERE (created_at::timestamptz AT TIME ZONE 'Asia/Dhaka')::date < c
-- UNION ALL SELECT 'order_items', COUNT(*) FROM public.order_items, cutoff WHERE (created_at::timestamptz AT TIME ZONE 'Asia/Dhaka')::date < c
-- UNION ALL SELECT 'payments',    COUNT(*) FROM public.payments,    cutoff WHERE (created_at::timestamptz AT TIME ZONE 'Asia/Dhaka')::date < c
-- UNION ALL SELECT 'expenses',    COUNT(*) FROM public.expenses,    cutoff WHERE (created_at::timestamptz AT TIME ZONE 'Asia/Dhaka')::date < c
-- UNION ALL SELECT 'deliveries',  COUNT(*) FROM public.deliveries,  cutoff WHERE COALESCE((NULLIF(completed_at,'')::timestamptz AT TIME ZONE 'Asia/Dhaka')::date,(NULLIF(created_at,'')::timestamptz AT TIME ZONE 'Asia/Dhaka')::date) < c
-- UNION ALL SELECT 'due_payments',COUNT(*) FROM public.due_payments,cutoff WHERE (created_at::timestamptz AT TIME ZONE 'Asia/Dhaka')::date < c
-- UNION ALL SELECT 'eja_history', COUNT(*) FROM public.eja_history, cutoff WHERE date::date < c
-- UNION ALL SELECT 'off_days',    COUNT(*) FROM public.off_days,    cutoff WHERE date::date < c
-- UNION ALL SELECT 'weather_data',COUNT(*) FROM public.weather_data,cutoff WHERE date::date < c
-- UNION ALL SELECT 'supplier_due_history', COUNT(*) FROM public.supplier_due_history, cutoff WHERE date::date < c
-- UNION ALL SELECT 'supplier_payment_ledger', COUNT(*) FROM public.supplier_payment_ledger, cutoff WHERE payment_date::date < c
-- UNION ALL SELECT 'owner_expenses', COUNT(*) FROM public.owner_expenses, cutoff WHERE expense_date::date < c
-- UNION ALL SELECT 'activity_logs',  COUNT(*) FROM public.activity_logs,  cutoff WHERE (created_at::timestamptz AT TIME ZONE 'Asia/Dhaka')::date < c;
