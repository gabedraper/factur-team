/*
 * How Gaib sounds, and the CRM it can read.
 *
 * voice: Gaib is Gabe's AI clone. The job instructions say what it does and
 * this says how Gabe would say it -- learned from his own messages by
 * /api/gaib/learn-voice, style only (no names, clients, figures or quotes).
 * Kept apart from the instructions so it can be relearned as his style drifts,
 * or switched off, without touching the job.
 */
alter table public.gaib_agents
  add column if not exists voice text,
  add column if not exists voice_learned_at timestamptz;

/*
 * The CRM for agents. Gaib told Matt a company was not on file when it was in
 * Salesforce twice -- it could not see crm_accounts, and reported its blind
 * spot as an absence. Each table carries its own row security: accounts and
 * contacts readable by any Factur user, opportunities scoped. gaib_query runs
 * as the asker, so those rules apply unchanged.
 */
do $$
declare
  def text;
begin
  select pg_get_functiondef(p.oid) into def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'gaib_query';

  if def is null then raise exception 'gaib_query not found'; end if;
  if position('''crm_accounts''' in def) > 0 then return; end if;

  def := replace(
    def,
    E'''work_items'',''work_item_assignees'',''work_containers'',''work_processes''',
    E'''work_items'',''work_item_assignees'',''work_containers'',''work_processes'',\n'
    '    -- The CRM. Accounts and contacts read by any Factur user; opportunities scoped.\n'
    '    ''crm_accounts'',''crm_contacts'',''opportunities'''
  );

  execute def;
end $$;
