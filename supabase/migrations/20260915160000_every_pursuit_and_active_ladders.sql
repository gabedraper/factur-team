/*
 * Every Salesforce opportunity is a row, and each row knows whether it is
 * active on each ladder.
 *
 * Two changes, and the second is what makes the first safe to want.
 *
 * 1. The one-pursuit-per-(client, contact) rule goes.
 *
 *    opportunities_one_pursuit_per_client_contact was a modelling choice from
 *    the pipeline's first design, and the Salesforce transform honoured it by
 *    keeping the "most advanced" opportunity per pair and dropping the rest.
 *    Measured on 15 September: 111,316 open opportunities were being dropped
 *    that way, nearly all touched in the last 90 days, ten thousand of them
 *    owned by a different person than the row that won. A BDM and an account
 *    manager each pursuing the same person is normal here, and one of them
 *    could not see their own record. From now on every opportunity that has
 *    a client and a contact on our side becomes a row, and the pair index is
 *    kept only for the joins that use it.
 *
 * 2. "Active" is defined once, per ladder, in a table.
 *
 *    Salesforce's IsClosed is useless for this: 396,000 rows sit in "Closed:
 *    DQ Contact" with IsClosed = false. And a pursuit carries two ladders --
 *    Stage for the deal, Prospecting Lead Status for the prospector -- so
 *    "active" has to be asked of the ladder the reader works, which
 *    org_roles.stage_field already records.
 *
 *    opportunity_closed_values lists the values that mean "done" on each
 *    ladder. A row is active on a ladder when it holds a value there that is
 *    not one of those. Listing the closed values rather than the open ones is
 *    deliberate: a value Salesforce adds tomorrow shows up as active and gets
 *    looked at, instead of vanishing until somebody notices the list is stale.
 *    A blank lead status is not active -- the row is simply not on that
 *    ladder.
 *
 *    The two flags are kept as columns, set by a trigger, so a list can filter
 *    on them through an index rather than re-deriving them per row per query.
 *    Changing the closed list is an operating decision, so it lives in a table
 *    with a refresh function, not in a migration.
 */

-- 1. Every pursuit gets a row -------------------------------------------------

alter table public.opportunities
  drop constraint if exists opportunities_one_pursuit_per_client_contact;

create index if not exists opportunities_client_contact_idx
  on public.opportunities (client_id, contact_id);


-- 2. What "done" means on each ladder -----------------------------------------

create table if not exists public.opportunity_closed_values (
  field text not null check (field in ('stage', 'lead_status')),
  value text not null,
  primary key (field, value)
);

comment on table public.opportunity_closed_values is
  'Stage and lead status values that mean a pursuit is finished on that ladder. Anything else, including values Salesforce adds later, counts as active. Run refresh_opportunity_active_flags() after changing it.';

alter table public.opportunity_closed_values enable row level security;

drop policy if exists opportunity_closed_values_read on public.opportunity_closed_values;
create policy opportunity_closed_values_read on public.opportunity_closed_values
  for select to authenticated
  using ((select public.is_factur_user()));

drop policy if exists opportunity_closed_values_manage on public.opportunity_closed_values;
create policy opportunity_closed_values_manage on public.opportunity_closed_values
  for all to authenticated
  using ((select public.is_factur_user()) and (select public.has_permission('org.manage')))
  with check ((select public.is_factur_user()) and (select public.has_permission('org.manage')));

insert into public.opportunity_closed_values (field, value) values
  -- The deal ladder. Won is finished too: it leaves the working pipeline.
  ('stage', 'Closed: Closed Won'),
  ('stage', 'Closed: Closed Lost'),
  ('stage', 'Closed: DQ Contact'),
  ('stage', 'Closed: DQ Company'),
  ('stage', 'Closed: No Quote'),
  ('stage', 'Closed'),
  ('stage', 'No Fit Ever'),
  ('stage', 'No Fit Ever - Client'),
  ('stage', 'Not the DM'),
  -- A list to call from, not a pursuit. The sync never brings these in.
  ('stage', 'Prospecting: Cold Call List'),
  -- The prospecting ladder. Customer and Purchase Order are the prospector's
  -- closed-won; Lead Handoff means the lead went to the client, which is where
  -- the prospector's ladder stops mattering -- 660,000 rows carry it from the
  -- old pipeline. LTFU (long-term follow up) is still being worked and stays
  -- active.
  ('lead_status', 'No Fit Ever'),
  ('lead_status', 'No Fit Ever - Contact'),
  ('lead_status', 'No Fit Ever - Account'),
  ('lead_status', 'Lost Follow Up'),
  ('lead_status', 'Lead Handoff'),
  ('lead_status', 'Purchase Order'),
  ('lead_status', 'Customer')
on conflict do nothing;


-- 3. The flags ----------------------------------------------------------------

alter table public.opportunities
  add column if not exists active_by_stage boolean not null default false,
  add column if not exists active_by_lead_status boolean not null default false;

comment on column public.opportunities.active_by_stage is
  'Stage is set and not in opportunity_closed_values. Maintained by trigger.';
comment on column public.opportunities.active_by_lead_status is
  'Lead status is set and not in opportunity_closed_values. Blank means not on that ladder. Maintained by trigger.';

