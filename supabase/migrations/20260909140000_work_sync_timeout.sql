/*
 * Give the sync longer than five seconds to answer.
 *
 * net.http_post defaults to a 5000 ms timeout and then aborts the connection.
 * Every other job here finishes inside that, so nobody had met it before: the
 * agreements sync returns in about a second. This one asks ClickUp what changed
 * and writes what came back, which is comfortably longer, so pg_net was hanging
 * up mid-request and the route never got far enough to record a run. The
 * symptom was a job that looked like it was succeeding -- cron.job_run_details
 * said "succeeded", because dispatching the request did succeed -- while
 * nothing was ever written.
 *
 * Two minutes, well inside the route's own 300 second ceiling.
 */
select cron.unschedule('work-sync') where exists (select 1 from cron.job where jobname = 'work-sync');

select cron.schedule('work-sync', '*/15 * * * *', $job$
  select net.http_post(
    url := 'https://team.facturmfg.com/api/work/sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-gaib-secret', (select value from public.gaib_secrets where name = 'deliver')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$job$);
