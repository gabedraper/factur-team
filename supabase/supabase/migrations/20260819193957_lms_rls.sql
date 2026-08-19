-- RLS for the LMS tables, ported from the old project's migrations 001-005.
--
-- One tightening applied throughout: the original policies granted reads to
-- any `authenticated` session, and several used a bare `using (true)`. In this
-- project that would hand course content to any Google account that completed
-- sign-in, so every read is additionally gated on public.is_factur_user() --
-- the same check protecting the Salesforce tables.

alter table public.profiles              enable row level security;
alter table public.learning_paths        enable row level security;
alter table public.courses               enable row level security;
alter table public.learning_path_courses enable row level security;
alter table public.modules               enable row level security;
alter table public.lessons               enable row level security;
alter table public.role_courses          enable row level security;
alter table public.enrollments           enable row level security;
alter table public.lesson_progress       enable row level security;
alter table public.certificates          enable row level security;
alter table public.lms_initial_roles     enable row level security;

-- lms_initial_roles is consulted by handle_new_user(), which is SECURITY
-- DEFINER and so bypasses RLS. No policy = nobody reads it over the API.

create policy "Factur users can view profiles" on public.profiles
  for select using (public.is_factur_user());
create policy "Users can update own profile" on public.profiles
  for update using (auth.uid() = id);

create policy "Factur users can view published courses" on public.courses
  for select using (public.is_factur_user() and (is_published = true or auth.uid() = instructor_id));
create policy "Instructors can insert courses" on public.courses
  for insert with check (auth.uid() = instructor_id);
create policy "Instructors can update own courses" on public.courses
  for update using (auth.uid() = instructor_id);
create policy "Admins can manage courses" on public.courses
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

create policy "Factur users can view modules" on public.modules
  for select using (public.is_factur_user());
create policy "Instructors can manage modules" on public.modules
  for all using (
    exists (select 1 from public.courses c where c.id = modules.course_id and c.instructor_id = auth.uid())
  );
create policy "Admins can manage modules" on public.modules
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

create policy "Factur users can view lessons" on public.lessons
  for select using (public.is_factur_user());
create policy "Instructors can manage lessons" on public.lessons
  for all using (
    exists (
      select 1 from public.modules m
        join public.courses c on c.id = m.course_id
       where m.id = lessons.module_id and c.instructor_id = auth.uid()
    )
  );
create policy "Admins can manage lessons" on public.lessons
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

create policy "Factur users can view role_courses" on public.role_courses
  for select using (public.is_factur_user());
create policy "Admins can manage role_courses" on public.role_courses
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

create policy "Users can view own enrollments" on public.enrollments
  for select using (auth.uid() = user_id);
create policy "Users can enroll" on public.enrollments
  for insert with check (auth.uid() = user_id);
create policy "Users can update own enrollment" on public.enrollments
  for update using (auth.uid() = user_id);
create policy "Admins can manage all enrollments" on public.enrollments
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

create policy "Users can view own progress" on public.lesson_progress
  for select using (auth.uid() = user_id);
create policy "Users can track own progress" on public.lesson_progress
  for insert with check (auth.uid() = user_id);

create policy "Users can view own certificates" on public.certificates
  for select using (auth.uid() = user_id);
create policy "Service can insert certificates" on public.certificates
  for insert with check (auth.uid() = user_id);

create policy "Factur users can view learning paths" on public.learning_paths
  for select using (public.is_factur_user());
create policy "Admins can manage learning paths" on public.learning_paths
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

create policy "Factur users can view path courses" on public.learning_path_courses
  for select using (public.is_factur_user());
create policy "Admins can manage path courses" on public.learning_path_courses
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
