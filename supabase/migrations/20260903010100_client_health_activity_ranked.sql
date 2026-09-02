/*
 * Point the AM Activity score at the ranked one.
 *
 * Applied against the live definition rather than retyped. Replaces
 *
 *   least(100, round(a.recent / a.prior * 75))
 *
 * which was momentum, not level: 2 activities becoming 4 scored 100 while 200
 * becoming 190 scored 71. The new score is a percentile rank of average monthly
 * activity within the client's own service, so OP is ranked against OP and OSDR
 * against OSDR. Services that do not run on activity score null.
 *
 * Applied via execute_sql rather than the migration runner, which timed out on
 * its own history table partway through; this file is the record.
 */
do $mig$
declare
  src text;
  old_join text := '    left join client_performance cp on cp.salesforce_client_id = b.salesforce_client_id';
  new_join text := '    left join client_performance cp on cp.salesforce_client_id = b.salesforce_client_id
    left join client_activity_rank ar2 on ar2.salesforce_client_id = b.salesforce_client_id';
  old_calc text := '           case when coalesce(a.prior, 0) = 0 and coalesce(a.recent, 0) = 0 then null
                when coalesce(a.prior, 0) = 0 then 100
                else least(100, round(a.recent::numeric / a.prior * 75))::int end as activity_score,';
  new_calc text := '           ar2.activity_score as activity_score,';
begin
  select pg_get_functiondef(p.oid) into src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_client_health';

  if position(old_calc in src) = 0 then
    raise notice 'activity block already replaced; nothing to do';
    return;
  end if;

  execute replace(replace(src, old_join, new_join), old_calc, new_calc);
end;
$mig$;
