/*
 * Every Salesforce client, kept in the app.
 *
 * org_clients was seeded from Salesforce once and then left to drift: 985 of
 * the 987 were here, and the two that were not had been created since the seed.
 * Two is not a crisis, but the drift is one-way and only grows, and a client
 * missing from this table cannot be matched to the money it owes.
 *
 * Inserts only. Names, statuses and cover are edited in this app on purpose,
 * and a nightly job that overwrote them from Salesforce would undo somebody's
 * afternoon. New clients arrive inactive unless Salesforce says otherwise -- an
 * account nobody has set up here yet should not appear on live screens until a
 * person has looked at it.
 */
create or replace function public.sync_clients_from_salesforce()
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
    select sf.id, sf.name, sf.client_status__c,
           coalesce(sf.client_status__c, '') not in ('Inactive', '')
    from public.sf_clients_raw sf
    where sf.id is not null
      and nullif(trim(sf.name), '') is not null
      and not exists (
        select 1 from public.org_clients c where c.salesforce_client_id = sf.id
      )
    returning 1
  )
  select count(*) into added from new_clients;

  return added;
end;
$function$;

revoke all on function public.sync_clients_from_salesforce() from public, anon;
grant execute on function public.sync_clients_from_salesforce() to authenticated, service_role;

/* Runs with the rest of the nightly tidying, so the drift cannot restart. */
create or replace function public.nightly_maintenance()
returns void
language plpgsql
as $function$
BEGIN
  PERFORM public.ensure_staging_rls();
  PERFORM public.refresh_raw_activities();
  PERFORM public.refresh_deal_activities();
  PERFORM public.deactivate_departed_reps();
  PERFORM public.sync_managers();
  PERFORM public.sync_clients_from_salesforce();
END;
$function$;

select public.sync_clients_from_salesforce();
