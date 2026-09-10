/*
 * The handbook, in pieces small enough to answer with.
 *
 * Four million characters of Guru HTML sit in lessons.content as
 * {"body": "<h2 class=...>"}. Whole rows are the wrong unit for a question:
 * one Brand Guides lesson is 280,000 characters, so fetching it to answer
 * "what is our parental leave policy" costs more than a whole conversation
 * holds and buries the two sentences that matter.
 *
 * So the text is stripped of markup, cut at paragraph boundaries into passages
 * of about a thousand characters, and indexed. A search returns the four or
 * five passages that match and the lesson they came from -- an answer with a
 * source, instead of a wall.
 *
 * Derived data: rebuilt from lessons by handbook_reindex(), not edited.
 *
 * Applied against the live database on 10 September 2026 in three steps
 * (table, dedupe fix, search function); collapsed here into the shape that
 * ended up running.
 */

create table if not exists public.handbook_passages (
  id            bigint generated always as identity primary key,
  lesson_id     uuid not null references public.lessons(id) on delete cascade,
  module_id     uuid not null,
  course_id     uuid not null,
  course_title  text not null,
  lesson_title  text not null,
  ordinal       int  not null,
  body          text not null,
  -- Titles are searched alongside the text: somebody asking about "TriNet"
  -- should find those lessons even where the word is only in the heading.
  tsv tsvector generated always as (
    to_tsvector('english',
      coalesce(course_title,'') || ' ' || coalesce(lesson_title,'') || ' ' || coalesce(body,''))
  ) stored
);

create index if not exists handbook_passages_tsv on public.handbook_passages using gin (tsv);
create index if not exists handbook_passages_lesson on public.handbook_passages (lesson_id);

/*
 * The same rule as the lessons themselves. A passage is a copy of restricted
 * text and has to be as hard to read as its original -- an index that forgets
 * that is a way round the permission it was built beside.
 */
alter table public.handbook_passages enable row level security;

drop policy if exists "Factur users read handbook passages" on public.handbook_passages;
create policy "Factur users read handbook passages"
  on public.handbook_passages for select
  using (
    (select public.is_factur_user())
    and (
      (select public.handbook_can_read_restricted())
      or not public.module_is_restricted(module_id)
    )
  );

/** Markup out, readable text in. */
create or replace function public.handbook_plain(p_html text)
returns text
language sql
immutable
as $$
  select btrim(
    regexp_replace(
      replace(replace(replace(replace(replace(replace(
        regexp_replace(
          -- Block ends become line breaks first, so paragraphs survive the tag
          -- strip and there is something to cut on later.
          regexp_replace(p_html, '</(p|h[1-6]|li|tr|div|blockquote)>|<br[^>]*>', E'\n', 'gi'),
          '<[^>]*>', ' ', 'g'),
        '&nbsp;', ' '), '&amp;', '&'), '&lt;', '<'), '&gt;', '>'), '&#39;', ''''), '&quot;', '"'),
      '[ \t]+', ' ', 'g')
  );
$$;

/**
 * Rebuild the index from the lessons.
 *
 * One copy of each lesson: the Guru import produced 103 byte-identical
 * duplicates out of 511, and searching returned every hit doubled -- which
 * reads as a broken search long before anybody guesses the data is doubled.
 * Deduplicated here rather than in the lessons themselves, because progress
 * records point at lesson rows and deleting one is a separate decision with
 * somebody's completed training attached to it.
 *
 * Whole-table rebuild: seconds on five hundred lessons, and an incremental
 * path is a second thing to get wrong for no gain at this size.
 */
create or replace function public.handbook_reindex()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  r          record;
  para       text;
  buffer     text;
  ord        int;
  written    int := 0;
  target     constant int := 1000;
begin
  delete from public.handbook_passages;

  for r in
    select distinct on (m.course_id, l.title, md5(coalesce(l.content->>'body','')))
           l.id as lesson_id, l.module_id, m.course_id,
           c.title as course_title, l.title as lesson_title,
           public.handbook_plain(l.content->>'body') as text
    from public.lessons l
    join public.modules m on m.id = l.module_id
    join public.courses c on c.id = m.course_id
    where l.content ? 'body'
      and length(coalesce(l.content->>'body','')) > 0
    order by m.course_id, l.title, md5(coalesce(l.content->>'body','')), l.id
  loop
    buffer := '';
    ord := 0;

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

/*
 * Ask the handbook a question, get the passages that answer it.
 *
 * Runs as the caller, so the row security above applies exactly as it does to
 * the lessons -- pay and finance material is simply absent for somebody
 * without lms.restricted, with no second rule to keep in step.
 *
 * websearch_to_tsquery rather than plainto_: people type questions, and it
 * copes with quoted phrases and a stray "or". It can still produce an empty
 * query from a sentence of stop words, in which case nothing matches, which is
 * the honest answer.
 */
create or replace function public.handbook_search(p_query text, p_limit int default 6)
returns table (
  course text,
  lesson text,
  passage text,
  lesson_id uuid,
  rank real
)
language sql
stable
security invoker
set search_path to 'public', 'pg_catalog'
as $$
  with q as (
    select websearch_to_tsquery('english', coalesce(p_query, '')) as tsq
  )
  select p.course_title,
         p.lesson_title,
         p.body,
         p.lesson_id,
         ts_rank(p.tsv, q.tsq) as rank
  from public.handbook_passages p, q
  where q.tsq is not null
    and q.tsq <> ''::tsquery
    and p.tsv @@ q.tsq
  order by rank desc, p.course_title, p.ordinal
  limit greatest(1, least(coalesce(p_limit, 6), 12));
$$;

grant execute on function public.handbook_search(text, int) to authenticated, service_role;

-- Everything with content goes live. Five empty test shells stay unpublished.
update public.courses c
   set is_published = true
 where not c.is_published
   and exists (
     select 1 from public.modules m
     join public.lessons l on l.module_id = m.id
     where m.course_id = c.id and length(coalesce(l.content::text,'')) > 0
   );

select public.handbook_reindex();
