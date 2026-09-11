/*
 * Reading a whole room, not just the messages that mention Gaib.
 *
 * last_read_at is how far the reader has got; read_status says whether it can
 * read at all -- until a Workspace admin approves chat.app.messages.readonly
 * Google refuses the listing, and that is recorded rather than looking like a
 * quiet room.
 *
 * gaib_room_seen makes each message count once. The reader runs every minute
 * and a slow run can overlap the next; a message claimed here is never
 * answered twice.
 */
alter table public.gaib_rooms
  add column if not exists last_read_at timestamptz,
  add column if not exists read_status text;

create table if not exists public.gaib_room_seen (
  message_name text primary key,
  space_name   text not null,
  decided      text,
  seen_at      timestamptz not null default now()
);

alter table public.gaib_room_seen enable row level security;
