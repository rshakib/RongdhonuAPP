-- =====================================================================
-- DESTRUCTIVE RESET — wipes EVERY user object from this Supabase project
-- =====================================================================
-- Use ONLY on the isolated AUDIT project.
--
--   * It does NOT delete the project, only the objects inside it.
--   * It leaves Supabase system schemas untouched
--     (auth, storage, realtime, extensions, vault, ...).
--   * After this, run supabase_audit_setup.sql to create the audit schema.
--
-- Run step 0 first to SEE what will be destroyed.
-- =====================================================================


-- 0) LOOK BEFORE YOU LEAP — list everything that will be dropped ---------
select table_schema, table_name
  from information_schema.tables
 where table_type = 'BASE TABLE'
   and table_schema not in (
     'pg_catalog', 'information_schema', 'pg_toast',
     'auth', 'storage', 'realtime', 'supabase_migrations', 'extensions',
     'vault', 'graphql', 'graphql_public', 'pgbouncer', 'net', 'cron'
   )
 order by 1, 2;


-- 1) DROP EVERYTHING -----------------------------------------------------
do $$
declare
  r record;
  keep text[] := array[
    'pg_catalog', 'information_schema', 'pg_toast',
    'auth', 'storage', 'realtime', 'supabase_migrations', 'extensions',
    'vault', 'graphql', 'graphql_public', 'pgbouncer', 'net', 'cron'
  ];
begin
  -- normal views
  for r in
    select table_schema as s, table_name as n
      from information_schema.views
     where table_schema <> all (keep)
  loop
    execute format('drop view if exists %I.%I cascade', r.s, r.n);
  end loop;

  -- materialized views
  for r in
    select schemaname as s, matviewname as n
      from pg_matviews
     where schemaname <> all (keep)
  loop
    execute format('drop materialized view if exists %I.%I cascade', r.s, r.n);
  end loop;

  -- tables (cascade removes dependent policies, indexes, triggers, FKs)
  for r in
    select schemaname as s, tablename as n
      from pg_tables
     where schemaname <> all (keep)
  loop
    execute format('drop table if exists %I.%I cascade', r.s, r.n);
  end loop;

  -- functions / procedures (RPCs)
  for r in
    select n2.nspname as s,
           p.proname  as n,
           pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n2 on n2.oid = p.pronamespace
     where n2.nspname <> all (keep)
  loop
    execute format('drop function if exists %I.%I(%s) cascade', r.s, r.n, r.args);
  end loop;

  -- custom types: enums, domains, composites
  for r in
    select n2.nspname as s, t.typname as n
      from pg_type t
      join pg_namespace n2 on n2.oid = t.typnamespace
     where n2.nspname <> all (keep)
       and t.typtype in ('e', 'd', 'c')
       and not exists (select 1 from pg_class c where c.reltype = t.oid)
  loop
    execute format('drop type if exists %I.%I cascade', r.s, r.n);
  end loop;

  -- leftover sequences
  for r in
    select schemaname as s, sequencename as n
      from pg_sequences
     where schemaname <> all (keep)
  loop
    execute format('drop sequence if exists %I.%I cascade', r.s, r.n);
  end loop;
end $$;


-- 2) VERIFY — this must return 0 rows ------------------------------------
select table_schema, table_name
  from information_schema.tables
 where table_schema not in (
   'pg_catalog', 'information_schema', 'pg_toast',
   'auth', 'storage', 'realtime', 'supabase_migrations', 'extensions',
   'vault', 'graphql', 'graphql_public', 'pgbouncer', 'net', 'cron'
 );


-- 3) NEXT: run supabase_audit_setup.sql in this same project -------------
