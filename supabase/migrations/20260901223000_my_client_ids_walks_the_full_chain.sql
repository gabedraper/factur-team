/*
 * my_client_ids() only ever unioned in direct reports -- fine for a
 * first-line manager, wrong for anyone above one. 34 people here have a
 * manager whose manager also has a manager, so a director asking "what
 * rolls up to me" got their direct reports' clients and silently missed
 * everyone below that. Walks the whole management chain now, with a path
 * array to guard against a manager_member_id cycle turning this into an
 * infinite loop -- org data shouldn't cycle, but a recursive query that
 * assumes it can't is one bad edit away from hanging.
 */
create or replace function public.my_client_ids(p_as_member uuid default null::uuid)
returns table(client_id uuid)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with recursive me as (
    select id from public.org_members
    where active
      and (case when p_as_member is not null
                then id = p_as_member
                else auth_user_id = auth.uid() end)
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
