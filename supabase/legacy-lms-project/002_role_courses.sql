-- Role-to-course assignments
create table if not exists role_courses (
  id uuid default gen_random_uuid() primary key,
  role text not null,
  course_id uuid not null references courses(id) on delete cascade,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique(role, course_id)
);

alter table role_courses enable row level security;

create policy "Admins can manage role_courses" on role_courses
  for all using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

create policy "Users can view role_courses" on role_courses
  for select using (true);
