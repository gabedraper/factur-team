/*
 * Salesforce contacts, kept in the app.
 *
 * The companion to sync_opportunities_from_salesforce(). Skyvia replicates
 * Contact one-way into public."sky_Contact"; this turns that raw mirror into
 * crm_contacts rows.
 *
 * This exists because contacts were the thing blocking opportunities. crm_contacts
 * was seeded from Mongo, which stopped receiving Salesforce data on 3 September,
 * so every contact created or newly pursued after that was missing -- and an
 * opportunity whose contact is absent cannot load at all, contact_id being NOT NULL.
 * Measured at the time: 7,186 contacts referenced by recent opportunities, 2,437 of
 * them last modified before September, which is why no date filter alone can close
 * the gap and the mirror has to be the source.
 *
 * Salesforce is authoritative here -- these rows are not edited in the app -- but
 * blank Salesforce fields do not erase what Mongo already gave us, hence the
 * coalesce on update rather than a blind overwrite.
 */

create or replace function public.sync_crm_contacts_from_salesforce(
  p_since timestamp default null
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  written integer;
begin
  with upserted as (
    insert into public.crm_contacts (
      salesforce_contact_id, first_name, last_name, title, email, phone, account_id
    )
    select distinct on (s."Id")
           s."Id",
           nullif(trim(s."FirstName"), ''),
           nullif(trim(s."LastName"), ''),
           nullif(trim(s."Title"), ''),
           nullif(trim(s."Email"), ''),
           coalesce(nullif(trim(s."Phone"), ''), nullif(trim(s."MobilePhone"), '')),
           a.id
    from public."sky_Contact" s
    left join public.crm_accounts a
           on a.salesforce_account_id = nullif(s."AccountId", '')
    where coalesce(s."IsDeleted", false) = false
      and nullif(trim(s."Id"), '') is not null
      and (p_since is null or s."_skyvia_sync" > p_since)
    order by s."Id", s."LastModifiedDate" desc nulls last
    on conflict (salesforce_contact_id) do update set
      first_name = coalesce(excluded.first_name, crm_contacts.first_name),
      last_name  = coalesce(excluded.last_name,  crm_contacts.last_name),
      title      = coalesce(excluded.title,      crm_contacts.title),
      email      = coalesce(excluded.email,      crm_contacts.email),
      phone      = coalesce(excluded.phone,      crm_contacts.phone),
      account_id = coalesce(excluded.account_id, crm_contacts.account_id),
      updated_at = now()
    returning 1
  )
  select count(*) into written from upserted;

  return written;
end;
$function$;

comment on function public.sync_crm_contacts_from_salesforce(timestamp) is
  'Turns the sky_Contact mirror into crm_contacts. Pass p_since to process only rows Skyvia touched after that time. Run before sync_opportunities_from_salesforce().';

revoke all on function public.sync_crm_contacts_from_salesforce(timestamp) from public, anon;
grant execute on function public.sync_crm_contacts_from_salesforce(timestamp) to authenticated, service_role;

/* Skyvia creates and re-creates its mirror tables outside of migrations, and they
   arrive granted to anon with RLS off every time. Seal whichever ones exist. */
do $$
declare
  t text;
begin
  foreach t in array array['sky_Contact', 'sky_Opportunity', 'sky_Account'] loop
    if to_regclass(format('public.%I', t)) is not null then
      execute format('alter table public.%I enable row level security', t);
      execute format('revoke all on public.%I from anon, authenticated', t);
    end if;
  end loop;
end
$$;
