/*
 * Who may look through somebody else's eyes.
 *
 * my_client_ids(p_as_member) has always trusted its argument. It is security
 * definer and granted to authenticated, so any signed-in person could call it
 * over the API with a colleague's id and get that colleague's clients back --
 * an OBDM asking for his own got 33, asking as the CEO got 581.
 *
 * That was not only an id leak. get_collections_board() decides access with
 * "can_see_all or attached", and attached is
 * exists(select 1 from my_client_ids(p_as_member)) -- so the same substitution
 * turned on another team's invoices, balances and contact emails. The
 * permission checks around it were sound; they were guarding a door whose hinge
 * was loose.
 *
 * The rule the app already intended is written here once, in the database,
 * where the API cannot go around it. Managers, team leads and admins may
 * preview; nobody else may, whatever they pass.
 *
 * Admins -- ceo and app-admin -- may preview anyone, since administering the
 * app means seeing what any of it looks like. Team leads and managers may
 * preview only inside their own reporting line, which is the part the app layer
 * never said: without it a Data Team Manager could preview the CEO and inherit
 * the whole company, which is the same escalation in a nicer coat.
 *
 * Callers that pass no argument are untouched, so every RLS policy built on the
 * bare my_client_ids() behaves exactly as before.
 */

create or replace function public.can_preview_as(p_target uuid default null)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  with recursive me as (
    select id from public.org_members
    where active and auth_user_id = auth.uid()
    limit 1
  ),
  slugs as (
    select r.slug
    from public.org_assignments a
    join public.org_roles r on r.id = a.role_id
    join me on me.id = a.member_id
  ),
  circle as (
    select m.id, array[m.id] as path
    from public.org_members m
    where m.active and m.id in (select id from me)
    union
    select m.id, c.path || m.id
    from public.org_members m
    join circle c on m.manager_member_id = c.id
    where m.active and not (m.id = any(c.path))
  )
  select case
    when not exists (select 1 from me) then false
    when exists (select 1 from slugs where slug in ('ceo', 'app-admin')) then true
    when exists (
      select 1 from slugs
      where slug in ('exec', 'manager', 'financial-manager', 'service-delivery-manager')
    ) then p_target is null or p_target in (select id from circle)
    else false
  end;
$function$;

comment on function public.can_preview_as(uuid) is
  'May the signed-in person view the app as p_target? Admins (ceo, app-admin) may preview anyone; team leads and managers only within their own reporting line; everyone else, no.';

revoke all on function public.can_preview_as(uuid) from public, anon;
grant execute on function public.can_preview_as(uuid) to authenticated, service_role;


/*
 * Same function it has always been, with the argument now earned rather than
 * assumed. The gate is its own CTE so the recursive check inside
 * can_preview_as() runs once, not once per member row.
 */
create or replace function public.my_client_ids(p_as_member uuid default null)
returns table (client_id uuid)
language sql
stable
security definer
set search_path to 'public'
as $function$
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
  select c.id
  from public.org_clients c
  where c.account_manager_id in (select id from circle)
     or c.team_lead_id in (select id from circle)
     or c.sdr_id in (select id from circle)
     or c.marketing_strategist_id in (select id from circle)
     or c.data_analyst_id in (select id from circle)
     or c.data_engineer_id in (select id from circle)
     or c.data_team_lead_id in (select id from circle)
     or c.member_id in (select id from circle);
$function$;

comment on function public.my_client_ids(uuid) is
  'Clients the viewer holds any role on, through their whole reporting line. p_as_member is honoured only when can_preview_as() allows it, so an unprivileged caller passing somebody else''s id still gets their own.';


/*
 * The pipeline reads ask the same question, so they ask it the same way. This
 * also widens them from org.manage to the manager and team-lead roles, which is
 * who is meant to be able to preview.
 */
create or replace function public.pipeline_my_scope(p_as_member uuid default null)
returns table (level text, member_id uuid, member_name text)
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
