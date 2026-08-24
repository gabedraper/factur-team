/*
 * The last of the rules keyed to retired role systems.
 *
 * Three ways of saying "admin" had accumulated: profiles.role, reps.is_admin,
 * and the roles defined in Settings. Only the third is maintained, so the other
 * two silently diverge -- which is what stopped a training admin opening a
 * course this morning. These now ask the same question the app asks.
 *
 * Checked first that nobody holds the old flags without the matching Settings
 * permission, so this takes access away from no one.
 */

-- Role training and learning paths: administering training.
drop policy if exists "Admins can manage role_courses" on public.role_courses;
create policy "Training admins manage role courses" on public.role_courses
  for all to authenticated
  using (public.has_permission('lms.admin'))
  with check (public.has_permission('lms.admin'));

drop policy if exists "Admins can manage learning paths" on public.learning_paths;
create policy "Training admins manage learning paths" on public.learning_paths
  for all to authenticated
  using (public.has_permission('lms.admin'))
  with check (public.has_permission('lms.admin'));

drop policy if exists "Admins can manage path courses" on public.learning_path_courses;
create policy "Training admins manage path courses" on public.learning_path_courses
  for all to authenticated
  using (public.has_permission('lms.admin'))
  with check (public.has_permission('lms.admin'));

-- Scoring weights: there is a permission in Settings for exactly this.
drop policy if exists "effort_weights_admin_write" on public.effort_weights;
create policy "effort_weights_write" on public.effort_weights
  for all to authenticated
  using (public.has_permission('scoreboard.weights.edit'))
  with check (public.has_permission('scoreboard.weights.edit'));

drop policy if exists "deal_weights_admin_write" on public.deal_weights;
create policy "deal_weights_write" on public.deal_weights
  for all to authenticated
  using (public.has_permission('scoreboard.weights.edit'))
  with check (public.has_permission('scoreboard.weights.edit'));
