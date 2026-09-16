/*
 * Opportunity Timelines read the same opportunities as the Opportunities view.
 *
 * Until now the timelines were built from Coupler's copy of a Salesforce
 * report (sf_opp_leads_raw, sf_opp_tasks_raw): hourly, current clients only,
 * and 7,909 leads this year where the app's own opportunities table holds
 * 16,815 under the same rules. The two screens disagreed because they were two
 * copies. Now there is one.
 *
 * What the opportunities table lacked for the job, added here and carried by
 * the transform from now on: the Salesforce owner id (timelines scope by rep
 * and 102,000 opportunities are owned by people no longer in the directory,
 * so the member link is not enough), the Salesforce creation time (opened_on
 * is a date, and first-touch speed is measured in hours), and the five fields
 * the board prints: source, cadence, sequence, lost reason, referred by.
 *
 * And the lead status is now the lead status. The original load filled
 * lead_status from Client_Opp_Status__c -- a different field, Carl's, meaning
 * what the client did after handoff -- and the transform's "keep the old value
 * if Salesforce's is blank" never corrected it: 668,785 rows showed a status
 * Salesforce did not have. The transform now mirrors Prospecting_Lead_Status__c
 * exactly, blank included, and the backfill below corrects every row.
 */

alter table public.opportunities
  add column if not exists salesforce_owner_id   text,
  add column if not exists salesforce_created_at timestamptz,
  add column if not exists lead_source           text,
  add column if not exists cadence               text,
  add column if not exists sequence_name         text,
  add column if not exists lost_reason           text,
  add column if not exists referred_by           text;

/* The timeline window: everything created since a date, newest first. */
create index if not exists opportunities_sf_created_idx
  on public.opportunities (salesforce_created_at desc);

create index if not exists opportunities_sf_owner_idx
  on public.opportunities (salesforce_owner_id);

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
    join public.org_clients  cl on cl.salesforce_client_id  = s."Client__c"
    join public.crm_contacts ct on ct.salesforce_contact_id = s."Client_Contact__c"
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
      /* Exactly what Salesforce holds. A blank in Salesforce is a blank here;
         "keep the old one" is how 668,785 wrong values survived a week. */
      lead_status = excluded.lead_status,
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

/*
 * The one-time correction, every row. Run in batches of 200,000 keyed on
 * salesforce_created_at being unset (Salesforce always has CreatedDate, so the
 * batch predicate empties out exactly when the job is done):
 *
 *   update public.opportunities o
 *      set salesforce_owner_id   = nullif(s."OwnerId", ''),
 *          salesforce_created_at = nullif(s."CreatedDate", '')::timestamptz,
 *          lead_source   = nullif(trim(s."LeadSource"), ''),
 *          cadence       = nullif(trim(s."Cadence__c"), ''),
 *          sequence_name = nullif(trim(s."Sequence_Name__c"), ''),
 *          lost_reason   = nullif(trim(s."Lost_Reason__c"), ''),
 *          referred_by   = nullif(trim(s."Referred_By_Name__c"), ''),
 *          lead_status   = nullif(s."Prospecting_Lead_Status__c", '')
 *     from public."sky_Opportunity" s
 *    where s."Id" = o.salesforce_opportunity_id
 *      and o.id in (select id from public.opportunities
 *                    where salesforce_created_at is null limit 200000);
 *
 * Then the history: the seed on 9 September recorded the wrong lead status as
 * the opening value. A seed row is corrected in place rather than closed and
 * reopened, because the value it holds was never true, and 668,785 "changed
 * today" rows would say something that did not happen:
 *
 *   update public.opportunity_history h
 *      set value_text = o.lead_status
 *     from public.opportunities o
 *    where o.id = h.opportunity_id and h.field = 'lead_status'
 *      and h.valid_to is null and h.source = 'seed'
 *      and h.value_text is distinct from o.lead_status;
 */
