/*
 * Salesforce accounts, kept in the app.
 *
 * The third of the Salesforce transforms, after contacts and opportunities. It
 * was the one missing: sky_Account was being loaded but nothing moved it into
 * crm_accounts, so 5,573 active opportunities carried an account link that
 * resolved to nothing.
 *
 * Two things worth knowing about the mapping.
 *
 * Salesforce stores a Website ("http://www.example.com/about"), and this table
 * stores a domain ("example.com") -- that is what the Mongo backfill put here and
 * what the app matches on. The scheme, the www and any path are stripped so the
 * two sources agree.
 *
 * Billing address wins over shipping. For a prospect record the billing address
 * is the company's real location; shipping is often blank or a warehouse. Falling
 * back to shipping only when billing is empty fills country for accounts that
 * would otherwise have none -- which is what has been blocking the market
 * coverage percentage.
 */

create or replace function public.sync_crm_accounts_from_salesforce(
  p_since timestamptz default null
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
    insert into public.crm_accounts (
      salesforce_account_id, name, domain, industry, city, state, country
    )
    select distinct on (s."Id")
           s."Id",
           coalesce(nullif(trim(s."Name"), ''), '(no name)'),
           nullif(split_part(
                    regexp_replace(lower(trim(coalesce(s."Website", ''))),
                                   '^https?://(www\.)?', ''),
                    '/', 1), ''),
           nullif(trim(s."Industry"), ''),
           coalesce(nullif(trim(s."BillingCity"), ''),    nullif(trim(s."ShippingCity"), '')),
           coalesce(nullif(trim(s."BillingState"), ''),   nullif(trim(s."ShippingState"), '')),
           coalesce(nullif(trim(s."BillingCountry"), ''), nullif(trim(s."ShippingCountry"), ''))
    from public."sky_Account" s
    where coalesce(nullif(s."IsDeleted", '')::boolean, false) = false
      and nullif(trim(s."Id"), '') is not null
      and (p_since is null or nullif(s."LastModifiedDate", '')::timestamptz > p_since)
    order by s."Id", nullif(s."LastModifiedDate", '')::timestamptz desc nulls last
    on conflict (salesforce_account_id) do update set
      name     = excluded.name,
      domain   = coalesce(excluded.domain,   crm_accounts.domain),
      industry = coalesce(excluded.industry, crm_accounts.industry),
      city     = coalesce(excluded.city,     crm_accounts.city),
      state    = coalesce(excluded.state,    crm_accounts.state),
      country  = coalesce(excluded.country,  crm_accounts.country),
      updated_at = now()
    returning 1
  )
  select count(*) into written from upserted;

  return written;
end;
$function$;

comment on function public.sync_crm_accounts_from_salesforce(timestamptz) is
  'Turns the sky_Account mirror into crm_accounts. Pass p_since to process only rows Salesforce changed after that time. Run before sync_opportunities_from_salesforce().';

revoke all on function public.sync_crm_accounts_from_salesforce(timestamptz) from public, anon;
grant execute on function public.sync_crm_accounts_from_salesforce(timestamptz) to authenticated, service_role;
