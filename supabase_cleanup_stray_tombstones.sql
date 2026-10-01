-- ============================================================================
-- RONGDHONU POS — CLEANUP: stray / foreign deletion tombstones
-- ============================================================================
-- Symptom it fixes (repeated in the device log):
--
--   ERROR [SupabaseSync] Failed to delete target record locally:
--     Call to function 'NativeDatabase.prepareSync' has been rejected.
--   → Caused by: Error code : no such table: private_employees
--
-- ROOT CAUSE
--   A row in public.deletions names a target table ('private_employees') that does
--   NOT exist in this app (the only employee table in the codebase is
--   `owner_employees`). On every Supabase `deletions` pull the merge engine tries
--   to apply that tombstone with:
--       DELETE FROM private_employees WHERE id = <record_id>;
--   The table is missing locally, so the statement is rejected and logged.
--
--   IMPORTANT: nothing is actually deleted — the statement is skipped (it is
--   wrapped in try/catch). It is a harmless but noisy console error. POS data,
--   orders, tables and sync are unaffected.
--
--   The 60s pull-overlap window re-reads the same tombstone for a few cycles,
--   which is why the same error prints ~4 times before the cursor advances.
--
-- WHAT THIS FILE DOES
--   Removes ONLY tombstones whose `table_name` is not one of the app's real
--   tables. Legitimate tombstones (orders, menu_items, daily_submit, ...) are
--   left completely untouched.
--
-- RUN IN : Supabase SQL Editor (runs as owner → bypasses RLS; safe & idempotent).
-- NOTE   : No app code is changed by this file.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1) INSPECT — list the stray tombstones before deleting anything.
-- ----------------------------------------------------------------------------
SELECT id, table_name, record_id, created_at, updated_at
  FROM public.deletions
 WHERE table_name NOT IN (
        'users','restaurant_tables','orders','order_items','payments','expenses',
        'deliveries','daily_submit','daily_summary','menu_categories','menu_items',
        'due_payments','eja_history','off_days','weather_data','supplier_due',
        'supplier_due_history','supplier_payment_ledger','daily_submit_priority',
        'owner_employees','owner_salary_ledger','owner_expenses','owner_deposits',
        'owner_home_deposits','delete_history','activity_logs','app_config'
 )
 ORDER BY created_at DESC;


-- ----------------------------------------------------------------------------
-- 2) THE FIX — delete the stray tombstones (keeps every real table's tombstone).
-- ----------------------------------------------------------------------------
DELETE FROM public.deletions
 WHERE table_name NOT IN (
        'users','restaurant_tables','orders','order_items','payments','expenses',
        'deliveries','daily_submit','daily_summary','menu_categories','menu_items',
        'due_payments','eja_history','off_days','weather_data','supplier_due',
        'supplier_due_history','supplier_payment_ledger','daily_submit_priority',
        'owner_employees','owner_salary_ledger','owner_expenses','owner_deposits',
        'owner_home_deposits','delete_history','activity_logs','app_config'
 );


-- ----------------------------------------------------------------------------
-- 3) VERIFY — expect stray_remaining = 0.
-- ----------------------------------------------------------------------------
SELECT count(*) AS stray_remaining
  FROM public.deletions
 WHERE table_name = 'private_employees';


-- ============================================================================
-- OPTIONAL — also clear the harmless LOCAL SQLite copy on the device
-- ----------------------------------------------------------------------------
-- The local `deletions` copy is inert (it never triggers a delete and is not
-- re-pushed), so this is optional. If you want a clean slate, run this in the
-- app:  Admin → System Tools → Database Explorer → "Run SQL — Write" box:
--
--     DELETE FROM deletions WHERE table_name = 'private_employees';
--
-- (No code change is needed for either step.)
-- ============================================================================
