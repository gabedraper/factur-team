/*
 * A catch-up pass, because the triggers cannot see two things.
 *
 * Enrolment is keyed on profiles, which exist only once somebody has signed in
 * with Google -- twenty-eight active members never have. Assign one of them a
 * role today and the trigger finds nobody to enrol; without this they would
 * still have nothing on the day they first sign in.
 *
 * The other is publishing. A course attached to a role while unpublished
 * enrols nobody, deliberately, because a locked door is worse than an empty
 * list. When it is published, nothing writes to role_courses or
 * org_assignments, so no trigger fires. This notices.
 *
 * Hourly and cheap: it inserts only what is missing, so on a normal run it
 * does nothing at all.
 */

select cron.unschedule('role-training-catch-up')
where exists (select 1 from cron.job where jobname = 'role-training-catch-up');

select cron.schedule(
  'role-training-catch-up',
  '50 * * * *',
  $cron$select public.enrol_for_role_training();$cron$
);
