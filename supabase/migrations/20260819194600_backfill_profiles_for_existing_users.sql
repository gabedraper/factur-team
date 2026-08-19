-- handle_new_user() only fires for new sign-ups, so the 41 people who already
-- have scoreboard accounts would have had no LMS profile and no way to get one
-- short of deleting and recreating their account. Backfill them, taking the
-- role from lms_initial_roles and the name from Google metadata, falling back
-- to the rep roster.

insert into public.profiles (id, full_name, role)
select u.id,
       coalesce(
         nullif(u.raw_user_meta_data->>'full_name', ''),
         r.display_name,
         ''
       ),
       coalesce(s.role, 'learner')
  from auth.users u
  left join public.lms_initial_roles s on lower(s.email) = lower(u.email)
  left join public.reps r on r.auth_user_id = u.id
 where lower(split_part(u.email, '@', 2)) in ('bethefactur.com', 'facturmfg.com')
on conflict (id) do nothing;
