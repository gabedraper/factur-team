/*
 * Preview reaches these reads.
 *
 * "Viewing as Josh Hobson" is a cookie the Next layer reads; auth.uid() in
 * Postgres is still the person who signed in. So previewing a rep showed the
 * previewer's own screen with the rep's name on the banner -- Josh, an OBDM
 * with 14 clients under one team lead, was shown 154 clients grouped under
 * three. Nothing leaked that the viewer could not already see, but it answered
 * the wrong question, which is the entire point of the feature.
 *
 * my_client_ids() has taken a p_as_member argument all along. These two never
 * passed it. Now they do, and the page hands them previewedMemberId().
 *
 * The argument is gated here rather than trusted, because these are security
 * definer and a caller can reach an RPC directly without going through the
 * page. has_permission('org.manage') reads the real signed-in identity, not the
 * previewed one, so previewing a rep cannot be used to then preview someone
 * else from inside that session. Anyone without it gets their own screen no
 * matter what they pass.
 */

/* The no-argument forms go first. Left in place they would not be replaced but
   joined by an overload, and a bare pipeline_my_scope() would then be
   ambiguous rather than defaulted. */
drop function if exists public.pipeline_my_scope();
drop function if exists public.pipeline_my_clients();

create or replace function public.pipeline_my_scope(p_as_member uuid default null)
returns table (level text, member_id uuid, member_name text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with eff as (
    select case
      when p_as_member is not null and public.has_permission('org.manage')
        then p_as_member
      else (select id from public.org_members
            where active and auth_user_id = auth.uid() limit 1)
    end as id
  ),
  me as (
    select m.id, m.full_name
    from public.org_members m, eff
    where m.active and m.id = eff.id
  ),
  slugs as (
    select r.slug
    from public.org_assignments a
    join public.org_roles r on r.id = a.role_id
    join me on me.id = a.member_id
  )
  select
    case
      when exists (select 1 from slugs where slug = 'exec') then 'lead'
      when exists (
        select 1 from slugs
        where slug in ('ceo', 'manager', 'app-admin',
                       'financial-manager', 'service-delivery-manager')
      ) then 'admin'
      when exists (
        select 1 from public.org_members r
        where r.manager_member_id = me.id and r.active
      ) then 'lead'
      else 'rep'
    end,
    me.id,
    me.full_name
  from me;
$function$;

comment on function public.pipeline_my_scope(uuid) is
  'Where the viewer sits, from the roles list: lead (exec), admin (ceo/manager/app-admin/financial-manager/service-delivery-manager) or rep. p_as_member is honoured only for a caller who really holds org.manage.';


create or replace function public.pipeline_my_clients(p_as_member uuid default null)
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
  with eff as (
    select case
      when p_as_member is not null and public.has_permission('org.manage')
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

comment on function public.pipeline_my_clients(uuid) is
  'Current clients (status <> Inactive) the viewer can reach that still have open target companies. p_as_member is honoured only for a caller who really holds org.manage.';

revoke all on function public.pipeline_my_scope(uuid) from public, anon;
revoke all on function public.pipeline_my_clients(uuid) from public, anon;
grant execute on function public.pipeline_my_scope(uuid) to authenticated, service_role;
grant execute on function public.pipeline_my_clients(uuid) to authenticated, service_role;
