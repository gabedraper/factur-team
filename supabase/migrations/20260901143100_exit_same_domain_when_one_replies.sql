/*
 * When one person at a company replies, stop chasing their colleagues.
 *
 * Appended to close_finished_runs against its own definition rather than
 * retyped: the reply and ladder-end rules in there are what actually stop
 * every ladder in the app, and copying two kilobytes of them by hand to add a
 * third is how one of the first two quietly changes meaning.
 *
 * Runs after the reply block on purpose, so a reply recorded in the same pass
 * is already visible to it.
 */

do $outer$
declare
  def text;
  marker text := '  return v_closed;
end;
';
  addition text := '  /*
   * Somebody else at the same company has replied.
   *
   * Chasing four people at one client and stopping only the one who wrote
   * back is how a single overdue invoice turns into four inboxes annoyed at
   * once. Only for sequences that ask for it.
   */
  with answered as (
    select distinct
      r.sequence_id,
      lower(split_part(a.recipient, ''@'', 2)) as domain
    from public.sequence_runs r
    join public.sequences s on s.id = r.sequence_id
    join public.sequence_actions a on a.run_id = r.id
    where s.exit_same_domain
      and r.ended_reason = ''replied''
      and r.ended_at > now() - interval ''7 days''
      and a.recipient is not null
      and position(''@'' in a.recipient) > 0
  ),
  colleagues as (
    select distinct r.id
    from public.sequence_runs r
    join public.sequences s on s.id = r.sequence_id and s.exit_same_domain
    join public.sequence_actions a on a.run_id = r.id
    join answered ans
      on ans.sequence_id = r.sequence_id
     and ans.domain = lower(split_part(a.recipient, ''@'', 2))
    where r.ended_at is null
  )
  update public.sequence_runs r
  set ended_at = now(), ended_reason = ''a colleague replied'', updated_at = now()
  from colleagues where colleagues.id = r.id;
  get diagnostics v_rows = row_count; v_closed := v_closed + v_rows;

  return v_closed;
end;
';
begin
  select pg_get_functiondef(p.oid) into def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'close_finished_runs';

  if def is null then
    raise exception 'close_finished_runs not found';
  end if;

  if position(marker in def) = 0 then
    raise exception 'close_finished_runs has changed -- refusing to guess where to append';
  end if;

  if position('a colleague replied' in def) > 0 then
    raise notice 'already appended';
    return;
  end if;

  execute replace(def, marker, addition);
end;
$outer$;
