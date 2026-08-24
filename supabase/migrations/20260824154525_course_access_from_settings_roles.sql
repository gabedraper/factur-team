/*
 * Course access follows the roles defined in Settings.
 *
 * These rules still asked is_admin(), which reads profiles.role -- the role
 * system the app was migrated off. Anyone made a training admin in Settings was
 * therefore refused by the database, and because an unpublished course is
 * *hidden* rather than reported as forbidden, the editor could not tell the
 * difference between "no such course" and "not allowed" and sat on a spinner.
 *
 * Authors and training admins now see and edit every course, published or not.
 * Everyone else keeps what they had: published courses, plus their own.
 */
create or replace function public.can_author_training()
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select public.has_permission('lms.instruct') or public.has_permission('lms.admin');
$$;

grant execute on function public.can_author_training() to authenticated, service_role;

-- courses
drop policy if exists "Admins can manage courses" on public.courses;
drop policy if exists "Instructors can insert courses" on public.courses;
drop policy if exists "Instructors can update own courses" on public.courses;
drop policy if exists "Factur users can view published courses" on public.courses;

create policy "Authors and admins manage every course" on public.courses
  for all to authenticated
  using (public.can_author_training())
  with check (public.can_author_training());

create policy "Factur users view published courses" on public.courses
  for select to authenticated
  using (
    public.is_factur_user()
    and (is_published = true or auth.uid() = instructor_id)
  );

-- modules
drop policy if exists "Admins can manage modules" on public.modules;
drop policy if exists "Instructors can manage modules" on public.modules;

create policy "Authors and admins manage every module" on public.modules
  for all to authenticated
  using (public.can_author_training())
  with check (public.can_author_training());

-- lessons
drop policy if exists "Admins can manage lessons" on public.lessons;
drop policy if exists "Instructors can manage lessons" on public.lessons;

create policy "Authors and admins manage every lesson" on public.lessons
  for all to authenticated
  using (public.can_author_training())
  with check (public.can_author_training());
