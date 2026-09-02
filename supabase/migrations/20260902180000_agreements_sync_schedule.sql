/*
 * Keep the signed agreements current.
 *
 * Every ten minutes: import anything newly completed in PandaDoc, then read one
 * or two of the documents nobody has read yet. The import half is cheap and is
 * why this runs often; the reading half is a whole contract through a large
 * model, so the archive is worked through slowly in the background rather than
 * in one expensive burst. At two per run that is roughly 290 a day, so the
 * backlog clears in under a week and new contracts are never behind it -- the
 * queue takes the newest first.
 */
select cron.schedule('agreements-sync', '*/10 * * * *', $job$
  select net.http_post(
    url := 'https://team.facturmfg.com/api/agreements/sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-gaib-secret', (select value from public.gaib_secrets where name = 'deliver')
    ),
    body := '{}'::jsonb
  );
$job$)
where not exists (select 1 from cron.job where jobname = 'agreements-sync');

/*
 * And look for new clients more than once a night.
 *
 * A contract signed on Monday morning creates a Clients__c record in
 * Salesforce; Coupler mirrors it within the hour; this puts it in org_clients.
 * Waiting for the nightly run meant an agreement could arrive before the client
 * it belongs to existed, and land unmatched for a day.
 */
select cron.schedule('sync-clients-hourly', '25 * * * *',
                     $job$select public.sync_clients_from_salesforce();$job$)
where not exists (select 1 from cron.job where jobname = 'sync-clients-hourly');
