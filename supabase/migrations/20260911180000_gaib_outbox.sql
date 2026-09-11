/*
 * Things Gaib has been asked to say that nobody asked it in the moment.
 *
 * Only the deployed app holds the key that posts as Gaib, so anything that
 * needs to speak outside a live conversation -- a correction to an answer that
 * turned out wrong, say -- is written here and sent by the delivery job that
 * already runs every ten minutes. No new endpoint to protect, and every
 * message sent this way is kept, with who queued it and what came of it.
 *
 * Service-only: row security on, no policy, so nothing reachable through a
 * person's session can queue a message.
 */
create table if not exists public.gaib_outbox (
  id          bigint generated always as identity primary key,
  space_name  text not null,
  text        text not null,
  thread_name text,
  reason      text not null,
  queued_by   text not null,
  queued_at   timestamptz not null default now(),
  sent_at     timestamptz,
  error       text
);

alter table public.gaib_outbox enable row level security;

create index if not exists gaib_outbox_pending on public.gaib_outbox (queued_at) where sent_at is null;
