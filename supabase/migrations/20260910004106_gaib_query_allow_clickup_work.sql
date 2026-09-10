/*
 * Let agents read the ClickUp mirror.
 *
 * Safe to add because these five carry row security of their own -- every
 * policy is work_can_view(), which is the same work.view permission the right
 * rail is gated on -- and gaib_query runs as the person asking, so the rows
 * that come back are the rows they could already see on screen.
 *
 * work_sync_runs is left off: it is operational plumbing about the sync
 * itself, and nothing anybody asks an assistant.
 *
 * Rewrites the function in place rather than restating it, so this does not
 * silently revert whatever else has been added to the allowlist since.
 */
do $$
declare
  def text;
begin
  select pg_get_functiondef(p.oid) into def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'gaib_query';

  if def is null then
    raise exception 'gaib_query not found';
  end if;

  if position('work_items' in def) > 0 then
    raise notice 'already allowed';
    return;
  end if;

  def := replace(
    def,
    E'    ''gaib_ticket_notices'',''gaib_sessions'',''gaib_messages'',''gaib_agents''',
    E'    ''gaib_ticket_notices'',''gaib_sessions'',''gaib_messages'',''gaib_agents'',\n'
    '    -- The ClickUp mirror. Row security on each of these is work_can_view().\n'
    '    ''work_items'',''work_item_assignees'',''work_containers'',''work_processes'''
  );

  execute def;
end $$;
