-- Every number Salesforce holds for a contact, not just one of them.
--
-- The transform squashed a contact's phones into a single column -- main
-- phone, or mobile if there was no main -- and threw the rest away. A BDM
-- ringing a prospect wants the direct line, the mobile and the switchboard
-- side by side, which the mirror has had all along: on 512k contacts, 400k
-- carry a main phone, 107k a mobile, 93k a direct line, 250k a company line.
--
-- `phone` stays as it was, so nothing reading it changes. The three new
-- columns sit beside it and the transform fills all four from now on; the
-- backfill below fills them for everything already here.

alter table public.crm_contacts
  add column if not exists mobile_phone text,
  add column if not exists direct_phone text,
  add column if not exists company_phone text;

create or replace function public.sync_crm_contacts_from_salesforce(
  p_since timestamptz default null,
  p_ids text[] default null
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  written integer;
begin
  with upserted as (
    insert into public.crm_contacts (
      salesforce_contact_id, first_name, last_name, title, email, phone,
      mobile_phone, direct_phone, company_phone, account_id, linkedin_url
    )
    select distinct on (s."Id")
           s."Id",
           nullif(trim(s."FirstName"), ''),
           nullif(trim(s."LastName"), ''),
           nullif(trim(s."Title"), ''),
           nullif(trim(s."Email"), ''),
           coalesce(nullif(trim(s."Phone"), ''), nullif(trim(s."MobilePhone"), '')),
           nullif(trim(s."MobilePhone"), ''),
           -- Salesforce's own direct-line field first, then the enrichment
           -- vendors' in the order they have proved reliable.
           coalesce(
             nullif(trim(s."Contact_Direct_Phone__c"), ''),
             nullif(trim(s."Zoominfo_Direct_phone_number__c"), ''),
             nullif(trim(s."Clay_Direct_Phone_number__c"), '')
           ),
           coalesce(
             nullif(trim(s."Company_Main_Phone__c"), ''),
             nullif(trim(s."Zoominfo_Office_phone_number__c"), '')
           ),
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
      first_name    = coalesce(excluded.first_name,    crm_contacts.first_name),
      last_name     = coalesce(excluded.last_name,     crm_contacts.last_name),
      title         = coalesce(excluded.title,         crm_contacts.title),
      email         = coalesce(excluded.email,         crm_contacts.email),
      phone         = coalesce(excluded.phone,         crm_contacts.phone),
      mobile_phone  = coalesce(excluded.mobile_phone,  crm_contacts.mobile_phone),
      direct_phone  = coalesce(excluded.direct_phone,  crm_contacts.direct_phone),
      company_phone = coalesce(excluded.company_phone, crm_contacts.company_phone),
      account_id    = coalesce(excluded.account_id,    crm_contacts.account_id),
      linkedin_url  = coalesce(excluded.linkedin_url,  crm_contacts.linkedin_url),
      updated_at    = now()
    returning 1
  )
  select count(*) into written from upserted;

  return written;
end;
$$;

-- Numbers for the contacts already here. In slices, by contact id, so no one
-- statement holds the table for long; run until it returns 0.
create or replace function public.backfill_contact_phones(p_batch integer default 50000)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n integer;
begin
  with todo as (
    select c.id,
           nullif(trim(s."MobilePhone"), '') as mobile_phone,
           coalesce(
             nullif(trim(s."Contact_Direct_Phone__c"), ''),
             nullif(trim(s."Zoominfo_Direct_phone_number__c"), ''),
             nullif(trim(s."Clay_Direct_Phone_number__c"), '')
           ) as direct_phone,
           coalesce(
             nullif(trim(s."Company_Main_Phone__c"), ''),
             nullif(trim(s."Zoominfo_Office_phone_number__c"), '')
           ) as company_phone
    from public.crm_contacts c
    join public."sky_Contact" s on s."Id" = c.salesforce_contact_id
    where c.mobile_phone is null and c.direct_phone is null and c.company_phone is null
      -- Only contacts that have something to gain, so the loop ends: a contact
      -- with none of these numbers in Salesforce is not picked up again.
      and (
        nullif(trim(s."MobilePhone"), '') is not null
        or nullif(trim(s."Contact_Direct_Phone__c"), '') is not null
        or nullif(trim(s."Zoominfo_Direct_phone_number__c"), '') is not null
        or nullif(trim(s."Clay_Direct_Phone_number__c"), '') is not null
        or nullif(trim(s."Company_Main_Phone__c"), '') is not null
        or nullif(trim(s."Zoominfo_Office_phone_number__c"), '') is not null
      )
    limit p_batch
  )
  update public.crm_contacts c
     set mobile_phone  = todo.mobile_phone,
         direct_phone  = todo.direct_phone,
         company_phone = todo.company_phone
    from todo
   where c.id = todo.id;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.backfill_contact_phones(integer) from public;
grant execute on function public.backfill_contact_phones(integer) to service_role;
