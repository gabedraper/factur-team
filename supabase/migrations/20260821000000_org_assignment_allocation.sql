-- People split across roles: 60% OBDM, 40% OSDR.
--
-- Allocation is for measurement, never for access. Permissions stay the union
-- of someone's roles -- you cannot grant 40% of a page, and a part-time OSDR
-- needs the whole OSDR view. What allocation is for is targets: a 60% OBDM
-- compared against a full-time one looks like they are underperforming when
-- they are doing exactly what was asked.

alter table public.org_assignments
  add column if not exists allocation numeric(5,2) not null default 100;

do $$ begin
  alter table public.org_assignments
    add constraint org_assignments_allocation_range
    check (allocation > 0 and allocation <= 100);
exception when duplicate_object then null;
end $$;

comment on column public.org_assignments.allocation is
  'Percent of this person''s time in this role. Weights targets and comparisons; has no effect on permissions.';

-- A person cannot be more than fully allocated across the roles that represent
-- actual work. Manager and app-admin carry no service and are not counted --
-- they describe visibility, not how someone spends their week.
create or replace function public.check_member_allocation()
returns trigger language plpgsql
set search_path = public, pg_catalog
as $$
declare
  total numeric;
  subject uuid := coalesce(new.member_id, old.member_id);
begin
  select coalesce(sum(a.allocation), 0) into total
  from public.org_assignments a
  join public.org_roles r on r.id = a.role_id
  where a.member_id = subject and r.service_id is not null;

  if total > 100 then
    raise exception 'Allocation for this person totals %, which is more than full time', total
      using hint = 'Reduce another role first, or split the difference.';
  end if;
  return null;
end $$;

drop trigger if exists org_assignments_allocation_check on public.org_assignments;
create constraint trigger org_assignments_allocation_check
  after insert or update or delete on public.org_assignments
  deferrable initially deferred
  for each row execute function public.check_member_allocation();

-- Primary role is the largest share, which is what "what do they do" should
-- answer when only one answer fits.
update public.org_assignments a
set is_primary = (
  a.allocation = (
    select max(a2.allocation) from public.org_assignments a2
    join public.org_roles r2 on r2.id = a2.role_id
    where a2.member_id = a.member_id and r2.service_id is not null
  )
)
from public.org_roles r
where r.id = a.role_id and r.service_id is not null;
