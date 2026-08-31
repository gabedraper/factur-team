-- Hourly, on the half hour, clear of the other jobs.
select cron.unschedule('client-activity-counts')
where exists (select 1 from cron.job where jobname = 'client-activity-counts');

select cron.schedule(
  'client-activity-counts',
  '35 * * * *',
  $cron$select public.refresh_client_activity_counts();$cron$
);
