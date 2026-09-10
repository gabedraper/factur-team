/*
 * Pay, company finances and assessment material, behind a permission.
 *
 * The handbook is 151 courses pulled over from Guru and mostly not published
 * yet. Not being published is not a security boundary and was never meant to be
 * one -- the material is there to be read, and Gaib reading it is the point.
 *
 * But `lessons` had no rule at all beyond is_factur_user(), while `courses`
 * hid anything unpublished. The screens navigate course-first, so nobody ever
 * saw the difference; a query that reads the table directly does. That put
 * commission scenarios, the budget, the balance sheet and the PI assessment
 * material in reach of all fifty signed-in staff.
 *
 * The fix is not to shut the handbook. It is to name the handful of courses
 * that are genuinely about somebody's pay or the company's books, and gate
 * those. Everything else stays open to everyone, which is what makes the
 * handbook worth having.
 *
 * The lessons policy written here FAILS OPEN and is replaced two migrations
 * later by 20260910004225. It is kept as it was applied so the sequence
 * replays truthfully; do not copy its shape.
 */

alter table public.courses
  add column if not exists restricted boolean not null default false;

comment on column public.courses.restricted is
  'Pay, company finances or assessment material. Needs lms.restricted to read, including through an agent.';

insert into public.org_permissions (key, name, description, category, position)
values (
  'lms.restricted',
  'Read pay and finance material',
  'Commission structures, pay schedules, company financials and assessment material in the handbook.',
  'Learn',
  4
)
on conflict (key) do nothing;

-- Whoever already runs the money can read about it. Everyone else is added
-- deliberately, in Settings, rather than by inheriting it from an admin flag.
insert into public.org_role_permissions (role_id, permission_key)
select r.id, 'lms.restricted'
from public.org_roles r
where r.name in ('CEO', 'Financial Manager')
on conflict do nothing;

-- The four that are actually about money or assessment instruments.
update public.courses
   set restricted = true
 where title in ('Finance', 'Payroll', 'Contract & Pricing', 'Assessments');

create or replace function public.handbook_can_read_restricted()
returns boolean
language sql
stable
set search_path to 'public', 'pg_catalog'
as $$
  select public.has_permission('lms.restricted');
$$;
