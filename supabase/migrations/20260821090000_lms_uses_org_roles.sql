-- The training side had its own idea of a role -- admin, manager, instructor,
-- learner on profiles.role -- with no connection to the org model. Two
-- vocabularies for the same question, and the reason a person could be an OBDM
-- in one screen and a "learner" in another. It now uses the roles defined in
-- Settings like everything else.
--
-- role_courses had no rows, so there was nothing to migrate: course assignment
-- moves straight onto org_roles.

alter table public.role_courses
  add column if not exists role_id uuid references public.org_roles(id) on delete cascade;

update public.role_courses rc set role_id = r.id
from public.org_roles r where lower(r.slug) = lower(rc.role) and rc.role_id is null;

delete from public.role_courses where role_id is null;
alter table public.role_courses alter column role_id set not null;
alter table public.role_courses drop column if exists role;

create unique index if not exists role_courses_role_course
  on public.role_courses(role_id, course_id);

-- Training permissions, so access is granted the same way as everything else.
insert into public.org_permissions (key, name, description, category, position) values
  ('lms.learn', 'Take training', 'See assigned courses and work through them.', 'Learn', 0),
  ('lms.manage_team', 'See team progress', 'See how the people reporting to you are progressing.', 'Learn', 3)
on conflict (key) do nothing;

insert into public.org_role_permissions (role_id, permission_key)
select r.id, 'lms.learn' from public.org_roles r where r.active
on conflict do nothing;

insert into public.org_role_permissions (role_id, permission_key)
select r.id, 'lms.manage_team' from public.org_roles r
where r.slug in ('manager', 'app-admin', 'exec')
on conflict do nothing;

-- Whoever was an LMS admin keeps administering training, so nobody is locked out
-- of course management by this change.
insert into public.org_assignments (member_id, role_id, is_primary)
select distinct m.id, r.id, false
from public.org_members m
join public.profiles p on p.id = m.auth_user_id and p.role = 'admin'
join public.org_roles r on r.slug = 'app-admin'
on conflict do nothing;
