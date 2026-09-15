-- You can see what you own.
--
-- Who may see an opportunity was decided entirely by who is named on its
-- client in Settings. Six active clients have nobody named -- Factur's own
-- prospecting pipeline among them, 16,700 open opportunities -- so the people
-- working those deals could not see them, while Salesforce knew exactly whose
-- they were. The owner now comes across with the opportunity, and the rule
-- becomes: your clients' opportunities, or ones you or your reports own.

alter table public.opportunities
  add column if not exists owner_member_id uuid references public.org_members(id);

create index if not exists opportunities_owner_member_idx
  on public.opportunities (owner_member_id);

/**
 * Me and everyone who reports to me, however far down. The same circle
 * my_client_ids() draws, kept in step with it, including the preview seat.
 */
create or replace function public.my_member_circle(p_as_member uuid default null)
returns table (member_id uuid)
language sql
stable
security definer
set search_path to 'public'
as $$
  with recursive gate as (
    select p_as_member is not null
       and public.can_preview_as(p_as_member) as allowed
  ),
  me as (
    select m.id
    from public.org_members m, gate
    where m.active
      and (case when gate.allowed
                then m.id = p_as_member
                else m.auth_user_id = auth.uid() end)
  ),
  circle as (
    select id, array[id] as path from me
    union
    select m.id, c.path || m.id
    from public.org_members m
    join circle c on m.manager_member_id = c.id
    where m.active and not (m.id = any(c.path))
  )
  select id from circle;
$$;

grant execute on function public.my_member_circle(uuid) to authenticated, service_role;

drop policy if exists opportunities_scoped on public.opportunities;
create policy opportunities_scoped on public.opportunities
  for all
  using (
    (select public.is_factur_user())
    and (
      (select public.has_permission('org.manage'))
      or client_id in (select client_id from public.my_client_ids())
      or owner_member_id in (select member_id from public.my_member_circle())
    )
  );

-- The transform carries the owner across from Salesforce from now on.
create or replace function public.sync_opportunities_from_salesforce(
  p_since timestamptz default null,
  p_contact_ids text[] default null
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
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
        (p_contact_ids is not null and s."Client_Contact__c" = any(p_contact_ids))
        or (p_contact_ids is null and (p_since is null or public.sf_ts(s."LastModifiedDate") > p_since))
      )
    order by cl.id, ct.id,
             public.opportunity_stage_rank(s."StageName") desc,
             nullif(s."LastStageChangeDate", '')::timestamptz desc nulls last,
             nullif(s."CreatedDate", '')::timestamptz desc
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
    from ranked r
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

-- Owners for everything already here. Once, in slices, so no single statement
-- holds the table for long.
create or replace function public.backfill_opportunity_owners(p_batch integer default 50000)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n integer;
begin
  with todo as (
    select o.id, om.id as owner
    from public.opportunities o
    join public."sky_Opportunity" s on s."Id" = o.salesforce_opportunity_id
    join public.org_members om on om.salesforce_user_id = nullif(s."OwnerId", '')
    where o.owner_member_id is null
    limit p_batch
  )
  update public.opportunities o
     set owner_member_id = todo.owner
    from todo
   where o.id = todo.id;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.backfill_opportunity_owners(integer) from public;
grant execute on function public.backfill_opportunity_owners(integer) to service_role;
