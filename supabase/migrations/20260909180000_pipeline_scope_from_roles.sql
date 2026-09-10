/*
 * Read the viewer's level off the roles list, where it is already recorded.
 *
 * Two earlier attempts got this wrong. org.manage cannot say it, because
 * app-admin carries that permission and nine people hold app-admin, including
 * ones who manage nobody -- it says "can administer the app", not "runs a
 * team". Position in the reporting tree cannot say it either: that made
 * exactly one person a manager and left the six actual team leads indistinct
 * from each other.
 *
 * The roles list already draws the line. exec is literally named Team Lead and
 * six people hold it; ceo, manager (Data Team Manager), financial-manager and
 * service-delivery-manager are the manager tier; bdm and obdm are reps.
 *
 * exec is checked first and that ordering is the whole point. Five of the six
 * team leads also hold app-admin, so testing the manager tier first would hand
 * Darryl and Noah the company-wide grouping instead of their own team's -- the
 * bug this replaces. Somebody who is both is a team lead, because that is the
 * job; app-admin is a key, not a rank.
 *
 * Direct reports remain as a fallback so a new lead is not stuck on the rep
 * view until someone remembers to give them the role.
 */

create or replace function public.pipeline_my_scope()
returns table (level text, member_id uuid, member_name text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with me as (
    select id, full_name from public.org_members
    where active and auth_user_id = auth.uid()
    limit 1
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

comment on function public.pipeline_my_scope() is
  'Where the viewer sits, from the roles list: lead (exec), admin (ceo/manager/app-admin/financial-manager/service-delivery-manager) or rep. Decides how the target company list is grouped, not what it contains -- my_client_ids() already does that.';


/*
 * Same rows as before, with one correction: the team lead is the effective one.
 *
 * A client's team lead is the explicit team_lead_id when set and otherwise the
 * account manager's own manager -- the rule that
 * org_client_team.effective_team_lead_id and lib/team-lead.ts both already
 * carry, repeated here for the same reason lib/team-lead.ts repeats it, and to
 * be changed with them. Reading team_lead_id raw, as this did, found a lead for
 * 151 of the 903 clients with open pipeline. The real rule finds 399.
 *
 * 486 have neither an account manager nor a lead, and 294 of those have nobody
 * in any role at all. Those group under "No team lead" with a real count rather
 * than vanishing, because a client with live pipeline and no one on it is worth
 * seeing.
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
  order by c.active desc, c.name;
$function$;

comment on function public.pipeline_my_clients() is
  'Clients the viewer can reach that still have open target companies, with effective team lead, account manager, the viewer''s own report who holds each, and the per-stage company counts.';

revoke all on function public.pipeline_my_clients() from public, anon;
grant execute on function public.pipeline_my_clients() to authenticated, service_role;
