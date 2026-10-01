-- =====================================================================
-- FIX: "new row violates row-level security policy for table activity_events"
-- =====================================================================
-- Symptom: the app logs
--   WARN [AuditLog] audit upload failed (N event(s) kept locally):
--        new row violates row-level security policy for table "activity_events"
--
-- Meaning: the table exists and RLS is ON, but there is no INSERT policy that
-- matches the role the app uses (anon). Usually because the table was created
-- another way (dashboard / partial run) without the setup policy.
--
-- Run this in the AUDIT project's SQL Editor. It is idempotent.
-- =====================================================================


-- 1) DIAGNOSE — what does the table look like right now? -----------------
select relrowsecurity as rls_enabled
  from pg_class
 where oid = 'public.activity_events'::regclass;

select policyname, roles, cmd, qual, with_check
  from pg_policies
 where schemaname = 'public' and tablename = 'activity_events';


-- 2) FIX — RLS on + permissive INSERT policy for anon, nothing else -------
alter table public.activity_events enable row level security;

drop policy if exists activity_events_insert_anon on public.activity_events;
create policy activity_events_insert_anon
  on public.activity_events
  for insert
  to anon, authenticated
  with check (true);

-- Explicit privileges (belt and braces).
grant usage on schema public to anon, authenticated;
grant insert on public.activity_events to anon, authenticated;

-- Deliberately NO select/update/delete policy: the anon key can only append.
-- History is read through the secret-gated audit_read() RPC.


-- 3) VERIFY ---------------------------------------------------------------
select policyname, roles, cmd, with_check
  from pg_policies
 where schemaname = 'public' and tablename = 'activity_events';
-- Expect exactly one row: activity_events_insert_anon | {anon,authenticated} | INSERT | true

-- Optional: a plain REST insert check with the anon key (run from your shell)
--   curl -X POST "https://zdruassdewwjbexximkj.supabase.co/rest/v1/activity_events" \
--     -H "apikey: <AUDIT_ANON_KEY>" -H "Authorization: Bearer <AUDIT_ANON_KEY>" \
--     -H "Content-Type: application/json" \
--     -d '{"event_id":"manual_test_1","table_name":"menu_items","action":"INSERT"}'
-- A 201 (empty body) means inserts work.
