/*
 * Gaib -- the app asking how it is doing, and doing something about the answer.
 *
 * The bug report widget it replaces was a form that became an email. Nobody
 * could see what had been reported, nothing linked a report to a fix, and the
 * only record was in one inbox. Worse, it only ever heard from people annoyed
 * enough to open it, which is a biased sample of a much larger silence.
 *
 * Three tables carry the whole loop. A session is a conversation. A ticket is
 * something that came out of that conversation and has to be done. The events
 * are what happened to the ticket afterwards, kept separately because a status
 * column tells you where a thing is and never how it got there -- and when an
 * agent is allowed to change production on its own, how it got there is the
 * part you will want to read.
 */

-- ---------------------------------------------------------------------------
-- Conversations
-- ---------------------------------------------------------------------------

create table if not exists public.gaib_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Written by Gaib once there is enough to name, so the list reads as a list
  -- of subjects rather than of dates.
  title text,
  -- Who spoke first. A conversation Gaib opened is a different thing from one
  -- somebody came to it with, and the difference matters when reading whether
  -- the proactive asking is working at all.
  opened_by text not null default 'user' check (opened_by in ('user', 'gaib')),
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create index if not exists gaib_sessions_user_idx
  on public.gaib_sessions (user_id, last_message_at desc);

/*
 * Both the words and the blocks.
 *
 * `content` is what a person reads: it renders in the transcript and it is what
 * gets quoted into a ticket. `blocks` is the raw content array the API returned,
 * including tool calls and their results, and it exists because the next turn
 * has to replay the conversation exactly as it happened. Rebuilding blocks from
 * text loses the tool calls, and a conversation missing its tool calls makes
 * Gaib raise the same ticket twice.
 */
create table if not exists public.gaib_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.gaib_sessions(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null default '',
  blocks jsonb,
  -- Where the person was standing when they said it. Half of all bug reports
  -- are answered by this field alone.
  page_url text,
  created_at timestamptz not null default now()
);

create index if not exists gaib_messages_session_idx
  on public.gaib_messages (session_id, created_at);

-- ---------------------------------------------------------------------------
-- Tickets
-- ---------------------------------------------------------------------------

/*
 * One thing that has to be done, and which of three roads it takes.
 *
 * lane is the decision that matters:
 *
 *   auto      a bug, safe to fix, ships itself
 *   approval  a bug that touches something that can hurt -- fix goes to a PR
 *   scoping   an idea or improvement. Nothing is built. The agent writes up
 *             what it would take and stops, and it waits for a person.
 *
 * Gaib proposes the lane from the conversation. It is not trusted with it: the
 * workflow recomputes the lane from the diff the agent actually produced, and a
 * fix that wandered into a migration or into billing loses its auto lane at
 * that point regardless of what anyone decided at the start. The model
 * classifies; the guard enforces. Only one of those two is allowed to be wrong.
 */
create table if not exists public.gaib_tickets (
  id uuid primary key default gen_random_uuid(),
  -- A number people can say out loud. "Gaib 14" beats a uuid in conversation.
  ref bigint generated always as identity,
  session_id uuid references public.gaib_sessions(id) on delete set null,
  raised_by uuid references auth.users(id) on delete set null,

  kind text not null check (kind in ('bug', 'idea')),
  title text not null,
  -- Gaib's write-up: what happens, what should happen, how to see it.
  body text not null default '',
  page_url text,
  severity text not null default 'annoying'
    check (severity in ('blocking', 'painful', 'annoying', 'cosmetic')),

  lane text not null check (lane in ('auto', 'approval', 'scoping')),
  -- Why Gaib put it in that lane, in its own words. Read this when a lane
  -- looks wrong; it is usually the description that was wrong, not the rule.
  lane_reason text,

  status text not null default 'new' check (status in (
    'new',            -- raised, not yet handed to the agent
    'queued',         -- dispatched to GitHub, waiting for a runner
    'running',        -- agent working
    'awaiting_review',-- a PR or a scoped brief is sitting there for a person
    'shipped',        -- merged and deployed
    'rejected',       -- looked at and declined
    'failed',         -- the agent could not finish
    'duplicate'
  )),

  -- What the agent produced. brief is the whole plan for a scoping ticket; for
  -- a bug it is the agent's account of what it changed and why.
  brief text,
  pr_url text,
  commit_sha text,
  run_url text,
  -- Set when the deterministic guard overrode the lane, with the paths that
  -- caused it. Non-null here means "Gaib thought this was safe and it was not",
  -- which is the single most useful thing to review.
  guard_tripped text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

create index if not exists gaib_tickets_status_idx
  on public.gaib_tickets (status, created_at desc);
create index if not exists gaib_tickets_raiser_idx
  on public.gaib_tickets (raised_by, created_at desc);
create index if not exists gaib_tickets_session_idx
  on public.gaib_tickets (session_id);

/*
 * What happened to the ticket, in order.
 *
 * Kept apart from the status column because the column answers "where is it"
 * and this answers "what did it do", and the second question is the one asked
 * after something ships that should not have. Every actor writes here --
 * including the agent, which is the only participant that cannot be asked
 * afterwards what it was thinking.
 */
create table if not exists public.gaib_ticket_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.gaib_tickets(id) on delete cascade,
  actor text not null check (actor in ('gaib', 'agent', 'person', 'system')),
  -- Free text on purpose. A fixed vocabulary here would need widening every
  -- time the agent learns to do something new.
  event text not null,
  detail text,
  created_at timestamptz not null default now()
);

