/*
 * Point the Salesforce transforms at the bulk-loaded mirrors.
 *
 * The mirror tables are no longer built by Skyvia. Skyvia's Replication re-read
 * the whole target table once per batch to decide insert-vs-update -- 994 scans
 * returning 147.9M rows while loading only 298K, around 276 GB of egress -- so
 * the load moved to Salesforce's Bulk API with COPY, which streams one way and
 * finished the same 900K rows in eleven minutes.
 *
 * That changes two things the transforms depended on.
 *
 * Every column is now text. The loader builds each table from its CSV header, so
 * booleans arrive as 'true'/'false' strings and dates as ISO strings, and the
 * casts have to be explicit. Text is deliberate: a Salesforce field changing type
 * can no longer break the load, only the cast here, which is the place we would
 * rather find out.
 *
 * And _skyvia_sync is gone, which is an improvement. It recorded when Skyvia
 * copied a row; LastModifiedDate records when Salesforce actually changed it.
 * The second is what an incremental sync should ask about -- a re-copied but
 * unchanged row is not work to redo.
 */

drop function if exists public.sync_opportunities_from_salesforce(timestamp);
drop function if exists public.sync_crm_contacts_from_salesforce(timestamp);


create or replace function public.sync_crm_contacts_from_salesforce(
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
    where coalesce(nullif(s."IsDeleted", '')::boolean, false) = false
      and nullif(trim(s."Id"), '') is not null
      and (p_since is null or nullif(s."LastModifiedDate", '')::timestamptz > p_since)
    order by s."Id", nullif(s."LastModifiedDate", '')::timestamptz desc nulls last
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


create or replace function public.sync_opportunities_from_salesforce(
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
  with ranked as (
    select distinct on (cl.id, ct.id)
      s."Id"                                          as sf_id,
      nullif(trim(s."Name"), '')                      as name,
      coalesce(nullif(s."StageName", ''), 'Unknown')  as stage,
      nullif(s."Prospecting_Lead_Status__c", '')      as lead_status,
      cl.id                                           as client_id,
      ct.id                                           as contact_id,
      a.id                                            as account_id,
      coalesce(nullif(s."Reached_Lead__c", '')::boolean, false)                as reached_lead,
      coalesce(nullif(s."Reached_Eval_Call_Scheduled__c", '')::boolean, false) as reached_eval_call_scheduled,
      coalesce(nullif(s."Reached_Selling__c", '')::boolean, false)             as reached_selling,
      coalesce(nullif(s."Reached_Discovery__c", '')::boolean, false)           as reached_discovery,
      coalesce(nullif(s."Reached_Proposal__c", '')::boolean, false)            as reached_proposal,
      coalesce(nullif(s."Reached_Closing__c", '')::boolean, false)             as reached_closing,
      nullif(trim(s."Opportunity_Notes__c"), '')      as notes,
      nullif(trim(s."Updates__c"), '')                as updates,
      nullif(s."CreatedDate", '')::timestamptz::date  as opened_on,
      nullif(s."CloseDate", '')::date                 as close_date,
      nullif(s."Next_Action__c", '')::date            as next_action_date
    from public."sky_Opportunity" s
    join public.org_clients  cl on cl.salesforce_client_id  = s."Client__c"
    join public.crm_contacts ct on ct.salesforce_contact_id = s."Client_Contact__c"
    left join public.crm_accounts a on a.salesforce_account_id = nullif(s."AccountId", '')
    where coalesce(nullif(s."IsDeleted", '')::boolean, false) = false
      and coalesce(s."StageName", '') <> 'Prospecting: Cold Call List'
      and (p_since is null or nullif(s."LastModifiedDate", '')::timestamptz > p_since)
    order by cl.id, ct.id,
             public.opportunity_stage_rank(s."StageName") desc,
             nullif(s."LastStageChangeDate", '')::timestamptz desc nulls last,
             nullif(s."CreatedDate", '')::timestamptz desc
  ),
  upserted as (
    insert into public.opportunities (
      salesforce_opportunity_id, name, stage, lead_status,
      client_id, contact_id, account_id,
      reached_lead, reached_eval_call_scheduled, reached_selling,
      reached_discovery, reached_proposal, reached_closing,
      notes, updates, opened_on, close_date, next_action_date
    )
    select r.sf_id, r.name, r.stage, r.lead_status,
           r.client_id, r.contact_id, r.account_id,
           r.reached_lead, r.reached_eval_call_scheduled, r.reached_selling,
           r.reached_discovery, r.reached_proposal, r.reached_closing,
           r.notes, r.updates, coalesce(r.opened_on, current_date),
           r.close_date, r.next_action_date
    from ranked r
    /* The pair is already taken by a different Salesforce opportunity. Leave it
       alone rather than trip the unique constraint and lose the whole batch. */
    where not exists (
      select 1 from public.opportunities o
      where o.client_id = r.client_id
        and o.contact_id = r.contact_id
        and o.salesforce_opportunity_id is distinct from r.sf_id
    )
    on conflict (salesforce_opportunity_id) do update set
      name        = excluded.name,
      stage       = excluded.stage,
      lead_status = coalesce(excluded.lead_status, opportunities.lead_status),
      account_id  = coalesce(excluded.account_id,  opportunities.account_id),
      reached_lead                = excluded.reached_lead,
      reached_eval_call_scheduled = excluded.reached_eval_call_scheduled,
      reached_selling             = excluded.reached_selling,
      reached_discovery           = excluded.reached_discovery,
      reached_proposal            = excluded.reached_proposal,
      reached_closing             = excluded.reached_closing,
      notes            = coalesce(excluded.notes,   opportunities.notes),
      updates          = coalesce(excluded.updates, opportunities.updates),
      opened_on        = excluded.opened_on,
      close_date       = coalesce(excluded.close_date, opportunities.close_date),
      next_action_date = excluded.next_action_date,
      updated_at       = now()
    returning 1
  )
  select count(*) into written from upserted;

  return written;
end;
$function$;

comment on function public.sync_crm_contacts_from_salesforce(timestamptz) is
  'Turns the sky_Contact mirror into crm_contacts. Pass p_since to process only rows Salesforce changed after that time. Run before sync_opportunities_from_salesforce().';
comment on function public.sync_opportunities_from_salesforce(timestamptz) is
  'Turns the sky_Opportunity mirror into app opportunities, deduplicated by stage. Pass p_since to process only rows Salesforce changed after that time.';

revoke all on function public.sync_crm_contacts_from_salesforce(timestamptz) from public, anon;
revoke all on function public.sync_opportunities_from_salesforce(timestamptz) from public, anon;
grant execute on function public.sync_crm_contacts_from_salesforce(timestamptz) to authenticated, service_role;
grant execute on function public.sync_opportunities_from_salesforce(timestamptz) to authenticated, service_role;

/* The mirrors are ours now rather than Skyvia's, but the loader still recreates
   them, so seal whichever exist. */
do $$
declare t text;
begin
  foreach t in array array['sky_Contact', 'sky_Opportunity', 'sky_Account'] loop
    if to_regclass(format('public.%I', t)) is not null then
      execute format('alter table public.%I enable row level security', t);
      execute format('revoke all on public.%I from anon, authenticated', t);
    end if;
  end loop;
end
$$;
