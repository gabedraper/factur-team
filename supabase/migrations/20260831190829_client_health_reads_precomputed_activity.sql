/*
 * Point client health at the precomputed counts.
 *
 * The swap is done against the function's own definition rather than by
 * retyping it: only the one CTE changes, and rewriting five kilobytes of
 * scoring logic by hand to alter six lines of it is how a scoring change gets
 * made by accident. If the block is not found exactly, this fails rather than
 * silently leaving the slow version in place.
 */

do $outer$
declare
  def text;
  old_block text := '  acts as (
    select account_id,
           count(*) filter (where activity_date >= current_date - 30) as recent,
           count(*) filter (where activity_date >= current_date - 60
                              and activity_date <  current_date - 30) as prior
    from raw_activities
    where activity_date >= current_date - 60 and account_id is not null
    group by account_id
  ),
';
  new_block text := '  acts as (
    -- Precomputed hourly by refresh_client_activity_counts. Aggregating
    -- raw_activities here is what put this page over the statement timeout
    -- three times: a 230,000-row scan whose cost depends on when the table
    -- was last vacuumed.
    select account_id, recent, prior from client_activity_counts
  ),
';
begin
  select pg_get_functiondef(p.oid) into def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_client_health';

  if def is null then
    raise exception 'get_client_health not found';
  end if;

  if position(old_block in def) = 0 then
    raise exception 'the acts block has changed -- refusing to guess at the replacement';
  end if;

  execute replace(def, old_block, new_block);
end;
$outer$;