create index if not exists gaib_ticket_events_ticket_idx
  on public.gaib_ticket_events (ticket_id, created_at);

-- ---------------------------------------------------------------------------
-- Asking people, without becoming a nuisance
-- ---------------------------------------------------------------------------

/*
 * When each person was last asked how things are going.
 *
 * The whole value of asking unprompted is that it reaches people who would
 * never open a bug form. That value survives exactly as long as the asking
 * stays rare. One row per person, and the rule lives in one place so it cannot
 * drift between the badge and the opening line.
 */
create table if not exists public.gaib_nudges (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_nudged_at timestamptz,
  -- Set when they actually said something back, which is what decides whether
  -- to slow down on someone who never engages.
  last_answered_at timestamptz,
  nudge_count integer not null default 0,
  answered_count integer not null default 0,
  -- Their own switch. Nothing overrides it.
  muted boolean not null default false
);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

/*
 * Everything is written by the server with the service role, so these policies
 * are about reading only.
 *
 * A person reads their own conversations and their own tickets. Whoever holds
 * org.manage reads everything, because someone has to be able to review what
 * an agent did on the strength of a chat nobody else saw.
 */

alter table public.gaib_sessions enable row level security;
alter table public.gaib_messages enable row level security;
alter table public.gaib_tickets enable row level security;
alter table public.gaib_ticket_events enable row level security;
alter table public.gaib_nudges enable row level security;

drop policy if exists gaib_sessions_read on public.gaib_sessions;
create policy gaib_sessions_read on public.gaib_sessions
  for select to authenticated
  using (
    public.is_factur_user()
    and (user_id = auth.uid() or public.has_permission('org.manage'))
  );

drop policy if exists gaib_messages_read on public.gaib_messages;
create policy gaib_messages_read on public.gaib_messages
  for select to authenticated
  using (
    public.is_factur_user()
    and exists (
      select 1 from public.gaib_sessions s
       where s.id = session_id
         and (s.user_id = auth.uid() or public.has_permission('org.manage'))
    )
  );

drop policy if exists gaib_tickets_read on public.gaib_tickets;
create policy gaib_tickets_read on public.gaib_tickets
  for select to authenticated
  using (
    public.is_factur_user()
    and (raised_by = auth.uid() or public.has_permission('org.manage'))
  );

drop policy if exists gaib_ticket_events_read on public.gaib_ticket_events;
create policy gaib_ticket_events_read on public.gaib_ticket_events
  for select to authenticated
  using (
    public.is_factur_user()
    and exists (
      select 1 from public.gaib_tickets t
       where t.id = ticket_id
         and (t.raised_by = auth.uid() or public.has_permission('org.manage'))
    )
  );

drop policy if exists gaib_nudges_read on public.gaib_nudges;
create policy gaib_nudges_read on public.gaib_nudges
  for select to authenticated
  using (public.is_factur_user() and user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Keeping updated_at honest
-- ---------------------------------------------------------------------------

create or replace function public.gaib_touch_ticket()
returns trigger
language plpgsql
-- Pinned, so nothing this trigger calls can be shadowed by a schema that
-- happens to come first on someone else's search path.
set search_path = pg_catalog
as $$
begin
  new.updated_at := now();
  -- A ticket that reached a resting state stamps its own closing time, so
  -- nothing has to remember to do it at each of the four call sites that can
  -- put it there.
  if new.status in ('shipped', 'rejected', 'duplicate') and old.status <> new.status then
    new.closed_at := coalesce(new.closed_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists gaib_tickets_touch on public.gaib_tickets;
create trigger gaib_tickets_touch
  before update on public.gaib_tickets
  for each row execute function public.gaib_touch_ticket();
