-- The note on a notice is what a person said, and nothing else.
--
-- It used to be gaib_tickets.brief, the coding agent's write-up, which is
-- addressed to whoever reviews the code and reads as jargon to the person who
-- reported the problem. The rejection notice presented it as "His reasoning",
-- so the one line meant to carry Gabe's words carried the agent's instead.
--
-- Falling back to brief is worse than saying nothing: the shipped and duplicate
-- notices show this line too, and a technical diff summary under "Gabe added"
-- is precisely the jargon these messages exist to avoid.
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

  /*
   * Only the current state is worth saying.
   *
   * A ticket that moved twice before anybody opened Gaib queued both updates,
   * so somebody would be told "I got stuck, can you tell me more?" and then, in
   * the next breath, "the fix is written and waiting on Gabe". Two sentences
   * that were each true when written and contradict each other on arrival.
   */
  delete from public.gaib_ticket_notices
   where ticket_id = new.id and delivered_at is null;

  insert into public.gaib_ticket_notices (ticket_id, user_id, from_status, to_status, note)
  values (new.id, new.raised_by, old.status, new.status,
          nullif(new.decision_note, ''));

  return new;
end;
$$;
