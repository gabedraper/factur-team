-- Tickets built in Gabe's own session, not by the automatic builder.
--
-- The automatic builder takes a ticket as written and produces one attempt.
-- Most tickets turn out to need a conversation first -- what exactly, for
-- whom, and what to leave out -- and that conversation happens between Gabe
-- and Claude in his working session, where the app can be changed directly.
-- With the builder set to "session", a new ticket waits for that session
-- instead of being handed off, and everything else stays as it was: the
-- ticket is in the queue, the reporter hears when it starts and when it
-- ships, and any ticket can still be handed to the automatic builder by hand.

alter table public.gaib_coding_settings
  add column if not exists builder text not null default 'agent'
    check (builder in ('agent', 'session'));

-- "running" now tells the reporter something, because a person is on it.
create or replace function public.gaib_notice_on_status()
returns trigger
language plpgsql
set search_path to 'public', 'pg_catalog'
as $$
begin
  if new.status = old.status or new.raised_by is null then
    return new;
  end if;

  if new.status not in ('running', 'shipped', 'rejected', 'failed', 'duplicate', 'awaiting_review') then
    return new;
  end if;

  delete from public.gaib_ticket_notices
   where ticket_id = new.id and delivered_at is null;

  insert into public.gaib_ticket_notices (ticket_id, user_id, from_status, to_status, note)
  values (new.id, new.raised_by, old.status, new.status,
          nullif(new.decision_note, ''));

  return new;
end;
$$;

/**
 * One call from the session to move a ticket along.
 *
 * Sets the status, keeps the note where the notice trigger reads it, records
 * what shipped, and writes the event -- so the card, the reporter's message
 * and the history all move together from a single statement.
 */
create or replace function public.gaib_ticket_progress(
  p_ref integer,
  p_status text,
  p_note text default null,
  p_commit_sha text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  t public.gaib_tickets%rowtype;
begin
  select * into t from public.gaib_tickets where ref = p_ref;
  if not found then
    raise exception 'no ticket %', p_ref;
  end if;
  if p_status not in ('running', 'shipped', 'rejected', 'failed', 'duplicate', 'awaiting_review', 'new') then
    raise exception 'not a status a session sets: %', p_status;
  end if;

  update public.gaib_tickets
     set status        = p_status,
         decision_note = coalesce(p_note, decision_note),
         commit_sha    = coalesce(p_commit_sha, commit_sha),
         closed_at     = case when p_status in ('shipped', 'rejected', 'duplicate') then now() else null end,
         updated_at    = now()
   where id = t.id;

  insert into public.gaib_ticket_events (ticket_id, actor, event, detail)
  values (t.id, 'person',
          case p_status
            when 'running' then 'started building in Gabe''s session'
            when 'shipped' then 'shipped from Gabe''s session'
            else p_status
          end,
          coalesce(p_note, p_commit_sha));

  return jsonb_build_object('ref', t.ref, 'title', t.title, 'from', t.status, 'to', p_status);
end;
$$;

revoke all on function public.gaib_ticket_progress(integer, text, text, text) from public;
grant execute on function public.gaib_ticket_progress(integer, text, text, text) to service_role;

-- What the session picks from: everything waiting to be built, oldest first.
create or replace view public.gaib_session_queue as
  select t.ref, t.kind, t.severity, t.title, t.body, t.page_url, t.directions,
         p.full_name as raised_by, t.origin_space is not null as from_room,
         t.created_at
    from public.gaib_tickets t
    left join public.profiles p on p.id = t.raised_by
   where t.status = 'new'
   order by t.created_at;

revoke all on public.gaib_session_queue from public, anon, authenticated;
grant select on public.gaib_session_queue to service_role;
