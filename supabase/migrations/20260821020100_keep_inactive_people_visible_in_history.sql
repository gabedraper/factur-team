-- Making someone inactive must not erase what they did.
--
-- `active` is about whether someone is still here -- it belongs in pickers and
-- current-team counts, not in historical reads. Nothing should delete a person
-- to remove them, so the two are separated explicitly:
--
--   active = false  -> stops appearing as a choice, keeps every row they own
--   deleted         -> refused by the app once they have signed in

alter table public.org_members add column if not exists deactivated_at timestamptz;

comment on column public.org_members.active is
  'Still with the company. Inactive people keep all their history and stay visible in historical views; they only drop out of pickers and current counts.';

create or replace function public.stamp_member_deactivation()
returns trigger language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if new.active = false and coalesce(old.active, true) = true then
    new.deactivated_at := now();
  elsif new.active = true then
    new.deactivated_at := null;
  end if;
  return new;
end $$;

drop trigger if exists org_members_stamp_deactivation on public.org_members;
create trigger org_members_stamp_deactivation
  before update of active on public.org_members
  for each row execute function public.stamp_member_deactivation();

-- Everyone, with enough context to show a leaver without pretending they are
-- still here. This is what history screens should read.
create or replace view public.org_people as
select m.id, m.email, m.full_name, m.active, m.deactivated_at,
       m.salesforce_user_id, m.rep_id, m.auth_user_id,
       mgr.full_name as manager_name,
       coalesce((select string_agg(r.name, ', ' order by r.name)
                 from public.org_assignments a
                 join public.org_roles r on r.id = a.role_id
                 where a.member_id = m.id), '—') as roles,
       (select count(*) from public.org_clients c
        where c.member_id = m.id and c.active) as clients_covered
from public.org_members m
left join public.org_members mgr on mgr.id = m.manager_member_id
where public.is_factur_user();
