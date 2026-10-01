-- =====================================================================
-- Rongdhonu POS — ISOLATED AUDIT / ACTIVITY PROJECT
--
-- Run this ONCE in the SQL Editor of the NEW, dedicated Supabase project.
-- This project stores ONLY activity events and has NO relation to the
-- running POS databases (no foreign keys, no shared tables, no shared
-- client, no triggers on the live DBs).
--
-- After running: change the read secret (step 2 note) and keep it only in
-- the ADMIN build (EXPO_PUBLIC_AUDIT_READ_SECRET).
-- =====================================================================

-- 1) The activity stream ------------------------------------------------
create table if not exists public.activity_events (
  id              bigint generated always as identity primary key,
  created_at      timestamptz not null default now(),
  event_at        timestamptz,          -- device-side time of the action
  event_id        text,                 -- local outbox id (idempotency key)
  business_date   date,
  app_profile     text,                 -- ADMIN / OWNER / MANAGER (which app)
  app_version     text,
  user_name       text,
  user_role       text,
  device_id       text,
  device_name     text,
  device_model    text,
  device_platform text,
  table_name      text,                 -- which local table was touched
  action          text,                 -- INSERT / UPDATE / DELETE
  record_id       text,
  changes         jsonb,                -- { field: { from, to } } only changed fields
  snapshot        jsonb                 -- the row after the write (truncated)
);

create unique index if not exists activity_events_event_id_key on public.activity_events (event_id);
create index if not exists activity_events_created_at_idx on public.activity_events (created_at desc);
create index if not exists activity_events_event_at_idx   on public.activity_events (event_at desc);
create index if not exists activity_events_table_idx      on public.activity_events (table_name);
create index if not exists activity_events_user_idx       on public.activity_events (user_name);
create index if not exists activity_events_device_idx     on public.activity_events (device_id);
create index if not exists activity_events_profile_idx    on public.activity_events (app_profile);

-- 2) Read secret (admin-only gate) --------------------------------------
create table if not exists public.audit_config (
  key   text primary key,
  value text not null
);

insert into public.audit_config (key, value)
values ('read_secret', 'CHANGE_ME_TO_A_LONG_RANDOM_STRING')
on conflict (key) do nothing;

alter table public.audit_config enable row level security;
-- Deliberately NO policies: the anon key can neither read nor write this table.

-- IMPORTANT after setup:
--   update public.audit_config set value='<YOUR_STRONG_SECRET>' where key='read_secret';

-- 3) RLS on the stream: anon may INSERT, and NOTHING else -----------------
alter table public.activity_events enable row level security;

drop policy if exists activity_events_insert_anon on public.activity_events;
create policy activity_events_insert_anon
  on public.activity_events
  for insert
  to anon, authenticated
  with check (true);

-- NOTE: intentionally NO select / update / delete policy for anon, so a
-- plain REST select with the anon key returns no rows. History is served
-- only through the secret-gated audit_read() RPC below.

-- Explicit table privileges (Supabase grants these by default, but state them
-- so INSERT can never fail for a missing grant).
grant usage on schema public to anon, authenticated;
grant insert on public.activity_events to anon, authenticated;

-- 4) Secret-gated read RPC ----------------------------------------------
create or replace function public.audit_read(
  p_secret text,
  p_limit  int default 100,
  p_before timestamptz default null
)
returns setof public.activity_events
language plpgsql
security definer
set search_path = public
as $$
declare
  s text;
begin
  select value into s from public.audit_config where key = 'read_secret';
  if s is null or p_secret is null or p_secret <> s then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  if p_before is null then
    return query
      select *
        from public.activity_events
       order by coalesce(event_at, created_at) desc
       limit greatest(1, least(coalesce(p_limit, 100), 500));
  else
    return query
      select *
        from public.activity_events
       where coalesce(event_at, created_at) < p_before
       order by coalesce(event_at, created_at) desc
       limit greatest(1, least(coalesce(p_limit, 100), 500));
  end if;
end;
$$;

revoke all on function public.audit_read(text, int, timestamptz) from public;
grant execute on function public.audit_read(text, int, timestamptz) to anon;

-- 5) Realtime publication ------------------------------------------------
do $$
begin
  begin
    alter publication supabase_realtime add table public.activity_events;
  exception when duplicate_object then null;
  end;
end $$;

-- 6) Realtime BROADCAST on insert (works without any SELECT policy) -------
--    The admin app subscribes to topic 'rongdhonu_audit_live', event 'activity'.
--    Wrapped in an exception block so the helper being unavailable can never
--    break an insert.
create or replace function public.audit_broadcast_fn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform realtime.send(to_jsonb(new), 'activity', 'rongdhonu_audit_live', false);
  exception when others then
    null;
  end;
  return new;
end;
$$;

drop trigger if exists trg_audit_broadcast on public.activity_events;
create trigger trg_audit_broadcast
  after insert on public.activity_events
  for each row execute function public.audit_broadcast_fn();

-- 7) (Optional) retention — keep only the last 90 days -------------------
-- create extension if not exists pg_cron;
-- select cron.schedule('audit-retention', '0 3 * * *',
--   $$delete from public.activity_events where created_at < now() - interval '90 days'$$);

-- 8) VERIFY --------------------------------------------------------------
-- select count(*) from public.activity_events;                              -- 0 right after setup
-- select * from public.audit_read('<YOUR_STRONG_SECRET>', 5);               -- must return rows
-- select * from public.audit_read('wrong-secret', 5);                       -- must raise 'unauthorized'
