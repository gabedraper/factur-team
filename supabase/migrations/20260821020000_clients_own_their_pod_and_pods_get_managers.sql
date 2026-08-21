-- Three corrections to the org model.
--
-- 1. A pod has a manager.
-- 2. A pod is not one service. It covers several, so the pod->service link goes
--    and service hangs off the client instead.
-- 3. Coverage is assigned on the client, not on the pod. A client is the thing
--    that has one owner; a pod showing "its" clients is a read of that, not the
--    place it is set.

alter table public.org_teams
  add column if not exists manager_member_id uuid references public.org_members(id) on delete set null;
comment on column public.org_teams.manager_member_id is 'Who runs this pod.';

-- Was NOT NULL: a pod spans services, so it no longer belongs to one. Kept on
-- the seeded 'group' rows, which really are per-service umbrellas.
alter table public.org_teams alter column service_id drop not null;

-- The client list itself. Seeded from Salesforce but ours to edit: service and
-- pod are decisions the app owns, and a client can exist here before Salesforce
-- knows about it.
create table if not exists public.org_clients (
  id uuid primary key default gen_random_uuid(),
  salesforce_client_id text unique,
  name text not null,
  status text,
  service_id uuid references public.org_services(id) on delete set null,
  team_id uuid references public.org_teams(id) on delete set null,
  member_id uuid references public.org_members(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  -- Covered by a pod or by one person, not both. Neither is fine: unassigned.
  constraint org_clients_one_owner check (team_id is null or member_id is null)
);

create index if not exists org_clients_team_idx on public.org_clients(team_id);
create index if not exists org_clients_member_idx on public.org_clients(member_id);

insert into public.org_clients (salesforce_client_id, name, status)
select c.id, coalesce(c.client_account__r_name, c.id), c.client_status__c
from public.sf_clients_raw c
on conflict (salesforce_client_id) do nothing;

update public.org_clients c
set team_id = v.team_id, member_id = v.member_id
from public.org_client_coverage v
where v.client_id = c.salesforce_client_id;

drop view if exists public.org_client_coverage_people;
drop table if exists public.org_client_coverage;

alter table public.org_clients enable row level security;
create policy factur_users_read_org_clients on public.org_clients
  for select to authenticated using (public.is_factur_user());
create policy org_managers_write_org_clients on public.org_clients
  for all to authenticated
  using (public.is_factur_user() and public.has_permission('org.manage'))
  with check (public.is_factur_user() and public.has_permission('org.manage'));

-- Who covers a client, resolving a pod to its people.
--
-- Deliberately does NOT filter on member.active: someone who has left still
-- covered those clients last quarter, and hiding them would silently rewrite
-- history. Callers wanting only current staff filter on member_is_active.
create or replace view public.org_client_coverage_people as
select c.id as client_id, c.salesforce_client_id, c.name as client_name,
       m.id as member_id, m.full_name, m.email, m.active as member_is_active,
       t.id as team_id, t.name as team_name,
       case when c.team_id is not null then 'pod' else 'individual' end as via
from public.org_clients c
left join public.org_teams t on t.id = c.team_id
left join public.org_assignments a on a.team_id = c.team_id
left join public.org_members m on m.id = coalesce(c.member_id, a.member_id)
where m.id is not null and public.is_factur_user();
