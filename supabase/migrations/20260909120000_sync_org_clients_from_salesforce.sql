/*
 * Clients, on the same footing as everything else.
 *
 * Clients were the last thing still arriving through Coupler: into
 * sf_clients_raw, then sync-clients-hourly at 25 past. That made them up to an
 * hour behind their own opportunities, which arrive within three minutes, and an
 * opportunity whose client is not here yet cannot be placed at all -- client_id
 * is NOT NULL. This puts them on the three-minute path with the rest.
 *
 * Inserts only, and that is not an oversight. The existing hourly sync says why:
 * "Names, statuses and cover are edited in this app on purpose, and a nightly job
 * that overwrote them from Salesforce would undo somebody's afternoon." That
 * holds here too, so a client already in org_clients is left exactly as it is.
 *
 * The consequence is worth stating plainly: renaming a client in Salesforce will
 * not rename it here. That is the intended trade, not a bug to fix later.
 *
 * New clients arrive inactive unless Salesforce says otherwise -- an account
 * nobody has set up yet should not appear on live screens before a person has
 * looked at it.
 *
 * sync-clients-hourly is deliberately left running. It does the same
 * insert-only work from a different source, so the two cannot conflict, and it
 * is a free safety net while this proves itself. Retire it once this has.
 */

create or replace function public.sync_org_clients_from_salesforce(
  p_since timestamptz default null
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  added integer;
begin
  with new_clients as (
    insert into public.org_clients (salesforce_client_id, name, status, active)
    select distinct on (s."Id")
           s."Id",
           trim(s."Name"),
           nullif(trim(s."Client_Status__c"), ''),
           coalesce(trim(s."Client_Status__c"), '') not in ('Inactive', '')
    from public."sky_Client" s
    where coalesce(nullif(s."IsDeleted", '')::boolean, false) = false
      and nullif(trim(s."Id"), '') is not null
      and nullif(trim(s."Name"), '') is not null
      and (p_since is null or public.sf_ts(s."LastModifiedDate") > p_since)
      and not exists (
        select 1 from public.org_clients c where c.salesforce_client_id = s."Id"
      )
    order by s."Id", public.sf_ts(s."LastModifiedDate") desc nulls last
    returning 1
  )
  select count(*) into added from new_clients;

  return added;
end;
$function$;

comment on function public.sync_org_clients_from_salesforce(timestamptz) is
  'Adds clients Salesforce has that the app does not. Inserts only -- names and statuses are edited in this app and are never overwritten from Salesforce.';

revoke all on function public.sync_org_clients_from_salesforce(timestamptz) from public, anon;
grant execute on function public.sync_org_clients_from_salesforce(timestamptz) to authenticated, service_role;

create index if not exists sky_client_lastmodified_idx
  on public."sky_Client" (public.sf_ts("LastModifiedDate"));

insert into public.salesforce_sync_state (object) values ('Clients__c')
on conflict (object) do nothing;


/*
 * Clients run first. An opportunity needs its client to exist, so a client that
 * arrives in the same batch as its first opportunity has to be placed before the
 * opportunity transform looks for it -- otherwise it waits a further three
 * minutes for no reason.
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
    'clients',       public.sync_org_clients_from_salesforce(p_since),
    'accounts',      public.sync_crm_accounts_from_salesforce(p_since),
    'contacts',      public.sync_crm_contacts_from_salesforce(p_since),
    'opportunities', public.sync_opportunities_from_salesforce(p_since),
    'activities',    public.sync_opp_activities_from_salesforce(p_since)
  );
  return r;
end;
$function$;

do $$
begin
  if to_regclass('public."sky_Client"') is not null then
    execute 'alter table public."sky_Client" enable row level security';
    execute 'revoke all on public."sky_Client" from anon, authenticated';
  end if;
end
$$;
