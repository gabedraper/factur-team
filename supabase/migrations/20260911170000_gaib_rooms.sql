/*
 * Gaib in shared Chat spaces.
 *
 * gaib_chat_spaces is one private conversation per person and must stay that
 * way -- it is where "your fix is live" gets sent. Rooms are a different thing
 * and get their own table, so a room can never be mistaken for somebody's
 * private channel. Mixing the two was the bug this replaces: the first time a
 * person spoke to Gaib in a room, their private channel was overwritten with
 * the room, and their private notices would have gone to everyone in it.
 */
create table if not exists public.gaib_rooms (
  space_name   text primary key,
  display_name text,
  added_at     timestamptz not null default now(),
  last_seen    timestamptz not null default now(),
  /*
   * The daily test post. Null means Gaib is in the room but not running a
   * testing programme there.
   *   { "tracks": [ { "name", "topic", "emails": [...] | "everyone" } ] }
   */
  testing jsonb
);

/*
 * Chat's own id for a person, learned the first time they message Gaib. A
 * message mentions somebody with <users/1234...>; an email address in the text
 * does not ping anyone. Until someone has spoken to Gaib once, they are named
 * in plain text instead.
 */
create table if not exists public.gaib_chat_people (
  email        text primary key,
  chat_user    text not null,
  display_name text,
  seen_at      timestamptz not null default now()
);

-- One test post per room per day, so a scheduler that fires twice posts once.
create table if not exists public.gaib_room_tests (
  id          bigint generated always as identity primary key,
  space_name  text not null references public.gaib_rooms(space_name) on delete cascade,
  for_date    date not null,
  track       text not null,
  subject     text not null,
  message     text not null,
  posted_at   timestamptz not null default now(),
  unique (space_name, for_date)
);

-- Service-only. Nothing in the app reads these through a user's session.
alter table public.gaib_rooms        enable row level security;
alter table public.gaib_chat_people  enable row level security;
alter table public.gaib_room_tests   enable row level security;

-- Where a ticket was raised, so its updates go back to the same room.
alter table public.gaib_tickets
  add column if not exists origin_space text;

comment on column public.gaib_tickets.origin_space is
  'The shared Chat space the ticket was raised in, if any. Its status changes are posted back there.';

/*
 * Search the handbook for a room rather than a person.
 *
 * Row security answers "what may the asker read". In a shared space the answer
 * is read by everybody there, and the asker being the CEO does not make the
 * room entitled to the payroll course. p_public_only holds restricted material
 * back whoever asked. The two-argument version is dropped so the unfiltered
 * one cannot be reached by accident with a stale call.
 */
drop function if exists public.handbook_search(text, int);

create or replace function public.handbook_search(
  p_query text,
  p_limit int default 6,
  p_public_only boolean default false
)
returns table (course text, lesson text, passage text, lesson_id uuid, rank real)
language sql
stable
security invoker
set search_path to 'public', 'pg_catalog'
as $$
  with q as (select websearch_to_tsquery('english', coalesce(p_query, '')) as tsq)
  select p.course_title, p.lesson_title, p.body, p.lesson_id, ts_rank(p.tsv, q.tsq)
  from public.handbook_passages p, q
  where q.tsq is not null
    and q.tsq <> ''::tsquery
    and p.tsv @@ q.tsq
    and (not p_public_only or not public.module_is_restricted(p.module_id))
  order by 5 desc, p.course_title, p.ordinal
  limit greatest(1, least(coalesce(p_limit, 6), 12));
$$;

grant execute on function public.handbook_search(text, int, boolean) to authenticated, service_role;
