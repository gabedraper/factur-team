-- Admins can fully manage courses, modules, and lessons regardless of
-- ownership (previously only the owning instructor or a published-course
-- viewer could read/write these, which blocked admins from editing other
-- instructors' courses, including drafts).
create policy "Admins can manage courses" on courses
  for all using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy "Admins can manage modules" on modules
  for all using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy "Admins can manage lessons" on lessons
  for all using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));
