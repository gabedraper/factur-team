/*
 * Ask Salesforce what changed, every three minutes.
 *
 * Three rather than one, for a reason with history. On 3 September a job on a
 * one-minute schedule that took eight minutes stacked on itself until the
 * database ran out of connections and the app went down. This job also refuses
 * to overlap -- claim_salesforce_sync() hands out a single lease and a run that
 * cannot get it does nothing -- but a schedule with headroom in it means that
 * guard is a backstop rather than the thing holding the system up.
 *
 * Three minutes is the same cadence as enrich-client-websites, which has run
 * without trouble, so it is a known-survivable rate for this database rather
 * than a guess.
 *
 * Starts disabled. The Connected App needs a Run As user before the sync can
 * authenticate at all, and a job that fails every three minutes fills the logs
 * with noise that hides real failures. Enable it with:
 *
 *   select cron.alter_job(
 *     (select jobid from cron.job where jobname = 'salesforce-sync'),
 *     active := true);
 */

select cron.schedule(
  'salesforce-sync',
  '*/3 * * * *',
  $cron$
  select net.http_post(
    url := 'https://team.facturmfg.com/api/salesforce/sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-gaib-secret', (select value from public.gaib_secrets where name = 'deliver')
    ),
    body := '{}'::jsonb
  );
  $cron$
);

select cron.alter_job(
  (select jobid from cron.job where jobname = 'salesforce-sync'),
  active := false
);
