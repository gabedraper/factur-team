/*
 * An opportunity with no contact, or no client, is still an opportunity.
 *
 * The sync joined Salesforce's opportunity to its client and its contact and
 * dropped the row when either was missing -- and 8,151 open ones were missing
 * from the app for exactly that reason: 5,959 have no Client_Contact__c on the
 * Salesforce record and 2,192 have no Client__c. Real deals in Pipeline: Warm
 * and Lead Generated, reported as "not showing" by the people working them.
 *
 * Both columns become nullable and both joins become left joins. What follows
 * from a blank:
 *
 *   - visibility: a client-less opportunity is seen by its owner's circle and
 *     by admins, which is what opportunities_scoped already says;
 *   - the record page shows no contact panel and the list shows a dash;
 *   - duplicates: two opportunities with no contact are not duplicates of each
 *     other, so refresh_opportunity_duplicates now skips blank pairs -- a
 *     window partitioned on (client, contact) would otherwise put every
 *     contact-less opportunity of a client in one group and mark all but one
 *     as copies.
 */

alter table public.opportunities
  alter column contact_id drop not null,
  alter column client_id drop not null;

create or replace function public.sync_opportunities_from_salesforce(
  p_since timestamp with time zone default null,
  p_contact_ids text[] default null,
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
  with src as (
    select
      s."Id"                                          as sf_id,
      nullif(trim(s."Name"), '')                      as name,
      coalesce(nullif(s."StageName", ''), 'Unknown')  as stage,
      nullif(s."Prospecting_Lead_Status__c", '')      as lead_status,
      cl.id                                           as client_id,
      ct.id                                           as contact_id,
      a.id                                            as account_id,
      om.id                                           as owner_member_id,
      nullif(s."OwnerId", '')                         as salesforce_owner_id,
      nullif(s."CreatedDate", '')::timestamptz        as salesforce_created_at,
      nullif(trim(s."LeadSource"), '')                as lead_source,
      nullif(trim(s."Cadence__c"), '')                as cadence,
      nullif(trim(s."Sequence_Name__c"), '')          as sequence_name,
      nullif(trim(s."Lost_Reason__c"), '')            as lost_reason,
      nullif(trim(s."Referred_By_Name__c"), '')       as referred_by,
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
    /* Left, both of them: a missing client or contact is a blank, not a reason
       to leave the opportunity out. */
    left join public.org_clients  cl on cl.salesforce_client_id  = nullif(s."Client__c", '')
    left join public.crm_contacts ct on ct.salesforce_contact_id = nullif(s."Client_Contact__c", '')
    left join public.crm_accounts a on a.salesforce_account_id = nullif(s."AccountId", '')
    left join public.org_members om on om.salesforce_user_id = nullif(s."OwnerId", '')
    where coalesce(nullif(s."IsDeleted", '')::boolean, false) = false
      and coalesce(s."StageName", '') <> 'Prospecting: Cold Call List'
      and (
        (p_ids is not null and s."Id" = any(p_ids))
        or (p_ids is null and p_contact_ids is not null and s."Client_Contact__c" = any(p_contact_ids))
        or (p_ids is null and p_contact_ids is null
            and (p_since is null or public.sf_ts(s."LastModifiedDate") > p_since))
      )
  ),
  upserted as (
    insert into public.opportunities (
      salesforce_opportunity_id, name, stage, lead_status,
      client_id, contact_id, account_id, owner_member_id,
      salesforce_owner_id, salesforce_created_at,
      lead_source, cadence, sequence_name, lost_reason, referred_by,
      reached_lead, reached_eval_call_scheduled, reached_selling,
      reached_discovery, reached_proposal, reached_closing,
      notes, updates, opened_on, close_date, next_action_date
    )
    select r.sf_id, r.name, r.stage, r.lead_status,
           r.client_id, r.contact_id, r.account_id, r.owner_member_id,
           r.salesforce_owner_id, r.salesforce_created_at,
           r.lead_source, r.cadence, r.sequence_name, r.lost_reason, r.referred_by,
           r.reached_lead, r.reached_eval_call_scheduled, r.reached_selling,
           r.reached_discovery, r.reached_proposal, r.reached_closing,
           r.notes, r.updates, coalesce(r.opened_on, current_date),
           r.close_date, r.next_action_date
    from src r
    on conflict (salesforce_opportunity_id) do update set
      name        = excluded.name,
      stage       = excluded.stage,
      lead_status = excluded.lead_status,
      /* A client or contact that turns up later fills in; one that we hold
         is never blanked by a row whose lookup failed. */
      client_id   = coalesce(excluded.client_id,  opportunities.client_id),
      contact_id  = coalesce(excluded.contact_id, opportunities.contact_id),
      account_id  = coalesce(excluded.account_id,  opportunities.account_id),
      owner_member_id       = coalesce(excluded.owner_member_id, opportunities.owner_member_id),
      salesforce_owner_id   = coalesce(excluded.salesforce_owner_id, opportunities.salesforce_owner_id),
      salesforce_created_at = coalesce(excluded.salesforce_created_at, opportunities.salesforce_created_at),
      lead_source   = excluded.lead_source,
      cadence       = excluded.cadence,
      sequence_name = excluded.sequence_name,
      lost_reason   = excluded.lost_reason,
      referred_by   = excluded.referred_by,
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

create or replace function public.refresh_opportunity_duplicates(p_since timestamp with time zone default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  changed integer;
begin
  with touched as (
    select distinct client_id, contact_id
    from public.opportunities
    where (p_since is null or updated_at > p_since)
      and client_id is not null and contact_id is not null
  ),
  ranked as (
    select o.id,
           first_value(o.id) over (
             partition by o.client_id, o.contact_id
             order by (o.active_by_stage or o.active_by_lead_status) desc,
                      coalesce(om.active, false) desc,
                      o.updated_at desc,
                      o.created_at asc,
                      o.id
           ) as main_id,
           count(*) over (partition by o.client_id, o.contact_id) as group_size
    from public.opportunities o
    join touched t on t.client_id = o.client_id and t.contact_id = o.contact_id
    left join public.org_members om on om.id = o.owner_member_id
  ),
  want as (
    select id, case when group_size > 1 and id <> main_id then main_id end as dup_of
    from ranked
  )
  update public.opportunities o
     set duplicate_of = w.dup_of,
         is_duplicate = (w.dup_of is not null)
    from want w
   where o.id = w.id
     and o.duplicate_of is distinct from w.dup_of;
  get diagnostics changed = row_count;
  return changed;
end;
$function$;

/*
 * Bring in everything the old joins dropped, by id -- the incremental run
 * would never reach them, because their LastModifiedDate is behind the
 * watermark. Run once, after the functions above:
 *
 *   select public.sync_opportunities_from_salesforce(null, null, (
 *     select array_agg(s."Id") from public."sky_Opportunity" s
 *      where coalesce(nullif(s."IsDeleted",'')::boolean,false) = false
 *        and coalesce(s."StageName",'') <> 'Prospecting: Cold Call List'
 *        and not exists (select 1 from public.opportunities a
 *                         where a.salesforce_opportunity_id = s."Id")));
 */
