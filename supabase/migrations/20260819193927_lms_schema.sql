-- Bring the LMS into this project so both apps share one identity.
--
-- Purely additive: no existing scoreboard table, view, function or policy is
-- modified except the signup trigger, which is extended rather than replaced
-- (see the note on on_auth_user_created below).
--
-- Ported from Claude-Projects/lms/supabase/migrations/001-005, with two
-- deliberate differences:
--   * role_courses (002) is included. It was never applied to the old project,
--     which silently emptied every learner's dashboard -- the learner page
--     selects from it and falls back to [] on error.
--   * handle_new_user() also does the rep linking that link_rep_on_signup()
--     used to do on its own, because both want the same trigger.

-- ---------------------------------------------------------------- identity --

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null check (role in ('admin','manager','instructor','learner')),
  manager_id uuid references public.profiles(id),
  avatar_url text,
  created_at timestamptz default now()
);

-- Who gets which LMS role on first sign-in. Without this everyone would land
-- as 'learner' and an admin would have to be promoted by hand in SQL.
create table public.lms_initial_roles (
  email text primary key,
  role text not null check (role in ('admin','manager','instructor','learner'))
);

insert into public.lms_initial_roles (email, role) values
  ('gabe@bethefactur.com',            'admin'),
  ('chad.kinner@facturmfg.com',       'admin'),
  ('noah.rodman@facturmfg.com',       'admin'),
  ('darryl.mechell@facturmfg.com',    'admin'),
  ('miljan@bethefactur.com',          'admin'),
  ('srdjan.todorovic@facturmfg.com',  'admin'),
  ('noah.funk@facturmfg.com',         'learner'),
  ('samhita.miriyala@facturmfg.com',  'learner'),
  ('eli.garcia@facturmfg.com',        'learner'),
  ('gedaliah.tobias@facturmfg.com',   'learner'),
  ('elijah.condellone@facturmfg.com', 'learner');

-- ----------------------------------------------------------------- content --

create table public.learning_paths (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  target_role text check (target_role in ('admin','manager','instructor','learner')),
  created_by uuid references public.profiles(id),
  created_at timestamptz default now()
);

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  thumbnail_url text,
  instructor_id uuid references public.profiles(id),
  is_published boolean default false,
  created_at timestamptz default now()
);

create table public.learning_path_courses (
  id uuid primary key default gen_random_uuid(),
  path_id uuid references public.learning_paths(id) on delete cascade,
  course_id uuid references public.courses(id) on delete cascade,
  position integer not null default 0,
  unique(path_id, course_id)
);

create table public.modules (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references public.courses(id) on delete cascade,
  title text not null,
  position integer not null default 0
);

create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  module_id uuid references public.modules(id) on delete cascade,
  title text not null,
  type text not null check (type in ('video','text','quiz','file')),
  content jsonb,
  position integer not null default 0,
  duration_minutes integer,
  owner_id uuid references public.profiles(id)
);

create table public.role_courses (
  id uuid primary key default gen_random_uuid(),
  role text not null,
  course_id uuid not null references public.courses(id) on delete cascade,
  created_at timestamptz not null default timezone('utc'::text, now()),
  unique(role, course_id)
);

-- ------------------------------------------------------------------ usage --

create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  course_id uuid references public.courses(id) on delete cascade,
  enrolled_at timestamptz default now(),
  completed_at timestamptz,
  deadline timestamptz,
  unique(user_id, course_id)
);

create table public.lesson_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  lesson_id uuid references public.lessons(id) on delete cascade,
  completed_at timestamptz default now(),
  quiz_score integer,
  unique(user_id, lesson_id)
);

create table public.certificates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  course_id uuid references public.courses(id) on delete cascade,
  cert_number text unique not null,
  issuer_name text not null,
  issued_at timestamptz default now(),
  unique(user_id, course_id)
);

-- Foreign keys the LMS queries constantly but never had indexes for.
create index on public.modules (course_id);
create index on public.lessons (module_id);
create index on public.enrollments (user_id);
create index on public.enrollments (course_id);
create index on public.lesson_progress (user_id);
create index on public.lesson_progress (lesson_id);
create index on public.role_courses (role);

-- -------------------------------------------------------------- functions --

create or replace function public.is_admin(uid uuid)
returns boolean
language sql
security definer
set search_path = public, pg_catalog
as $$
  select exists (select 1 from public.profiles where id = uid and role = 'admin');
$$;

-- Replaces link_rep_on_signup(): does the same rep linking, and additionally
-- creates the LMS profile. Only Factur addresses get a profile -- outsiders are
-- left profile-less and the app bounces them to /unauthorized, which is the
-- behaviour the scoreboard already has. Deliberately does not raise, so a
-- stray Google account still gets a clean redirect rather than an auth error.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  seeded_role text;
begin
  update public.reps
     set auth_user_id = new.id
   where lower(email) = lower(new.email)
     and auth_user_id is null;

  if lower(split_part(new.email, '@', 2)) in ('bethefactur.com', 'facturmfg.com') then
    select role into seeded_role
      from public.lms_initial_roles
     where lower(email) = lower(new.email);

    insert into public.profiles (id, full_name, role)
    values (
      new.id,
      coalesce(new.raw_user_meta_data->>'full_name', ''),
      coalesce(seeded_role, 'learner')
    )
    on conflict (id) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

create or replace function public.prevent_role_escalation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if new.role is distinct from old.role then
    if auth.uid() is not null and not public.is_admin(auth.uid()) then
      raise exception 'Only admins can change a user''s role';
    end if;
  end if;
  return new;
end;
$$;

create trigger enforce_role_change
  before update on public.profiles
  for each row
  execute function public.prevent_role_escalation();
