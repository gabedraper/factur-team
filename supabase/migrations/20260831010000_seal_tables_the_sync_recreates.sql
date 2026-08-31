/*
 * Closing a hole that reopens itself.
 *
 * Coupler syncs QuickBooks and Salesforce by dropping each table and creating
 * it again. A new table has row level security off and carries Postgres's
 * default grants, so every sync silently handed anon -- the key that ships
 * inside the website and which anybody who loads the page can read out of it --
 * select, insert, update, delete and truncate over every one of them.
 *
 * On 31 August that was 467,000 rows: 14,873 invoices, 14,517 payments, 90,553
 * prospect lead records, and the whole Salesforce pipeline. Readable by anyone
 * on the internet and deletable by them too. It had been closed twice before
 * and both times a sync opened it again within days, which is the part that
 * matters -- fixing it by hand is not fixing it.
 *
 * So it is checked on a schedule instead. The rule is deliberately general
 * rather than a list of table names: any table in public that anon can reach
 * and that has row level security switched off gets sealed. That catches the
 * next table Coupler adds without anybody remembering to add it here, and it
 * cannot touch the genuinely public tables behind the careers page, the client
 * portal and the survey links -- those have row level security on with policies
 * that let a token through, so they never match.
 */

create table if not exists public.security_seal_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  sealed text[] not null,
  -- Kept even when nothing needed doing, so the gaps are visible. A run that
  -- seals something a week after the last one tells you a sync reopened it.
  note text
);

alter table public.security_seal_log enable row level security;

drop policy if exists security_seal_log_read on public.security_seal_log;
create policy security_seal_log_read on public.security_seal_log
  for select to authenticated
  using (public.is_factur_user() and public.has_permission('org.manage'));

/*
 * Revoke first, then enable.
 *
 * Row level security decides which rows a statement may touch; it does not
 * decide whether the statement may run at all, and truncate consults no policy.
 * Enabling row level security on its own would leave anon able to empty a table
 * it could no longer read.
 */
create or replace function public.seal_exposed_tables()
returns text[]
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  t record;
  done text[] := '{}';
begin
  for t in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     where c.relkind = 'r'
       and not c.relrowsecurity
       and exists (
         select 1 from information_schema.role_table_grants g
          where g.table_schema = 'public'
            and g.table_name = c.relname
            and g.grantee = 'anon')
  loop
    execute format('revoke all on table public.%I from anon', t.relname);
    execute format('alter table public.%I enable row level security', t.relname);
    done := done || t.relname;
  end loop;

  if array_length(done, 1) > 0 then
    insert into public.security_seal_log (sealed, note)
    values (done, 'anon could reach these with row level security off');
  end if;

  return done;
end;
$$;

revoke all on function public.seal_exposed_tables() from public, anon, authenticated;

-- Every ten minutes. A sync takes a few minutes to run, so this closes the
-- window to about the length of one coffee rather than the days it has been.
select cron.schedule(
  'seal-exposed-tables',
  '*/10 * * * *',
  $$select public.seal_exposed_tables()$$
);

-- And once now, so the schedule is not the first thing that runs.
select public.seal_exposed_tables();
