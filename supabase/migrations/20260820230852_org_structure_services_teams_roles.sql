-- The app's own org model: services -> teams -> roles, with people assigned to
-- them and permissions hanging off roles.
--
-- The app is the source of truth. Salesforce is linked, never authoritative:
-- its UserRole is blank for 14 of 45 active users, its Title for 39, and one of
-- its roles is literally named "OBDM/OSDR Revised 25' Role". It is good enough
-- to seed from once, which is what the seeding migration does.

create table public.org_services (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null, name text not null, description text,
  position integer not null default 0, active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.org_teams (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.org_services(id) on delete cascade,
  slug text not null, name text not null, description text,
  active boolean not null default true, created_at timestamptz not null default now(),
  unique (service_id, slug)
);

create table public.org_roles (
  id uuid primary key default gen_random_uuid(),
  service_id uuid references public.org_services(id) on delete set null,
  slug text unique not null, name text not null, description text,
  active boolean not null default true, created_at timestamptz not null default now()
);

-- Capability keys the app checks, e.g. 'scoreboard.retention.unmask'. Kept as
-- text rather than an enum so adding one is a data change, not a migration.
create table public.org_permissions (
  key text primary key, name text not null, description text
);

create table public.org_role_permissions (
  role_id uuid not null references public.org_roles(id) on delete cascade,
  permission_key text not null references public.org_permissions(key) on delete cascade,
  primary key (role_id, permission_key)
);

-- A person. Keyed on email because someone must be able to exist -- with a role
-- and a team -- before they have ever signed in. auth_user_id fills in on first
-- sign-in; rep_id and salesforce_user_id are links, not owners.
create table public.org_members (
  id uuid primary key default gen_random_uuid(),
  email text unique not null, full_name text,
  auth_user_id uuid references auth.users(id) on delete set null,
  rep_id uuid references public.reps(id) on delete set null,
  salesforce_user_id text,
  manager_member_id uuid references public.org_members(id) on delete set null,
  active boolean not null default true,
  -- Set when seeding could not confidently map a Salesforce role. These are the
  -- rows an admin is being asked to resolve.
  needs_review boolean not null default false,
  created_at timestamptz not null default now()
);

create index org_members_auth_user_id_idx on public.org_members(auth_user_id);
create index org_members_rep_id_idx on public.org_members(rep_id);

create table public.org_assignments (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.org_members(id) on delete cascade,
  role_id uuid not null references public.org_roles(id) on delete cascade,
  team_id uuid references public.org_teams(id) on delete set null,
  is_primary boolean not null default true,
  created_at timestamptz not null default now(),
  unique (member_id, role_id, team_id)
);

create index org_assignments_member_idx on public.org_assignments(member_id);

-- Does the signed-in user hold this capability?
create or replace function public.has_permission(p_key text)
returns boolean language sql stable security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.org_members m
    join public.org_assignments a on a.member_id = m.id
    join public.org_role_permissions rp on rp.role_id = a.role_id
    where m.auth_user_id = auth.uid() and m.active and rp.permission_key = p_key
  );
$$;

alter table public.org_services enable row level security;
alter table public.org_teams enable row level security;
alter table public.org_roles enable row level security;
alter table public.org_permissions enable row level security;
alter table public.org_role_permissions enable row level security;
alter table public.org_members enable row level security;
alter table public.org_assignments enable row level security;

-- Everyone on a Factur account can read the org chart; only holders of
-- org.manage can change it.
do $$
declare t text;
begin
  foreach t in array array['org_services','org_teams','org_roles','org_permissions',
                           'org_role_permissions','org_members','org_assignments']
  loop
    execute format(
      'create policy factur_users_read_%1$s on public.%1$I
         for select to authenticated using (public.is_factur_user())', t);
    execute format(
      'create policy org_managers_write_%1$s on public.%1$I
         for all to authenticated
         using (public.is_factur_user() and public.has_permission(''org.manage''))
         with check (public.is_factur_user() and public.has_permission(''org.manage''))', t);
  end loop;
end $$;
