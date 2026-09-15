-- Opportunities whose contact never reached the mirror.
--
-- Salesforce holds 4.25 million contacts and the bulk load took 377 thousand
-- of them. An opportunity is only turned into a row here once its client AND
-- its contact exist on our side, so 395,782 opportunities -- 128,457 distinct
-- contacts -- have been sitting in the mirror, invisible: Matt's new deal for
-- Manda Machine among them, which is how this was found.
--
-- The sync now asks Salesforce for the missing contacts by id, newest
-- opportunity first, a couple of thousand a run. Those contacts and the
-- opportunities waiting on them carry old LastModifiedDates, so the
-- incremental transforms -- which go by that date -- would never pick them
-- up. Both transforms therefore take an explicit list of ids as well.

create or replace function public.salesforce_missing_contact_ids(p_limit integer default 2000)
returns setof text
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  -- Newest opportunity first. DISTINCT ON has to sort by the contact, so the
  -- ordering that matters is applied outside it, or the limit would take
  -- contacts in id order and the deal somebody is asking about today would
  -- wait behind a hundred thousand old ones.
  select contact_id
  from (
    select distinct on (o."Client_Contact__c")
           o."Client_Contact__c" as contact_id,
           public.sf_ts(o."LastModifiedDate") as touched
    from public."sky_Opportunity" o
    where o."Client_Contact__c" is not null
      and o."Client_Contact__c" <> ''
      and coalesce(nullif(o."IsDeleted", '')::boolean, false) = false
      and not exists (select 1 from public."sky_Contact" c where c."Id" = o."Client_Contact__c")
    order by o."Client_Contact__c", public.sf_ts(o."LastModifiedDate") desc nulls last
  ) m
  order by touched desc nulls last
  limit greatest(1, least(coalesce(p_limit, 2000), 5000));
$$;

revoke all on function public.salesforce_missing_contact_ids(integer) from public;
grant execute on function public.salesforce_missing_contact_ids(integer) to service_role;

drop function if exists public.sync_crm_contacts_from_salesforce(timestamptz);

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
      and (
        (p_ids is not null and s."Id" = any(p_ids))
        or (p_ids is null and (p_since is null or public.sf_ts(s."LastModifiedDate") > p_since))
      )
    order by s."Id", public.sf_ts(s."LastModifiedDate") desc nulls last
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
$$;

drop function if exists public.sync_opportunities_from_salesforce(timestamptz);

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
$$;

/** Contacts fetched by id, and the opportunities waiting on them, in one call. */
create or replace function public.salesforce_apply_contact_backfill(p_ids text[])
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  contacts integer;
  opps integer;
begin
  contacts := public.sync_crm_contacts_from_salesforce(null, p_ids);
  opps := public.sync_opportunities_from_salesforce(null, p_ids);
  return jsonb_build_object('contacts', contacts, 'opportunities', opps);
end;
$$;

revoke all on function public.salesforce_apply_contact_backfill(text[]) from public;
grant execute on function public.salesforce_apply_contact_backfill(text[]) to service_role;

-- Contacts fetched by the sync and waiting for the transforms. The sync runs
-- through the API, where statements are cut off at eight seconds, so it only
-- queues; the transforms job, which runs inside the database, drains the queue.
create table if not exists public.salesforce_contact_backfill (
  id text primary key,
  fetched_at timestamptz not null default now(),
  applied_at timestamptz
);
create index if not exists salesforce_contact_backfill_pending
  on public.salesforce_contact_backfill (fetched_at) where applied_at is null;
alter table public.salesforce_contact_backfill enable row level security;

create or replace function public.apply_salesforce_transforms_incremental()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_since timestamptz;
  v_started timestamptz := now();
  v_ids text[];
  r jsonb;
  b jsonb := '{}'::jsonb;
begin
  select watermark into v_since
    from public.salesforce_sync_state where object = '__transforms';

  /*
   * Overlap on purpose. A row can land in the mirror while a transform is
   * already running, and would otherwise sit unprocessed until something else
   * happened to touch it. Re-reading five minutes is cheap now that
   * LastModifiedDate is indexed, and an upsert of a row that has not changed
   * costs nothing but the write.
   *
   * With no marker at all -- first run after deploy -- an hour is enough to
   * catch up without walking the whole mirror.
   */
  v_since := coalesce(v_since, v_started - interval '1 hour') - interval '5 minutes';

  r := public.apply_salesforce_transforms(v_since);

  /*
   * Contacts the sync fetched by id, and the opportunities that were waiting
   * on them. Their LastModifiedDates are old, so the pass above never sees
   * them; they are applied by id here and marked done.
   */
  select array_agg(id) into v_ids
  from (
    select id from public.salesforce_contact_backfill
    where applied_at is null
    order by fetched_at
    limit 2000
  ) q;
  if v_ids is not null then
    b := public.salesforce_apply_contact_backfill(v_ids);
    update public.salesforce_contact_backfill
       set applied_at = now()
     where id = any(v_ids);
    r := r || jsonb_build_object('backfilled_contacts', b->'contacts', 'backfilled_opportunities', b->'opportunities');
  end if;

  insert into public.salesforce_sync_state (object, watermark, last_run_at, last_run_rows, last_error)
  values ('__transforms', v_started, v_started,
          (select sum(value::int) from jsonb_each_text(r)), null)
  on conflict (object) do update set
    watermark     = excluded.watermark,
    last_run_at   = excluded.last_run_at,
    last_run_rows = excluded.last_run_rows,
    last_error    = null;

  return r;
end;
$$;
