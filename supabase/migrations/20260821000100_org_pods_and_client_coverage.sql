-- Two shapes of team exist, and they are not the same thing:
--
--   a pod  -- several people working a group of clients together
--   an individual account manager -- one person covering their own clients,
--                                    reporting to a manager
--
-- Modelling only the first would force individuals into pods of one, which
-- misrepresents how they work and makes "who covers this client" ambiguous.
-- So coverage is a separate idea from team membership: a client is covered by
-- a pod OR by a person, never both.

alter table public.org_teams
  add column if not exists kind text not null default 'pod'
    check (kind in ('pod', 'group'));

comment on column public.org_teams.kind is
  'pod = people working a set of clients together; group = an umbrella for people who work individually.';

-- Which clients a pod or an individual covers. client_id is the Salesforce
-- Client__c record id, the same value Opportunity.Client__c carries, so this
-- joins straight to the timeline and scoreboard data.
create table if not exists public.org_client_coverage (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  client_name text,
  team_id uuid references public.org_teams(id) on delete cascade,
  member_id uuid references public.org_members(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- Exactly one owner: a pod or a person.
  constraint org_client_coverage_one_owner check (
    (team_id is not null and member_id is null) or
    (team_id is null and member_id is not null)
  )
);

create unique index if not exists org_client_coverage_team_client
  on public.org_client_coverage(client_id, team_id) where team_id is not null;
create unique index if not exists org_client_coverage_member_client
  on public.org_client_coverage(client_id, member_id) where member_id is not null;
create index if not exists org_client_coverage_client_idx
  on public.org_client_coverage(client_id);

alter table public.org_client_coverage enable row level security;

create policy factur_users_read_org_client_coverage on public.org_client_coverage
  for select to authenticated using (public.is_factur_user());
create policy org_managers_write_org_client_coverage on public.org_client_coverage
  for all to authenticated
  using (public.is_factur_user() and public.has_permission('org.manage'))
  with check (public.is_factur_user() and public.has_permission('org.manage'));

-- Everyone a client is covered by, whether through a pod or directly. The app
-- asks this question far more often than it asks about pods themselves.
create or replace view public.org_client_coverage_people as
select c.client_id, c.client_name, m.id as member_id, m.full_name, m.email,
       t.id as team_id, t.name as team_name,
       case when c.team_id is not null then 'pod' else 'individual' end as via
from public.org_client_coverage c
left join public.org_teams t on t.id = c.team_id
left join public.org_assignments a on a.team_id = c.team_id
left join public.org_members m on m.id = coalesce(c.member_id, a.member_id)
where m.id is not null and m.active and public.is_factur_user();

-- The seeded one-team-per-service rows are umbrellas, not pods.
update public.org_teams set kind = 'group';
