/*
 * What a company actually makes, in their own words.
 *
 * Industry alone is a category -- "Mechanical or Industrial Engineering" covers
 * a shop bending brackets and one machining turbine blades, and deciding which
 * to call is the whole job. Keywords__c is the company's own list, comma
 * separated and usually a line or two long: "plugs, caps, hightemp masking,
 * tubing inserts, vinyl caps & grab tabs, polynet, cable ties, custom
 * molding". That reads like a shop floor rather than a taxonomy.
 *
 * It is on 90,077 of 151,248 accounts -- 60%, against Industry's 90%. The other
 * candidates were not worth the column: Industries_Served_Webscrape__c and
 * SEO_Keywords__c sit near 2.6%, and Industry_segment__c and
 * zisf__ZoomInfo_Industry__c are empty on every row in the org.
 */

alter table public.crm_accounts
  add column if not exists keywords text;

comment on column public.crm_accounts.keywords is
  'Salesforce Account.Keywords__c -- the company''s own comma-separated list of what they make or do.';

create or replace function public.sync_crm_accounts_from_salesforce(p_since timestamptz default null)
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
      salesforce_account_id, name, domain, industry, keywords, city, state, country
    )
    select distinct on (s."Id")
           s."Id",
           coalesce(nullif(trim(s."Name"), ''), '(no name)'),
           nullif(split_part(
                    regexp_replace(lower(trim(coalesce(s."Website", ''))),
                                   '^https?://(www\.)?', ''),
                    '/', 1), ''),
           nullif(trim(s."Industry"), ''),
           nullif(trim(s."Keywords__c"), ''),
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
      keywords = coalesce(excluded.keywords, crm_accounts.keywords),
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
