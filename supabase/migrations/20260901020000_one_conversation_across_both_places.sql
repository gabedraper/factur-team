/*
 * One conversation, wherever it is being had.
 *
 * Somebody who asks Gaib something on their phone on the way in and then opens
 * the app at their desk is having one conversation. Keying the Chat side on the
 * space made that two, and made them repeat themselves for having changed
 * window -- which is what makes an assistant feel like two assistants.
 *
 * Where a line was said is still worth keeping. Reading a transcript back and
 * seeing that half of it happened on a phone at the weekend explains its tone.
 * Everything said before today was in the app, hence the default.
 */
alter table public.gaib_messages
  add column if not exists channel text not null default 'app'
    check (channel in ('app', 'google_chat'));

/*
 * Where to find somebody in Chat, so Gaib can start a conversation rather than
 * only answer one.
 *
 * Recorded the first time they message Gaib, because a direct message space
 * does not exist until somebody opens one. That is the whole shape of the
 * limitation and it cannot be engineered around: Gaib can only ever speak first
 * to somebody who has spoken to it once.
 */
create table if not exists public.gaib_chat_spaces (
  user_id uuid primary key references auth.users(id) on delete cascade,
  space_name text not null,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

alter table public.gaib_chat_spaces enable row level security;

drop policy if exists gaib_chat_spaces_read on public.gaib_chat_spaces;
create policy gaib_chat_spaces_read on public.gaib_chat_spaces
  for select to authenticated
  using (public.is_factur_user() and (user_id = auth.uid() or public.has_permission('org.manage')));
