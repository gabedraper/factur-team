/*
 * Let an activity be a meeting.
 *
 * opp_activities allowed call, email, task and note. Salesforce keeps meetings
 * in a separate object (Event, not Task), and the constraint was written before
 * anything read it -- 6,331 of them were waiting to come across with nowhere to
 * land.
 *
 * A meeting is not a task. It has a start and an end, it involves other people,
 * and "had a meeting" answers a different question about a pursuit than "sent an
 * email". Folding it into task to satisfy the constraint would lose exactly the
 * distinction the column exists to record.
 */

alter table public.opp_activities
  drop constraint if exists opp_activities_activity_type_check;

alter table public.opp_activities
  add constraint opp_activities_activity_type_check
  check (activity_type = any (array['call', 'email', 'task', 'note', 'meeting']));
