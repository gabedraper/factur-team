/*
 * Where the Salesforce sync got to, and a lock so it cannot lap itself.
 *
 * The sync runs every few minutes and asks Salesforce "what changed since I last
 * looked?". That question needs a remembered answer per object, which is the
 * watermark here. Watermarks are only advanced after the rows are safely in, so
 * a failed run re-fetches rather than skips -- re-fetching a row is free, missing
 * one is silent and permanent.
 *
 * The lock exists because of 3 September. A job on a one-minute schedule was
 * taking eight minutes, stacking on itself until the database ran out of
 * connections and the app went down. A sync on a two-minute schedule that ever
 * takes longer than two minutes would do the same thing, so it claims a lease
 * before it starts and a run that cannot claim it does nothing at all.
 *
 * The lease is a row rather than an advisory lock because the work happens over
 * HTTP in the app, across several separate database calls -- there is no single
 * session to hold a lock for its duration. A stale lease is reclaimed after
 * p_stale_after so a crashed run cannot block the sync forever.
 */

create table if not exists public.salesforce_sync_state (
  object          text primary key,
  watermark       timestamptz,
  last_run_at     timestamptz,
  last_run_rows   integer,
  last_error      text
);

comment on table public.salesforce_sync_state is
  'Per-object high-water mark for the Salesforce incremental sync. watermark is the newest LastModifiedDate already loaded.';

insert into public.salesforce_sync_state (object) values
  ('Account'), ('Contact'), ('Opportunity'), ('Task'), ('Event')
on conflict (object) do nothing;

create table if not exists public.salesforce_sync_lease (
  id          boolean primary key default true check (id),
  claimed_at  timestamptz,
  claimed_by  text,
  constraint salesforce_sync_lease_single_row check (id)
);

insert into public.salesforce_sync_lease (id) values (true) on conflict (id) do nothing;


create or replace function public.claim_salesforce_sync(
  p_by text default 'cron',
  p_stale_after interval default interval '15 minutes'
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  got boolean;
begin
  update public.salesforce_sync_lease
     set claimed_at = now(), claimed_by = p_by
   where id
     and (claimed_at is null or claimed_at < now() - p_stale_after)
  returning true into got;

  return coalesce(got, false);
end;
$function$;

comment on function public.claim_salesforce_sync(text, interval) is
  'True if this caller now holds the sync lease. False means a run is already in progress and this one should do nothing.';


create or replace function public.release_salesforce_sync()
returns void
language sql
security definer
set search_path to 'public'
as $function$
  update public.salesforce_sync_lease set claimed_at = null, claimed_by = null where id;
$function$;


/*
 * Advance a watermark, but only to a time we have actually loaded past.
 * Called after the rows are in, never before.
 */
create or replace function public.record_salesforce_sync(
  p_object text,
  p_watermark timestamptz,
  p_rows integer,
  p_error text default null
)
returns void
language sql
security definer
set search_path to 'public'
as $function$
  insert into public.salesforce_sync_state (object, watermark, last_run_at, last_run_rows, last_error)
  values (p_object, p_watermark, now(), p_rows, p_error)
  on conflict (object) do update set
    watermark     = coalesce(excluded.watermark, salesforce_sync_state.watermark),
    last_run_at   = excluded.last_run_at,
    last_run_rows = excluded.last_run_rows,
    last_error    = excluded.last_error;
$function$;


/*
 * Run every transform in dependency order. Accounts and contacts first because
 * an opportunity needs both to exist, activities last because they need the
 * opportunity. Each takes the same p_since so a quiet few minutes costs almost
 * nothing.
 */
create or replace function public.apply_salesforce_transforms(p_since timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r jsonb;
begin
  r := jsonb_build_object(
    'accounts',      public.sync_crm_accounts_from_salesforce(p_since),
    'contacts',      public.sync_crm_contacts_from_salesforce(p_since),
    'opportunities', public.sync_opportunities_from_salesforce(p_since),
    'activities',    public.sync_opp_activities_from_salesforce(p_since)
  );
  return r;
end;
$function$;

/*
 * Which fields to ask Salesforce for.
 *
 * SOQL has no SELECT *, and a hand-written field list in the app would drift
 * from the mirror the moment either changed -- the sync would fetch a column the
 * table does not have, or quietly stop refreshing one it does. The mirror's own
 * columns are the answer to both questions, so they are the list.
 */
create or replace function public.salesforce_mirror_columns(p_table text)
returns text[]
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(array_agg(column_name order by ordinal_position), '{}')
  from information_schema.columns
  where table_schema = 'public' and table_name = p_table;
$function$;

revoke all on function public.salesforce_mirror_columns(text) from public, anon;
grant execute on function public.salesforce_mirror_columns(text) to service_role;

alter table public.salesforce_sync_state enable row level security;
alter table public.salesforce_sync_lease enable row level security;
revoke all on public.salesforce_sync_state from anon, authenticated;
revoke all on public.salesforce_sync_lease from anon, authenticated;

revoke all on function public.claim_salesforce_sync(text, interval) from public, anon;
revoke all on function public.release_salesforce_sync() from public, anon;
revoke all on function public.record_salesforce_sync(text, timestamptz, integer, text) from public, anon;
revoke all on function public.apply_salesforce_transforms(timestamptz) from public, anon;
grant execute on function public.claim_salesforce_sync(text, interval) to service_role;
grant execute on function public.release_salesforce_sync() to service_role;
grant execute on function public.record_salesforce_sync(text, timestamptz, integer, text) to service_role;
grant execute on function public.apply_salesforce_transforms(timestamptz) to service_role;
