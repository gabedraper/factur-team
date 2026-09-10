/*
 * The index follows the lesson.
 *
 * Editing a lesson used to leave the search returning the old text until
 * somebody remembered to rebuild -- which nobody remembers, and the failure is
 * silent and confident: Gaib quotes a policy that was corrected last week.
 *
 * A course at a time rather than a lesson at a time, because the index keeps
 * one copy of each duplicated lesson and which copy wins is decided within the
 * course. Reindexing a single lesson could add a second copy of something, or
 * drop the only copy. A course is a handful of lessons, so this is cheap.
 *
 * Applied live on 10 September 2026 across three steps -- the per-course
 * rebuild, a fix to the trigger, and title-only passages for video lessons --
 * collapsed here into what ended up running.
 */

/** Rebuild one course. The unit everything else is expressed in. */
create or replace function public.handbook_reindex_course(p_course uuid)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  r        record;
  para     text;
  buffer   text;
  ord      int;
  written  int := 0;
  target   constant int := 1000;
begin
  delete from public.handbook_passages where course_id = p_course;

  for r in
    select distinct on (l.title, md5(coalesce(l.content->>'body','')))
           l.id as lesson_id, l.module_id, m.course_id,
           c.title as course_title, l.title as lesson_title,
           public.handbook_plain(l.content->>'body') as text,
           l.content->>'body' as raw
    from public.lessons l
    join public.modules m on m.id = l.module_id
    join public.courses c on c.id = m.course_id
    where m.course_id = p_course
      and l.content ? 'body'
      and length(coalesce(l.content->>'body','')) > 0
    order by l.title, md5(coalesce(l.content->>'body','')), l.id
  loop
    buffer := '';
    ord := 0;

    /*
     * A lesson that is only a video still deserves to be findable.
     *
     * Ten lessons are a single iframe -- a Loom recording or an embedded
     * dashboard -- with three or four characters of text around it. They
     * produced no passage at all, so somebody asking "how do I reschedule a no
     * show" got nothing, when the answer is a two-minute video sitting in
     * Appointment Setting. Twenty characters rather than zero, because these
     * carry a stray space or bullet around the frame.
     */
    if length(btrim(coalesce(r.text, ''))) < 20 then
      insert into public.handbook_passages
        (lesson_id, module_id, course_id, course_title, lesson_title, ordinal, body)
      values (
        r.lesson_id, r.module_id, r.course_id, r.course_title, r.lesson_title, 1,
        r.lesson_title || E'\n' ||
        case when r.raw ilike '%<iframe%'
             then 'This lesson is a recording or an embedded dashboard rather than written text. Open the lesson to watch it.'
             else 'This lesson has no written text. Open the lesson to see it.'
        end
      );
      written := written + 1;
      continue;
    end if;

    foreach para in array regexp_split_to_array(coalesce(r.text,''), E'\n+') loop
      para := btrim(para);
      continue when para = '';

      if length(buffer) > 0 and length(buffer) + length(para) > target then
        ord := ord + 1;
        insert into public.handbook_passages
          (lesson_id, module_id, course_id, course_title, lesson_title, ordinal, body)
        values (r.lesson_id, r.module_id, r.course_id, r.course_title, r.lesson_title, ord, buffer);
        written := written + 1;
        buffer := para;
      else
        buffer := case when buffer = '' then para else buffer || E'\n' || para end;
      end if;
    end loop;

    if btrim(coalesce(buffer,'')) <> '' then
      ord := ord + 1;
      insert into public.handbook_passages
        (lesson_id, module_id, course_id, course_title, lesson_title, ordinal, body)
      values (r.lesson_id, r.module_id, r.course_id, r.course_title, r.lesson_title, ord, buffer);
      written := written + 1;
    end if;
  end loop;

  return written;
end;
$$;

/** Everything, course by course. */
create or replace function public.handbook_reindex()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  c       record;
  written int := 0;
begin
  delete from public.handbook_passages;
  for c in select id from public.courses loop
    written := written + public.handbook_reindex_course(c.id);
  end loop;
  return written;
end;
$$;

/*
 * One branch per table, and each branch touches only columns that table has.
 *
 * The first version worked out the course with a single CASE over
 * TG_TABLE_NAME whose arms read new.id, new.course_id and new.module_id.
 * plpgsql plans the whole expression, so the arm for modules was planned
 * against a lessons row, lessons has no course_id, and every save raised
 * "record new has no field course_id" -- which the exception handler below
 * dutifully turned into a warning nobody was reading. Saving worked, the index
 * silently never moved, and a search returning last week's text is the kind of
 * wrong that looks right.
 *
 * TG_OP decides which record to read, too: NEW is unassigned on delete and OLD
 * on insert, and reading a field of an unassigned record is an error, not a
 * null.
 *
 * A bulk import can turn this off for its transaction:
 *   set local handbook.suspend_reindex = 'on';
 * then call handbook_reindex() once at the end, rather than rebuilding the
 * same course five hundred times.
 */
create or replace function public.handbook_touch()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  target uuid;
  gone   boolean := (tg_op = 'DELETE');
begin
  if coalesce(current_setting('handbook.suspend_reindex', true), 'off') = 'on' then
    return null;
  end if;

  if tg_table_name = 'courses' then
    if gone then target := old.id; else target := new.id; end if;

  elsif tg_table_name = 'modules' then
    if gone then target := old.course_id; else target := new.course_id; end if;

  else
    -- lessons: the course is one hop away, through the module.
    if gone then
      select m.course_id into target from public.modules m where m.id = old.module_id;
    else
      select m.course_id into target from public.modules m where m.id = new.module_id;
    end if;
  end if;

  if target is not null then
    perform public.handbook_reindex_course(target);
  end if;

  return null;
exception when others then
  -- Never fail a save over a search index. Somebody fixing a typo should not
  -- be told their edit was rejected; a stale index is recoverable by calling
  -- handbook_reindex().
  raise warning 'handbook reindex skipped for % on %: %', tg_op, tg_table_name, sqlerrm;
  return null;
end;
$$;

drop trigger if exists handbook_reindex_on_lesson on public.lessons;
create trigger handbook_reindex_on_lesson
  after insert or update or delete on public.lessons
  for each row execute function public.handbook_touch();

drop trigger if exists handbook_reindex_on_module on public.modules;
create trigger handbook_reindex_on_module
  after insert or update or delete on public.modules
  for each row execute function public.handbook_touch();

-- The course title is copied into every passage, so renaming a course has to
-- rewrite them. Only the title matters here: whether it is published or
-- restricted is read live by the policy, not stored.
drop trigger if exists handbook_reindex_on_course on public.courses;
create trigger handbook_reindex_on_course
  after update of title on public.courses
  for each row when (old.title is distinct from new.title)
  execute function public.handbook_touch();

select public.handbook_reindex();
