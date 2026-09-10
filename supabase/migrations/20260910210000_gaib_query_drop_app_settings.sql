/*
 * app_settings comes off the agent allowlist.
 *
 * It was on it as "how things are scored", which it is not -- scoring lives in
 * effort_weights, deal_weights and client_health_weights. app_settings is
 * operational config: the uptime URL, who hears about an outage, and a live
 * Resend API key sitting in a text column.
 *
 * Nothing could read it, because it has row security enabled and not one
 * policy, so the exposure was theoretical. That is not a good reason to leave
 * it on the list: the day somebody adds a policy to make the settings screen
 * work, an agent would be able to read the key, and nobody would connect the
 * two changes.
 *
 * The key itself belongs in the environment rather than in a table. Flagged
 * separately; moving it is a change to whatever sends the alerts.
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

  if position('''app_settings''' in def) = 0 then
    raise notice 'already removed';
    return;
  end if;

  def := replace(def, E',''app_settings''', '');
  def := replace(def, E'''app_settings'',', '');

  execute def;
end $$;
