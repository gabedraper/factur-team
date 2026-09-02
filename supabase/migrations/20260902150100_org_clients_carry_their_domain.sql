/*
 * A client's domain, kept on the client.
 *
 * It lives on sf_clients_raw, which Coupler drops and recreates on every sync
 * -- so nothing may read it through a view, and every list wanting a logo
 * would otherwise have to join a table that periodically is not there.
 *
 * Copied across instead, hourly. A domain changes about as often as a company
 * is bought.
 */

alter table org_clients
  add column if not exists email_domain text;

comment on column org_clients.email_domain is
  'Copied hourly from sf_clients_raw. Used to fetch a company logo; not authoritative.';

create or replace function public.refresh_client_domains()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  touched integer;
begin
  -- Absent between Coupler's drop and recreate, so this waits for the next run
  -- rather than failing the whole maintenance pass.
  if to_regclass('public.sf_clients_raw') is null then
    return 0;
  end if;

  update org_clients c
  set email_domain = nullif(lower(trim(sf.email_domain__c)), '')
  from sf_clients_raw sf
  where sf.id = c.salesforce_client_id
    and c.email_domain is distinct from nullif(lower(trim(sf.email_domain__c)), '');

  get diagnostics touched = row_count;
  return touched;
end;
$$;

comment on function public.refresh_client_domains() is
  'Copies each client email domain from the Salesforce mirror onto org_clients, for logos.';

select public.refresh_client_domains();

select cron.unschedule('client-domains')
where exists (select 1 from cron.job where jobname = 'client-domains');

select cron.schedule(
  'client-domains',
  '45 * * * *',
  $cron$select public.refresh_client_domains();$cron$
);
