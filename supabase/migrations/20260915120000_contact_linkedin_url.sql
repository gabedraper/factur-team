/*
 * The contact's LinkedIn profile, carried through from Salesforce.
 *
 * Salesforce has held it all along -- Linkedin_URL__c is filled on 417,000 of
 * the 508,000 contacts in the mirror -- but the transform never brought it
 * across, so the app could not show it. Stored as a clean https URL with no
 * trailing slash: Salesforce has it as http:// on the older rows and https://
 * on the newer, and nobody wants two spellings of the same profile.
 *
 * Linkedin_URL_https__c is deliberately ignored. It is a formula field that
 * renders an <a> tag, and on contacts with no profile it renders an anchor
 * around a single space -- 508,000 "filled" values, 91,000 of them empty.
 */

alter table public.crm_contacts add column if not exists linkedin_url text;

/* Trim, force https, drop a trailing slash, and refuse anything that is not
   actually a LinkedIn address -- a handful of rows hold an email or a note. */
create or replace function public.clean_linkedin_url(p text)
returns text
language sql
immutable
as $$
  select case
    when p is null then null
    when btrim(p) !~* '^(https?://)?([a-z]{2,3}\.)?linkedin\.com/' then null
    else rtrim(regexp_replace(btrim(p), '^http://', 'https://', 'i'), '/')
  end;
$$;

create or replace function public.sync_crm_contacts_from_salesforce(
  p_since timestamp with time zone default null,
  p_ids text[] default null
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
      salesforce_contact_id, first_name, last_name, title, email, phone, account_id, linkedin_url
    )
    select distinct on (s."Id")
           s."Id",
           nullif(trim(s."FirstName"), ''),
           nullif(trim(s."LastName"), ''),
           nullif(trim(s."Title"), ''),
           nullif(trim(s."Email"), ''),
           coalesce(nullif(trim(s."Phone"), ''), nullif(trim(s."MobilePhone"), '')),
           a.id,
           public.clean_linkedin_url(s."Linkedin_URL__c")
    from public."sky_Contact" s
    left join public.crm_accounts a
           on a.salesforce_account_id = nullif(s."AccountId", '')
    where coalesce(nullif(s."IsDeleted", '')::boolean, false) = false
      and nullif(trim(s."Id"), '') is not null
      and (
        (p_ids is not null and s."Id" = any(p_ids))
        or (p_ids is null and (p_since is null or public.sf_ts(s."LastModifiedDate") > p_since))
      )
    order by s."Id", public.sf_ts(s."LastModifiedDate") desc nulls last
    on conflict (salesforce_contact_id) do update set
      first_name   = coalesce(excluded.first_name,   crm_contacts.first_name),
      last_name    = coalesce(excluded.last_name,    crm_contacts.last_name),
      title        = coalesce(excluded.title,        crm_contacts.title),
      email        = coalesce(excluded.email,        crm_contacts.email),
      phone        = coalesce(excluded.phone,        crm_contacts.phone),
      account_id   = coalesce(excluded.account_id,   crm_contacts.account_id),
      linkedin_url = coalesce(excluded.linkedin_url, crm_contacts.linkedin_url),
      updated_at   = now()
    returning 1
  )
  select count(*) into written from upserted;

  return written;
end;
$function$;

/* Every contact already here, in one pass. Around 417,000 rows change. */
update public.crm_contacts c
   set linkedin_url = public.clean_linkedin_url(s."Linkedin_URL__c")
  from public."sky_Contact" s
 where s."Id" = c.salesforce_contact_id
   and c.linkedin_url is null
   and public.clean_linkedin_url(s."Linkedin_URL__c") is not null;
