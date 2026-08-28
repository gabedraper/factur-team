/*
 * Going back to the person who told you.
 *
 * Somebody reports a broken page, Gaib thanks them, and that is the last they
 * ever hear. The fix ships an hour later and they never find out, so the next
 * time something breaks they do not bother saying anything -- which is the
 * exact failure the old email form had, arriving by a different route.
 *
 * A row here is "this person is owed an update about this ticket". It is
 * written by a trigger rather than by the application because the status of a
 * ticket is changed from three different places -- the review screen, the
 * GitHub workflow patching the row directly, and a person closing it by hand --
 * and only one of those runs any of our TypeScript. A trigger catches all
 * three, including the ones nobody has written yet.
 *
 * The words are not here. This records that something happened and what it was;
 * turning that into a sentence is done in lib/gaib/notices.ts, where it can be
 * read, changed and kept in plain English without a migration.
 */

create table if not exists public.gaib_ticket_notices (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.gaib_tickets(id) on delete cascade,
  -- Denormalised from the ticket on purpose: who to tell is a fact about the
  -- moment the thing happened, and should not change if a ticket is later
  -- reassigned or its raiser's account is removed.
  user_id uuid not null references auth.users(id) on delete cascade,
  from_status text,
  to_status text not null,
  -- Whatever the agent or the reviewer said, so the update can carry a reason
  -- rather than just a verdict. Nobody accepts "no" without one.
  note text,
  created_at timestamptz not null default now(),
  -- Null until the person has actually seen it, which is when they next open
  -- Gaib rather than when we decided to tell them.
  delivered_at timestamptz
);

create index if not exists gaib_ticket_notices_pending_idx
  on public.gaib_ticket_notices (user_id, created_at) where delivered_at is null;

/*
 * Which changes are worth interrupting somebody for.
 *
 * Not every status change is news. new -> queued -> running all happen within
 * seconds of the conversation that caused them and mean nothing to the person
 * who reported it; being told three times that their bug report is still being
 * worked on is worse than being told nothing.
 */
create or replace function public.gaib_notice_on_status()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if new.status = old.status or new.raised_by is null then
    return new;
  end if;

  if new.status not in ('shipped', 'rejected', 'failed', 'duplicate', 'awaiting_review') then
    return new;
  end if;

  insert into public.gaib_ticket_notices (ticket_id, user_id, from_status, to_status, note)
  values (new.id, new.raised_by, old.status, new.status, nullif(new.brief, ''));

  return new;
end;
$$;

drop trigger if exists gaib_tickets_notice on public.gaib_tickets;
create trigger gaib_tickets_notice
  after update of status on public.gaib_tickets
  for each row execute function public.gaib_notice_on_status();

alter table public.gaib_ticket_notices enable row level security;

drop policy if exists gaib_ticket_notices_read on public.gaib_ticket_notices;
create policy gaib_ticket_notices_read on public.gaib_ticket_notices
  for select to authenticated
  using (
    public.is_factur_user()
    and (user_id = auth.uid() or public.has_permission('gaib.transcripts'))
  );
