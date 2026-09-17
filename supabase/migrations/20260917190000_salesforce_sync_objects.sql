/*
 * What the Salesforce sync fetches, as data rather than code.
 *
 * Which objects, how often, how many rows a run may take, and which fields --
 * one row per object, read by /api/salesforce/sync on every run and edited
 * from Settings > Salesforce sync. Before this the list of objects was a
 * constant in the route, the fields were "every column of the mirror table",
 * and the frequency was the cron schedule; changing any of them was a deploy.
 *
 * fields = null means every column the mirror table has. A chosen list is
 * fetched as given, plus Id, LastModifiedDate and IsDeleted, which the sync
 * itself needs. A field the transforms read cannot be unticked -- see
 * mirror_required_columns(), which finds them by reading the transform
 * functions' own source rather than trusting a hand-kept list.
 *
 * Choosing a field the mirror has no column for adds the column, as text,
 * like every other mirror column (ensure_mirror_columns). Nothing is ever
 * dropped: an unticked field simply stops being refreshed.
 *
 * The cron now fires every minute; the route decides which objects are due
 * from every_minutes and the object's last run. A minute in which nothing is
 * due costs one request that returns at once.
 */

create table if not exists public.salesforce_sync_objects (
  object        text primary key,
  mirror_table  text not null,
  label         text not null,
  enabled       boolean not null default true,
  every_minutes integer not null default 3 check (every_minutes between 1 and 1440),
  max_per_run   integer not null default 20000 check (max_per_run between 100 and 50000),
  fields        text[],
  position      integer not null,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.org_members(id)
);

insert into public.salesforce_sync_objects (object, mirror_table, label, position) values
  ('Clients__c',     'sky_Client',         'Clients',           1),
  ('Account',        'sky_Account',        'Companies',         2),
  ('Contact',        'sky_Contact',        'Contacts',          3),
  ('Campaign',       'sky_Campaign',       'Campaigns',         4),
  ('CampaignMember', 'sky_CampaignMember', 'Campaign members',  5),
  ('Opportunity',    'sky_Opportunity',    'Opportunities',     6),
  ('Quote',          'sky_Quote',          'Quotes',            7),
  ('Order',          'sky_Order',          'Purchase orders',   8),
  ('Task',           'sky_Task',           'Tasks (activity)',  9),
  ('Event',          'sky_Event',          'Events (meetings)', 10)
on conflict (object) do nothing;

alter table public.salesforce_sync_objects enable row level security;
revoke all on public.salesforce_sync_objects from anon;
drop policy if exists salesforce_sync_objects_read on public.salesforce_sync_objects;
create policy salesforce_sync_objects_read on public.salesforce_sync_objects
  for select using ((select public.is_factur_user()) and (select public.has_permission('org.manage')));

/* The mirror columns any transform function reads, found in their source. */
create or replace function public.mirror_required_columns(p_table text)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  with refs as (
    select (regexp_matches(p.prosrc, '"([A-Za-z0-9_]+)"', 'g'))[1] as col
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.prosrc like '%"' || p_table || '"%'
  )
  select coalesce(array_agg(distinct c.column_name::text order by c.column_name::text), '{}')
  from refs r
  join information_schema.columns c
    on c.table_schema = 'public' and c.table_name = p_table and c.column_name = r.col;
$$;
revoke all on function public.mirror_required_columns(text) from public, anon;

/* Adds text columns a mirror table lacks. Names are checked; nothing is dropped. */
create or replace function public.ensure_mirror_columns(p_table text, p_columns text[])
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  col text;
  added text[] := '{}';
begin
  if p_table !~ '^sky_[A-Za-z0-9_]+$' then
    raise exception 'not a mirror table: %', p_table;
  end if;
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = p_table) then
    raise exception 'mirror table % does not exist', p_table;
  end if;
  foreach col in array p_columns loop
    if col !~ '^[A-Za-z][A-Za-z0-9_]{0,120}$' then
      raise exception 'not a field name: %', col;
    end if;
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = p_table and column_name = col) then
      execute format('alter table public.%I add column %I text', p_table, col);
      added := added || col;
    end if;
  end loop;
  return added;
end;
$$;
revoke all on function public.ensure_mirror_columns(text, text[]) from public, anon;

select cron.alter_job((select jobid from cron.job where jobname = 'salesforce-sync'), schedule := '* * * * *');
