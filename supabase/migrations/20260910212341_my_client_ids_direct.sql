-- Clients this person is staffed on themselves, with no roll-up.
--
-- my_client_ids() already answers "mine and my team's" -- it walks the
-- reporting line downward -- and it gates RLS policies on opportunities, so it
-- is left exactly as it is. This is the narrower question the "My ..." views
-- need.
--
-- The preview gating is repeated deliberately rather than skipped: a second
-- entry point with weaker rules would be a way around the first.
create or replace function public.my_client_ids_direct(p_as_member uuid default null)
returns table (client_id uuid)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with gate as (
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
  )
  select c.id
  from public.org_clients c
  where c.account_manager_id      in (select id from me)
     or c.team_lead_id            in (select id from me)
     or c.sdr_id                  in (select id from me)
     or c.marketing_strategist_id in (select id from me)
     or c.data_analyst_id         in (select id from me)
     or c.data_engineer_id        in (select id from me)
     or c.data_team_lead_id       in (select id from me)
     or c.member_id               in (select id from me);
$function$;

comment on function public.my_client_ids_direct(uuid) is
  'Clients where this member is personally named in a staffing role. my_client_ids() is the same question rolled up through the reporting line.';
