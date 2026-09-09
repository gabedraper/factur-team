/*
 * Salesforce activity, attached to the opportunity it belongs to.
 *
 * Calls, emails and meetings are the record of what anyone actually did about a
 * pursuit, and opp_activities has been empty since it was created. Salesforce
 * keeps them in two objects -- Task for calls, emails and to-dos, Event for
 * meetings -- so both are unioned into the one timeline the app reads.
 *
 * Scope is deliberate: everything on an opportunity that is still open, plus
 * anything from the last two years regardless. A decade of activity on
 * long-closed deals is weight without much use, and Salesforce will not accept
 * the two conditions in one query anyway -- a semi-join cannot sit inside an OR --
 * so they arrive as two overlapping exports and are de-duplicated on the way in.
 *
 * occurred_at prefers ActivityDate over CreatedDate. ActivityDate is when the
 * work happened; CreatedDate is when somebody typed it in, which for anything
 * logged after the fact is the wrong day. CreatedDate is kept in metadata so the
 * difference stays visible, and is the fallback for the 28% of rows with no
 * ActivityDate set.
 *
 * An activity whose opportunity is not here is skipped rather than orphaned --
 * opportunity_id is NOT NULL, and those opportunities are the ones Salesforce is
 * missing a client or contact for.
 */

create or replace function public.sync_opp_activities_from_salesforce(
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
  with incoming as (
    -- Tasks: calls, emails, to-dos.
    select
      t."Id"                                        as sf_id,
      o.id                                          as opportunity_id,
      lower(coalesce(nullif(t."TaskSubtype", ''), 'task'))            as activity_type,
      nullif(trim(t."Subject"), '')                 as subject,
      nullif(trim(t."Description"), '')             as body,
      lower(nullif(t."CallType", ''))               as direction,
      coalesce(nullif(t."CallDisposition", ''), nullif(t."Status", '')) as outcome,
      coalesce(nullif(t."ActivityDate", '')::timestamptz,
               nullif(t."CreatedDate", '')::timestamptz)              as occurred_at,
      m.id                                          as created_by,
      jsonb_strip_nulls(jsonb_build_object(
        'source',            'salesforce_task',
        'salesforce_owner',  nullif(t."OwnerId", ''),
        'created_date',      nullif(t."CreatedDate", ''),
        'status',            nullif(t."Status", ''),
        'priority',          nullif(t."Priority", ''),
        'type',              nullif(t."Type", ''),
        'call_duration_secs', nullif(t."CallDurationInSeconds", ''),
        'who_id',            nullif(t."WhoId", '')
      ))                                            as metadata,
      nullif(t."LastModifiedDate", '')::timestamptz  as last_modified
    from public."sky_Task" t
    join public.opportunities o on o.salesforce_opportunity_id = t."WhatId"
    left join public.org_members m on m.salesforce_user_id = nullif(t."OwnerId", '')
    where coalesce(nullif(t."IsDeleted", '')::boolean, false) = false
      and (p_since is null or nullif(t."LastModifiedDate", '')::timestamptz > p_since)

    union all

    -- Events: meetings. StartDateTime is the meeting itself, so it wins.
    select
      e."Id",
      o.id,
      'meeting',
      nullif(trim(e."Subject"), ''),
      nullif(trim(e."Description"), ''),
      null,
      null,
      coalesce(nullif(e."StartDateTime", '')::timestamptz,
               nullif(e."ActivityDate", '')::timestamptz,
               nullif(e."CreatedDate", '')::timestamptz),
      m.id,
      jsonb_strip_nulls(jsonb_build_object(
        'source',           'salesforce_event',
        'salesforce_owner', nullif(e."OwnerId", ''),
        'created_date',     nullif(e."CreatedDate", ''),
        'end_time',         nullif(e."EndDateTime", ''),
        'duration_minutes', nullif(e."DurationInMinutes", ''),
        'subtype',          nullif(e."EventSubtype", ''),
        'type',             nullif(e."Type", '')
      )),
      nullif(e."LastModifiedDate", '')::timestamptz
    from public."sky_Event" e
    join public.opportunities o on o.salesforce_opportunity_id = e."WhatId"
    left join public.org_members m on m.salesforce_user_id = nullif(e."OwnerId", '')
    where coalesce(nullif(e."IsDeleted", '')::boolean, false) = false
      and (p_since is null or nullif(e."LastModifiedDate", '')::timestamptz > p_since)
  ),
  upserted as (
    insert into public.opp_activities (
      salesforce_activity_id, opportunity_id, activity_type,
      subject, body, direction, outcome, occurred_at, created_by, metadata
    )
    select distinct on (i.sf_id)
           i.sf_id, i.opportunity_id, i.activity_type,
           i.subject, i.body, i.direction, i.outcome,
           i.occurred_at, i.created_by, i.metadata
    from incoming i
    where i.occurred_at is not null   /* occurred_at is NOT NULL and has no sane default */
    order by i.sf_id, i.last_modified desc nulls last
    on conflict (salesforce_activity_id) where salesforce_activity_id is not null
    do update set
      activity_type = excluded.activity_type,
      subject       = excluded.subject,
      body          = coalesce(excluded.body, opp_activities.body),
      direction     = coalesce(excluded.direction, opp_activities.direction),
      outcome       = coalesce(excluded.outcome, opp_activities.outcome),
      occurred_at   = excluded.occurred_at,
      created_by    = coalesce(excluded.created_by, opp_activities.created_by),
      metadata      = excluded.metadata
    returning 1
  )
  select count(*) into written from upserted;

  return written;
end;
$function$;

comment on function public.sync_opp_activities_from_salesforce(timestamptz) is
  'Turns the sky_Task and sky_Event mirrors into opp_activities. Pass p_since to process only rows Salesforce changed after that time. Run after sync_opportunities_from_salesforce().';

revoke all on function public.sync_opp_activities_from_salesforce(timestamptz) from public, anon;
grant execute on function public.sync_opp_activities_from_salesforce(timestamptz) to authenticated, service_role;

/* The timeline is always read by opportunity, newest first. */
create index if not exists opp_activities_opportunity_occurred_idx
  on public.opp_activities (opportunity_id, occurred_at desc);

/* Mirrors are recreated by the loader, so seal whichever exist. */
do $$
declare t text;
begin
  foreach t in array array['sky_Contact','sky_Opportunity','sky_Account','sky_Task','sky_Event'] loop
    if to_regclass(format('public.%I', t)) is not null then
      execute format('alter table public.%I enable row level security', t);
      execute format('revoke all on public.%I from anon, authenticated', t);
    end if;
  end loop;
end
$$;
