/*
 * Keep the mirror current without anyone remembering to.
 *
 * Every fifteen minutes, the same way the agreements sync runs. The route it
 * calls does not walk the workspace -- it asks ClickUp what changed since the
 * newest change already held, which on a quiet hour is one API call and no
 * writes. The 38 minute full walk stays a script, run by hand when the matcher
 * or the process list changes and everything needs re-deriving.
 */
select cron.schedule('work-sync', '*/15 * * * *', $job$
  select net.http_post(
    url := 'https://team.facturmfg.com/api/work/sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-gaib-secret', (select value from public.gaib_secrets where name = 'deliver')
    ),
    body := '{}'::jsonb
  );
$job$)
where not exists (select 1 from cron.job where jobname = 'work-sync');