create or replace function public.opportunity_is_active(p_field text, p_value text)
returns boolean
language sql
stable
set search_path to 'public'
as $$
  select p_value is not null
     and p_value <> ''
     and not exists (
       select 1 from public.opportunity_closed_values v
       where v.field = p_field and v.value = p_value
     );
$$;

create or replace function public.opportunities_set_active_flags()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  new.active_by_stage       := public.opportunity_is_active('stage', new.stage);
  new.active_by_lead_status := public.opportunity_is_active('lead_status', new.lead_status);
  return new;
end;
$$;

drop trigger if exists opportunities_active_flags on public.opportunities;
create trigger opportunities_active_flags
  before insert or update of stage, lead_status on public.opportunities
  for each row execute function public.opportunities_set_active_flags();

/*
 * Brings every row's flags in line with the closed list. In slices, so the
 * table is never held for long: a full pass is 780,000 rows. Returns how
 * many it corrected; call until it returns 0.
 */
create or replace function public.refresh_opportunity_active_flags(p_batch integer default 50000)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n integer;
begin
  with todo as (
    select o.id,
           public.opportunity_is_active('stage', o.stage)             as s,
           public.opportunity_is_active('lead_status', o.lead_status) as l
    from public.opportunities o
    where o.active_by_stage       is distinct from public.opportunity_is_active('stage', o.stage)
       or o.active_by_lead_status is distinct from public.opportunity_is_active('lead_status', o.lead_status)
    limit p_batch
  )
  update public.opportunities o
     set active_by_stage = todo.s, active_by_lead_status = todo.l
    from todo
   where o.id = todo.id;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.refresh_opportunity_active_flags(integer) from public, anon;
grant execute on function public.refresh_opportunity_active_flags(integer) to service_role;

revoke all on function public.opportunity_is_active(text, text) from public, anon;
grant execute on function public.opportunity_is_active(text, text) to authenticated, service_role;


-- 4. The transform, without the dedup -----------------------------------------

/* The two-argument form has to go first: keeping it beside a three-argument
   form with a default would make sync_opportunities_from_salesforce(null, ids)
   ambiguous. */
drop function if exists public.sync_opportunities_from_salesforce(timestamptz, text[]);

create or replace function public.sync_opportunities_from_salesforce(
  p_since timestamptz default null,
  p_contact_ids text[] default null,
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
  /*
   * One row per Salesforce opportunity. No distinct on, no "pair already
   * taken": that was the one-pursuit rule, and it is gone. The joins to
   * org_clients and crm_contacts stay inner on purpose -- client_id and
   * contact_id are NOT NULL -- so a row whose parent has not arrived yet is
   * skipped and picked up by the nightly catch-up once it has.
   */
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
      reached_lead, reached_eval_call_scheduled, reached_selling,
      reached_discovery, reached_proposal, reached_closing,
      notes, updates, opened_on, close_date, next_action_date
    )
    select r.sf_id, r.name, r.stage, r.lead_status,
           r.client_id, r.contact_id, r.account_id, r.owner_member_id,
           r.reached_lead, r.reached_eval_call_scheduled, r.reached_selling,
           r.reached_discovery, r.reached_proposal, r.reached_closing,
           r.notes, r.updates, coalesce(r.opened_on, current_date),
           r.close_date, r.next_action_date
    from src r
    on conflict (salesforce_opportunity_id) do update set
      name        = excluded.name,
      stage       = excluded.stage,
      lead_status = coalesce(excluded.lead_status, opportunities.lead_status),
      account_id  = coalesce(excluded.account_id,  opportunities.account_id),
      owner_member_id = coalesce(excluded.owner_member_id, opportunities.owner_member_id),
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
$$;

comment on function public.sync_opportunities_from_salesforce(timestamptz, text[], text[]) is
  'Turns the sky_Opportunity mirror into app opportunities, one row per Salesforce record. p_since limits to rows Salesforce changed after that time; p_contact_ids to rows for those contacts; p_ids to those opportunity ids.';

revoke all on function public.sync_opportunities_from_salesforce(timestamptz, text[], text[]) from public, anon;
grant execute on function public.sync_opportunities_from_salesforce(timestamptz, text[], text[]) to service_role;

/*
 * The rows the old rule dropped. Once, in slices: finds mirror rows that have
 * a client and a contact here but no row of their own, and runs them through
 * the transform by id. Returns how many it wrote; call until it returns 0.
 */
create or replace function public.backfill_dropped_opportunities(p_batch integer default 10000)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ids text[];
begin
  select array_agg(s."Id") into v_ids
  from (
    select s."Id"
    from public."sky_Opportunity" s
    join public.org_clients  cl on cl.salesforce_client_id  = s."Client__c"
    join public.crm_contacts ct on ct.salesforce_contact_id = s."Client_Contact__c"
    left join public.opportunities o on o.salesforce_opportunity_id = s."Id"
    where o.id is null
      and coalesce(nullif(s."IsDeleted", '')::boolean, false) = false
      and coalesce(s."StageName", '') <> 'Prospecting: Cold Call List'
    limit p_batch
  ) s;
  if v_ids is null then return 0; end if;
  return public.sync_opportunities_from_salesforce(null, null, v_ids);
end;
$$;

revoke all on function public.backfill_dropped_opportunities(integer) from public, anon;
grant execute on function public.backfill_dropped_opportunities(integer) to service_role;
