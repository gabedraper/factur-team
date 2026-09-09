/*
 * Salesforce opportunities, kept in the app.
 *
 * Skyvia replicates Opportunity one-way into public."sky_Opportunity" -- a raw
 * mirror, Salesforce field names and all. This turns that mirror into rows the
 * app can use: client, contact and account resolved to real ids, and the six
 * Reached_* checkboxes carried across.
 *
 * Two things this has to survive.
 *
 * Salesforce allows several opportunities against the same (client, contact)
 * pair -- up to 13 of them -- and opportunities_one_pursuit_per_client_contact
 * does not. So the mirror is deduplicated on the way in: most-advanced stage
 * wins, most recent stage change breaks the tie. The losers are left in the
 * mirror rather than deleted; the Salesforce-side cleanup is a separate job and
 * this should not pre-empt its answer.
 *
 * client_id and contact_id are NOT NULL, so the joins to org_clients and
 * crm_contacts are inner on purpose: a row whose client or contact is not here
 * yet is skipped, not forced in with a null. It will land on a later run once
 * the missing record arrives.
 *
 * opened_on is CreatedDate, the real Salesforce open date. Rows backfilled from
 * Mongo had no such field and were clamped to their close date, which made
 * pipeline duration read as zero; this corrects them as they are re-synced.
 */

create or replace function public.opportunity_stage_rank(stage text)
returns integer
language sql
immutable
as $function$
  select case stage
    when 'Closed Won'                        then 100
    when 'Closed: Closed Won'                then 100
    when 'Renewal Requested'                 then 95
    when 'Negotiation'                       then 90
    when 'Proposal'                          then 88
    when 'Quote'                             then 86
    when 'Pipeline Hot: Client RFQ Review'   then 85
    when 'Pipeline Hot: Quoting'             then 84
    when 'Pipeline Hot: Quote Follow up'     then 83
    when 'Pipeline Hot: Supplier forms / NDA' then 82
    when 'Pipeline Hot: Appointment set'     then 81
    when 'Pipeline: Hot'                     then 80
    when 'Appointment Set'                   then 79
    when 'Awaiting Customer Inputs'          then 78
    when 'Prototype Review'                  then 77
    when 'Needs Analysis'                    then 74
    when 'Qualification Call Complete'       then 72
    when 'Pipeline: Warm'                    then 70
    when 'Pipeline - Selling'                then 68
    when 'Sales Support'                     then 65
    when 'Pipeline: LT Follow Up'            then 60
    when 'Pipeline: Cold'                    then 55
    when 'Lead Generated: Scheduled'         then 52
    when 'Lead Generated'                    then 50
    when 'Linkedin Response'                 then 45
    when 'Prospecting: Referred'             then 42
    when 'Prospecting: Warm Referral'        then 41
    when 'Pipeline: Warm Referral'           then 41
    when 'Prospecting: Cold Referral'        then 35
    when 'Pipeline: Cold Referral'           then 35
    when 'Prospecting: Pipeline Cold'        then 30
    when 'Cold Outreach'                     then 25
    when 'Closed: Closed Lost'               then 20
    when 'Not the DM'                        then 18
    when 'Closed: No Quote'                  then 12
    when 'Closed'                            then 12
    when 'Closed: DQ Company'                then 10
    when 'Closed: DQ Contact'                then 10
    when 'No Fit Ever'                       then 5
    when 'No Fit Ever - Client'              then 5
    else 15
  end;
$function$;

comment on function public.opportunity_stage_rank(text) is
  'How far along a stage is. Decides which opportunity wins when one client has several against the same contact.';


create or replace function public.sync_opportunities_from_salesforce(
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
  with ranked as (
    select distinct on (cl.id, ct.id)
      s."Id"                                   as sf_id,
      nullif(trim(s."Name"), '')               as name,
      coalesce(nullif(s."StageName", ''), 'Unknown') as stage,
      nullif(s."Prospecting_Lead_Status__c", '')     as lead_status,
      cl.id                                    as client_id,
      ct.id                                    as contact_id,
      a.id                                     as account_id,
      coalesce(s."Reached_Lead__c", false)                 as reached_lead,
      coalesce(s."Reached_Eval_Call_Scheduled__c", false)  as reached_eval_call_scheduled,
      coalesce(s."Reached_Selling__c", false)              as reached_selling,
      coalesce(s."Reached_Discovery__c", false)            as reached_discovery,
      coalesce(s."Reached_Proposal__c", false)             as reached_proposal,
      coalesce(s."Reached_Closing__c", false)              as reached_closing,
      nullif(trim(s."Opportunity_Notes__c"), '') as notes,
      nullif(trim(s."Updates__c"), '')           as updates,
      s."CreatedDate"::date                      as opened_on,
      s."CloseDate"                              as close_date,
      s."Next_Action__c"                         as next_action_date
    from public."sky_Opportunity" s
    join public.org_clients  cl on cl.salesforce_client_id  = s."Client__c"
    join public.crm_contacts ct on ct.salesforce_contact_id = s."Client_Contact__c"
    left join public.crm_accounts a on a.salesforce_account_id = nullif(s."AccountId", '')
    where coalesce(s."IsDeleted", false) = false
      and coalesce(s."StageName", '') <> 'Prospecting: Cold Call List'
      and (p_since is null or s."_skyvia_sync" > p_since)
    order by cl.id, ct.id,
             public.opportunity_stage_rank(s."StageName") desc,
             s."LastStageChangeDate" desc nulls last,
             s."CreatedDate" desc
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

comment on function public.sync_opportunities_from_salesforce(timestamp) is
  'Turns the sky_Opportunity mirror into app opportunities. Pass p_since to process only rows Skyvia touched after that time.';

revoke all on function public.sync_opportunities_from_salesforce(timestamp) from public, anon;
grant execute on function public.sync_opportunities_from_salesforce(timestamp) to authenticated, service_role;

revoke all on function public.opportunity_stage_rank(text) from public, anon;
grant execute on function public.opportunity_stage_rank(text) to authenticated, service_role;

/* Skyvia's mirror table is created by Skyvia, not by a migration, and arrives
   granted to anon with RLS off every time it is recreated. Seal it here too so
   a rebuild does not quietly reopen it before seal_exposed_tables() notices. */
do $$
begin
  if to_regclass('public.sky_Opportunity') is not null then
    execute 'alter table public."sky_Opportunity" enable row level security';
    execute 'revoke all on public."sky_Opportunity" from anon, authenticated';
  end if;
end
$$;
