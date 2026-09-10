/*
 * Only current clients. org_clients.active does not mean what it says.
 *
 * Every one of the 991 rows has active = true -- the column was never written
 * by the Salesforce client sync, which is insert-only, so nothing has ever set
 * it back to false. status is the field that carries the answer, and by it 773
 * of those clients are Inactive: former clients whose opportunities were never
 * closed out and so still look like live pipeline.
 *
 * That is what put 174 clients under Darryl and 138 under Noah when the company
 * has about 170 clients in total. It was not the grouping that was wrong, it
 * was the population: nine tenths of it were companies nobody works any more.
 *
 * Current means status is anything but Inactive -- Active, Onboarding, Hold and
 * Financial Pause are all clients somebody is responsible for today. That
 * leaves 214 clients, 167 of them with open pipeline, which is the number the
 * business recognises.
 *
 * client_active is recomputed from status here rather than read from the
 * column, so the screen never inherits that lie again.
 */

drop function if exists public.pipeline_my_clients();

create function public.pipeline_my_clients()
returns table (
  client_id            uuid,
  client_name          text,
  client_active        boolean,
  client_status        text,
  team_lead_id         uuid,
  team_lead_name       text,
  account_manager_id   uuid,
  account_manager_name text,
  held_by_id           uuid,
  held_by_name         text,
  stage_counts         jsonb,
  companies            bigint,
  open_companies       bigint
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with me as (
    select id from public.org_members where active and auth_user_id = auth.uid() limit 1
  ),
  reports as (
    select r.id, r.full_name
    from public.org_members r, me
    where r.manager_member_id = me.id and r.active
  ),
  mine as (
    select c.*, coalesce(c.team_lead_id, am.manager_member_id) as effective_team_lead_id
    from public.org_clients c
    left join public.org_members am on am.id = c.account_manager_id
    where c.id in (select client_id from public.my_client_ids())
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
  )
  select
    c.id, c.name, c.status = 'Active', c.status,
    c.effective_team_lead_id, tl.full_name,
    c.account_manager_id, am.full_name,
    h.id, h.full_name,
    coalesce(n.stage_counts, '{}'::jsonb),
    coalesce(n.companies, 0),
    coalesce(n.open_companies, 0)
  from mine c
  join counts n on n.client_id = c.id
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

comment on function public.pipeline_my_clients() is
  'Current clients (status <> Inactive) the viewer can reach that still have open target companies, with effective team lead, account manager, the viewer''s own report who holds each, and the per-stage company counts.';

revoke all on function public.pipeline_my_clients() from public, anon;
grant execute on function public.pipeline_my_clients() to authenticated, service_role;


/*
 * The roll-up skips former clients too. Nine tenths of the opportunity rows
 * belong to them, and none of it is worked, so counting it was most of the
 * 12.8 seconds this job costs and none of the value.
 */
create or replace function public.refresh_pipeline_client_stage_counts()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n integer;
begin
  create temp table _stage_counts on commit drop as
  with acct as (
    select o.client_id,
           o.account_id,
           max(target_account_stage_rank(target_account_stage(o.stage))) as rnk
    from public.opportunities o
    join public.org_clients c on c.id = o.client_id
    where o.account_id is not null
      and coalesce(c.status, 'Inactive') <> 'Inactive'
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

  return n;
end;
$function$;

revoke all on function public.refresh_pipeline_client_stage_counts() from public, anon, authenticated;
