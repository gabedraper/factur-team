/*
 * Per-client counts of the two progress fields, for the Target Contacts screen.
 *
 * Target Companies counts companies per rolled-up band, which is right there:
 * you are choosing a company, and the band is the furthest any of its people
 * has reached. On Target Contacts both halves of that are wrong. The rows are
 * people, so the count should be people; and the band hides the very
 * distinction the screen exists to show -- "Long-Term Follow Up 1,287" says
 * nothing about whether those are LTFU or Lost Follow Up, and Closed lumps
 * Closed Won in with DQ Contact.
 *
 * So this counts pursuits by the raw Salesforce value, for both fields, and the
 * screen shows whichever the viewer's role reads (org_roles.stage_field).
 *
 * Both fields are counted rather than just the one, because a viewer holding a
 * prospecting role and a delivery one reads both, and because which they read
 * is a setting somebody can change at any moment -- recomputing on that change
 * would be a job nobody remembers to write.
 *
 * Long tail on purpose: 32 stage values and 25 lead statuses exist, and only a
 * handful are common. Storing them all costs nothing (a few thousand rows) and
 * the screen renders only the values its own clients actually use.
 */

create table if not exists public.pipeline_client_field_counts (
  client_id    uuid not null references public.org_clients(id) on delete cascade,
  field        text not null check (field in ('stage', 'lead_status')),
  value        text not null,
  pursuits     bigint not null,
  refreshed_at timestamptz not null default now(),
  primary key (client_id, field, value)
);

alter table public.pipeline_client_field_counts enable row level security;
revoke all on table public.pipeline_client_field_counts from public, anon, authenticated;


/*
 * Filled by the same job as the company counts, in the same pass over the same
 * filtered set of opportunities, because scanning that twice on a schedule to
 * answer two questions about it would be silly.
 */
create or replace function public.refresh_pipeline_client_stage_counts()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n integer;
  m integer;
begin
  create temp table _live on commit drop as
  select o.client_id, o.account_id, o.stage, o.lead_status
  from public.opportunities o
  join public.org_clients c on c.id = o.client_id
  where coalesce(c.status, 'Inactive') <> 'Inactive';

  /* Companies per band, for Target Companies. */
  create temp table _stage_counts on commit drop as
  with acct as (
    select client_id, account_id,
           max(target_account_stage_rank(target_account_stage(stage))) as rnk
    from _live
    where account_id is not null
    group by 1, 2
  )
  select client_id,
         target_account_stage_by_rank(rnk) as target_stage,
         count(*)::bigint                  as companies
  from acct
  group by 1, 2;

  delete from public.pipeline_client_stage_counts;
  insert into public.pipeline_client_stage_counts (client_id, target_stage, companies, refreshed_at)
  select client_id, target_stage, companies, now() from _stage_counts;
  get diagnostics n = row_count;

  /* Pursuits per raw value, both fields, for Target Contacts. */
  create temp table _field_counts on commit drop as
  select client_id, 'stage'::text as field, stage as value, count(*)::bigint as pursuits
  from _live
  where nullif(trim(stage), '') is not null
  group by 1, 2, 3
  union all
  select client_id, 'lead_status', lead_status, count(*)::bigint
  from _live
  where nullif(trim(lead_status), '') is not null
  group by 1, 2, 3;

  delete from public.pipeline_client_field_counts;
  insert into public.pipeline_client_field_counts (client_id, field, value, pursuits, refreshed_at)
  select client_id, field, value, pursuits, now() from _field_counts;
  get diagnostics m = row_count;

  return n + m;
end;
$function$;

revoke all on function public.refresh_pipeline_client_stage_counts() from public, anon, authenticated;


/*
 * The client rows now carry all three maps. Which one a screen draws is its
 * own business: Target Companies uses stage_counts, Target Contacts uses one of
 * the other two depending on the viewer's role.
 */
drop function if exists public.pipeline_my_clients(uuid);

create function public.pipeline_my_clients(p_as_member uuid default null)
returns table (
  client_id                 uuid,
  client_name               text,
  client_active             boolean,
  client_status             text,
  team_lead_id              uuid,
  team_lead_name            text,
  account_manager_id        uuid,
  account_manager_name      text,
  held_by_id                uuid,
  held_by_name              text,
  stage_counts              jsonb,
  contact_stage_counts      jsonb,
  contact_lead_status_counts jsonb,
  companies                 bigint,
  open_companies            bigint,
  pursuits                  bigint
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with eff as (
    select case
      when p_as_member is not null and public.can_preview_as(p_as_member)
        then p_as_member
      else (select id from public.org_members
            where active and auth_user_id = auth.uid() limit 1)
    end as id
  ),
  reports as (
    select r.id, r.full_name
    from public.org_members r, eff
    where r.manager_member_id = eff.id and r.active
  ),
  mine as (
    select c.*, coalesce(c.team_lead_id, am.manager_member_id) as effective_team_lead_id
    from public.org_clients c
    left join public.org_members am on am.id = c.account_manager_id
    where c.id in (select client_id from public.my_client_ids((select id from eff)))
      and coalesce(c.status, 'Inactive') <> 'Inactive'
  ),
  counts as (
    select s.client_id,
           jsonb_object_agg(s.target_stage, s.companies)              as stage_counts,
           sum(s.companies)                                           as companies,
           sum(s.companies) filter (where s.target_stage <> 'Closed') as open_companies
    from public.pipeline_client_stage_counts s
    where s.client_id in (select id from mine)
    group by s.client_id
  ),
  fields as (
    select f.client_id,
           coalesce(jsonb_object_agg(f.value, f.pursuits) filter (where f.field = 'stage'), '{}'::jsonb)       as stage_map,
           coalesce(jsonb_object_agg(f.value, f.pursuits) filter (where f.field = 'lead_status'), '{}'::jsonb) as lead_map,
           sum(f.pursuits) filter (where f.field = 'stage')                                                    as pursuits
    from public.pipeline_client_field_counts f
    where f.client_id in (select id from mine)
    group by f.client_id
  )
  select
    c.id, c.name, c.active, c.status,
    c.effective_team_lead_id, tl.full_name,
    c.account_manager_id, am.full_name,
    h.id, h.full_name,
    coalesce(n.stage_counts, '{}'::jsonb),
    coalesce(fl.stage_map, '{}'::jsonb),
    coalesce(fl.lead_map, '{}'::jsonb),
    coalesce(n.companies, 0),
    coalesce(n.open_companies, 0),
    coalesce(fl.pursuits, 0)
  from mine c
  join counts n on n.client_id = c.id
  left join fields fl on fl.client_id = c.id
  left join public.org_members tl on tl.id = c.effective_team_lead_id
  left join public.org_members am on am.id = c.account_manager_id
  left join lateral (
    select r.id, r.full_name
    from reports r
    where r.id in (c.account_manager_id, c.effective_team_lead_id, c.member_id,
                   c.marketing_strategist_id, c.data_analyst_id,
                   c.data_engineer_id, c.data_team_lead_id)
    order by case r.id
               when c.account_manager_id then 1
               when c.effective_team_lead_id then 2
               when c.member_id then 3
               else 4
             end
    limit 1
  ) h on true
  where coalesce(n.open_companies, 0) > 0
  order by c.name;
$function$;

comment on function public.pipeline_my_clients(uuid) is
  'Current clients the viewer can reach, with companies per rolled-up band and pursuits per raw stage and lead status. p_as_member is honoured only when can_preview_as() allows it.';

revoke all on function public.pipeline_my_clients(uuid) from public, anon;
grant execute on function public.pipeline_my_clients(uuid) to authenticated, service_role;
