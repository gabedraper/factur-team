-- Copy LMS course content from the old project (esadbpqlskiwjijhghys) into
-- this one. Run in the SQL editor of the TARGET project, ripnymdxplmoflpwmqwl.
--
-- Replace PASTE_SOURCE_CONNECTION_STRING_HERE below with the old project's
-- connection URI (Supabase dashboard -> Project Settings -> Database ->
-- Connection string -> URI, with your database password filled in).
--
-- Safe to re-run: every insert is ON CONFLICT DO NOTHING.
--
-- Only content moves. Profiles are deliberately NOT copied -- identities in
-- this project come from its own auth.users, and profiles were backfilled in
-- migration 20260819194600. Content ownership is remapped by email instead.

create extension if not exists dblink;

select dblink_connect('lms_src', 'PASTE_SOURCE_CONNECTION_STRING_HERE');

-- Old user id -> new user id, matched on email. gabe@gabedraper.com is a
-- personal address that does not exist in this project; it owns 148 of the 151
-- courses, so it is redirected to the work account by hand.
create temp table user_map as
with src as (
  select * from dblink('lms_src', 'select id, email from auth.users')
    as t(id uuid, email text)
),
remapped as (
  select s.id as old_id,
         case lower(s.email)
           when 'gabe@gabedraper.com'   then 'gabe@bethefactur.com'
           when 'miljan@bethefactury.com' then 'miljan@bethefactur.com'
           else lower(s.email)
         end as target_email
    from src s
)
select r.old_id, u.id as new_id
  from remapped r
  join auth.users u on lower(u.email) = r.target_email;

insert into public.learning_paths (id, name, description, target_role, created_by, created_at)
select p.id, p.name, p.description, p.target_role, m.new_id, p.created_at
  from dblink('lms_src',
       'select id, name, description, target_role, created_by, created_at from public.learning_paths')
       as p(id uuid, name text, description text, target_role text, created_by uuid, created_at timestamptz)
  left join user_map m on m.old_id = p.created_by
on conflict (id) do nothing;

insert into public.courses (id, title, description, thumbnail_url, instructor_id, is_published, created_at)
select c.id, c.title, c.description, c.thumbnail_url, m.new_id, c.is_published, c.created_at
  from dblink('lms_src',
       'select id, title, description, thumbnail_url, instructor_id, is_published, created_at from public.courses')
       as c(id uuid, title text, description text, thumbnail_url text, instructor_id uuid, is_published boolean, created_at timestamptz)
  left join user_map m on m.old_id = c.instructor_id
on conflict (id) do nothing;

insert into public.modules (id, course_id, title, "position")
select * from dblink('lms_src',
       'select id, course_id, title, "position" from public.modules')
       as t(id uuid, course_id uuid, title text, "position" integer)
on conflict (id) do nothing;

insert into public.lessons (id, module_id, title, type, content, "position", duration_minutes, owner_id)
select l.id, l.module_id, l.title, l.type, l.content, l."position", l.duration_minutes, m.new_id
  from dblink('lms_src',
       'select id, module_id, title, type, content, "position", duration_minutes, owner_id from public.lessons')
       as l(id uuid, module_id uuid, title text, type text, content jsonb, "position" integer, duration_minutes integer, owner_id uuid)
  left join user_map m on m.old_id = l.owner_id
on conflict (id) do nothing;

insert into public.learning_path_courses (id, path_id, course_id, "position")
select * from dblink('lms_src',
       'select id, path_id, course_id, "position" from public.learning_path_courses')
       as t(id uuid, path_id uuid, course_id uuid, "position" integer)
on conflict (id) do nothing;

insert into public.enrollments (id, user_id, course_id, enrolled_at, completed_at, deadline)
select e.id, m.new_id, e.course_id, e.enrolled_at, e.completed_at, e.deadline
  from dblink('lms_src',
       'select id, user_id, course_id, enrolled_at, completed_at, deadline from public.enrollments')
       as e(id uuid, user_id uuid, course_id uuid, enrolled_at timestamptz, completed_at timestamptz, deadline timestamptz)
  join user_map m on m.old_id = e.user_id
on conflict (id) do nothing;

select dblink_disconnect('lms_src');

-- What landed, and whether anything lost its owner on the way across.
select (select count(*) from public.courses)        as courses,
       (select count(*) from public.modules)        as modules,
       (select count(*) from public.lessons)        as lessons,
       (select count(*) from public.learning_paths) as paths,
       (select count(*) from public.enrollments)    as enrollments,
       (select count(*) from public.courses where instructor_id is null) as courses_without_instructor;
