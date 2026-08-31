/*
 * Training attached to a role reaches the people in that role, both ways
 * round: assign a course to a role and everyone in it is enrolled; give
 * somebody a role and they get that role's courses.
 *
 * Done in the database rather than in the two server actions that happen to
 * assign roles today. There are already three paths that write org_assignments
 * -- the People screen, the self-service role picker, and the standalone role
 * checkboxes -- and a fourth will be written eventually. A rule enforced where
 * the rows are written cannot be forgotten by the next thing that writes them.
 *
 * It only ever adds. Losing a role does not remove the training: someone who
 * has finished a course has a completion record worth keeping, and someone
 * half way through would lose their progress to a job change. Withdrawing
 * training is a deliberate act, so it stays a manual one.
 */

create or replace function public.enrol_for_role_training(
  p_member_id uuid default null,
  p_role_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  added integer;
begin
  /*
   * Enrolment is keyed on profiles, which exist only once somebody has signed
   * in with Google. Twenty-eight active members have never signed in, so they
   * simply do not match here yet -- the scheduled catch-up enrols them on the
   * day they first appear rather than losing the assignment.
   */
  with wanted as (
    select distinct m.auth_user_id as user_id, rc.course_id
    from org_assignments a
    join org_members m on m.id = a.member_id
    join role_courses rc on rc.role_id = a.role_id
    join courses c on c.id = rc.course_id
    where m.auth_user_id is not null
      and m.active
      -- An unpublished course cannot be taken, so enrolling in it would only
      -- show people a locked door. The catch-up picks it up once published.
      and c.is_published
      and (p_member_id is null or a.member_id = p_member_id)
      and (p_role_id   is null or a.role_id   = p_role_id)
  ),
  inserted as (
    insert into enrollments (user_id, course_id)
    select w.user_id, w.course_id from wanted w
    on conflict (user_id, course_id) do nothing
    returning 1
  )
  select count(*) into added from inserted;

  return added;
end;
$$;

comment on function public.enrol_for_role_training(uuid, uuid) is
  'Enrols people into the published courses attached to their roles. Adds only, never removes. Null arguments mean "everyone" / "every role".';

/* --- both directions, at the point the rows are written ----------------- */

create or replace function public.tg_enrol_on_role_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.enrol_for_role_training(p_member_id => new.member_id);
  return null;
end;
$$;

drop trigger if exists enrol_on_role_assignment on org_assignments;
create trigger enrol_on_role_assignment
  after insert on org_assignments
  for each row execute function public.tg_enrol_on_role_assignment();

create or replace function public.tg_enrol_on_role_course()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.enrol_for_role_training(p_role_id => new.role_id);
  return null;
end;
$$;

drop trigger if exists enrol_on_role_course on role_courses;
create trigger enrol_on_role_course
  after insert on role_courses
  for each row execute function public.tg_enrol_on_role_course();
