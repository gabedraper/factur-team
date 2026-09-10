/*
 * The landing screen's rows: a client, who is over it, and how its target
 * companies are spread across the stages.
 *
 * The counts come from pipeline_client_stage_counts rather than from
 * opportunities, because counting them here costs 12.8 seconds and the request
 * is cut off at 8. See that table for why.
 *
 * held_by is the viewer's own direct report who holds this client, when one
 * does -- the middle level of a lead's view. Account manager wins over team
 * lead wins over member, because that is the order of who owns the
 * relationship day to day.
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
    select c.*
    from public.org_clients c
    where c.id in (select client_id from public.my_client_ids())
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
    c.id, c.name, c.active, c.status,
    c.team_lead_id, tl.full_name,
    c.account_manager_id, am.full_name,
    h.id, h.full_name,
    coalesce(n.stage_counts, '{}'::jsonb),
    coalesce(n.companies, 0),
    coalesce(n.open_companies, 0)
  from mine c
  join counts n on n.client_id = c.id
  left join public.org_members tl on tl.id = c.team_lead_id
  left join public.org_members am on am.id = c.account_manager_id
  left join lateral (
    select r.id, r.full_name
    from reports r
    where r.id in (c.account_manager_id, c.team_lead_id, c.member_id,
                   c.marketing_strategist_id, c.data_analyst_id,
                   c.data_engineer_id, c.data_team_lead_id)
    order by case r.id
               when c.account_manager_id then 1
               when c.team_lead_id       then 2
               when c.member_id          then 3
               else 4
             end
    limit 1
  ) h on true
  where coalesce(n.open_companies, 0) > 0
  order by c.active desc, c.name;
$function$;

comment on function public.pipeline_my_clients() is
  'Clients the viewer can reach that still have open target companies, with team lead, account manager, the viewer''s own report who holds each, and the per-stage company counts.';

revoke all on function public.pipeline_my_clients() from public, anon;
grant execute on function public.pipeline_my_clients() to authenticated, service_role;
