/*
 * Only the current state is worth saying.
 *
 * A ticket that moved twice before anybody opened Gaib queued both updates, so
 * somebody would be told "I got stuck, can you tell me more?" and then, in the
 * next breath, "the fix is written and waiting on Gabe". Two sentences that were
 * each true when written and contradict each other on arrival.
 *
 * A new update now clears any older one for the same ticket that has not been
 * seen yet. Anything already delivered stays, because that was said and cannot
 * be unsaid.
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

  delete from public.gaib_ticket_notices
   where ticket_id = new.id and delivered_at is null;

  insert into public.gaib_ticket_notices (ticket_id, user_id, from_status, to_status, note)
  values (new.id, new.raised_by, old.status, new.status, nullif(new.brief, ''));

  return new;
end;
$$;

delete from public.gaib_ticket_notices n
 where n.delivered_at is null
   and exists (
     select 1 from public.gaib_ticket_notices later
      where later.ticket_id = n.ticket_id
        and later.delivered_at is null
        and later.created_at > n.created_at
   );
