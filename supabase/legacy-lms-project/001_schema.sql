-- profiles (extends auth.users)
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null check (role in ('admin','manager','instructor','learner')),
  manager_id uuid references profiles(id),
  avatar_url text,
  created_at timestamptz default now()
);

create table learning_paths (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  target_role text check (target_role in ('admin','manager','instructor','learner')),
  created_by uuid references profiles(id),
  created_at timestamptz default now()
);

create table courses (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  thumbnail_url text,
  instructor_id uuid references profiles(id),
  is_published boolean default false,
  created_at timestamptz default now()
);

create table learning_path_courses (
  id uuid primary key default gen_random_uuid(),
  path_id uuid references learning_paths(id) on delete cascade,
  course_id uuid references courses(id) on delete cascade,
  position integer not null default 0,
  unique(path_id, course_id)
);

create table modules (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references courses(id) on delete cascade,
  title text not null,
  position integer not null default 0
);

create table lessons (
  id uuid primary key default gen_random_uuid(),
  module_id uuid references modules(id) on delete cascade,
  title text not null,
  type text not null check (type in ('video','text','quiz','file')),
  content jsonb,
  position integer not null default 0,
  duration_minutes integer
);

create table enrollments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  course_id uuid references courses(id) on delete cascade,
  enrolled_at timestamptz default now(),
  completed_at timestamptz,
  unique(user_id, course_id)
);

create table lesson_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  lesson_id uuid references lessons(id) on delete cascade,
  completed_at timestamptz default now(),
  quiz_score integer,
  unique(user_id, lesson_id)
);

create table certificates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  course_id uuid references courses(id) on delete cascade,
  cert_number text unique not null,
  issuer_name text not null,
  issued_at timestamptz default now(),
  unique(user_id, course_id)
);

-- RLS Policies

alter table profiles enable row level security;
create policy "Users can view all profiles" on profiles for select using (auth.role() = 'authenticated');
create policy "Users can update own profile" on profiles for update using (auth.uid() = id);

alter table courses enable row level security;
create policy "Anyone can view published courses" on courses for select using (is_published = true or auth.uid() = instructor_id);
create policy "Instructors can insert courses" on courses for insert with check (auth.uid() = instructor_id);
create policy "Instructors can update own courses" on courses for update using (auth.uid() = instructor_id);

alter table modules enable row level security;
create policy "Anyone can view modules" on modules for select using (true);
create policy "Instructors can manage modules" on modules for all using (
  exists (select 1 from courses where courses.id = modules.course_id and courses.instructor_id = auth.uid())
);

alter table lessons enable row level security;
create policy "Anyone can view lessons" on lessons for select using (true);
create policy "Instructors can manage lessons" on lessons for all using (
  exists (select 1 from modules m join courses c on c.id = m.course_id where m.id = lessons.module_id and c.instructor_id = auth.uid())
);

alter table enrollments enable row level security;
create policy "Users can view own enrollments" on enrollments for select using (auth.uid() = user_id);
create policy "Users can enroll" on enrollments for insert with check (auth.uid() = user_id);
create policy "Users can update own enrollment" on enrollments for update using (auth.uid() = user_id);

alter table lesson_progress enable row level security;
create policy "Users can view own progress" on lesson_progress for select using (auth.uid() = user_id);
create policy "Users can track own progress" on lesson_progress for insert with check (auth.uid() = user_id);

alter table certificates enable row level security;
create policy "Users can view own certificates" on certificates for select using (auth.uid() = user_id);
create policy "Service can insert certificates" on certificates for insert with check (auth.uid() = user_id);

alter table learning_paths enable row level security;
create policy "Anyone can view learning paths" on learning_paths for select using (auth.role() = 'authenticated');
create policy "Admins can manage learning paths" on learning_paths for all using (
  exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin')
);

alter table learning_path_courses enable row level security;
create policy "Anyone can view path courses" on learning_path_courses for select using (auth.role() = 'authenticated');
create policy "Admins can manage path courses" on learning_path_courses for all using (
  exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin')
);
