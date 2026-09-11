-- Every minute: post answers from Managed Agents tasks that finished after the
-- request that started them had gone, and wind up workers quiet for 12 hours.
select cron.schedule(
  'gaib-worker-poll',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://team.facturmfg.com/api/gaib/worker-poll',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-gaib-secret', (select value from public.gaib_secrets where name = 'deliver')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
