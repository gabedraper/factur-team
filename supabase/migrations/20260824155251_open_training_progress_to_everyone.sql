/*
 * Training progress is open to the whole company, the same way hustle points
 * and deals are.
 *
 * Reading was restricted to your own rows, with an extra rule for admins keyed
 * to profiles.role -- the role system the app was migrated off. The effect was
 * that Team Progress showed managers nothing at all: the page asked for their
 * reports' enrolments and the database returned an empty list rather than an
 * error, so it looked like nobody had been enrolled.
 *
 * Writing is untouched: you still only record your own progress.
 */
create policy "Factur users view all enrollments" on public.enrollments
  for select to authenticated using (public.is_factur_user());

create policy "Factur users view all certificates" on public.certificates
  for select to authenticated using (public.is_factur_user());

create policy "Factur users view all progress" on public.lesson_progress
  for select to authenticated using (public.is_factur_user());

-- This one also asked the dead profiles.role. Managing enrolments is an
-- administrative act, so it follows the Settings permission instead.
drop policy if exists "Admins can manage all enrollments" on public.enrollments;

create policy "Training admins manage all enrollments" on public.enrollments
  for all to authenticated
  using (public.has_permission('lms.admin'))
  with check (public.has_permission('lms.admin'));
