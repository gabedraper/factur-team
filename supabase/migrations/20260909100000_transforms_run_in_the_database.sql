/*
 * Move the transforms out of the API and into the database.
 *
 * They were being called over HTTP from the sync route, which meant they ran as
 * the authenticator role -- and that role carries statement_timeout=8s. Thirty
 * minutes of Salesforce changes takes about nineteen seconds to transform, so
 * every run was cancelled part-way through.
 *
 * Raising the timeout would have been the wrong fix. These are pure SQL over
 * tables that are already in this database; there was never a reason for the
 * work to leave it. The route keeps the half that genuinely needs the network --
 * asking Salesforce what changed and writing it into the mirrors -- and pg_cron
 * runs the half that does not.
 *
 * The two halves are deliberately not coordinated. The mirrors are the handover
 * point: the route fills them whenever it can, the transforms drain them a few
 * minutes later, and neither waits on the other. A missed run of either is
 * caught by the next one rather than needing a retry.
 */

create or replace function public.apply_salesforce_transforms_incremental()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_since timestamptz;
  v_started timestamptz := now();
  r jsonb;
begin
  select watermark into v_since
    from public.salesforce_sync_state where object = '__transforms';

  /*
   * Overlap on purpose. A row can land in the mirror while a transform is
   * already running, and would otherwise sit unprocessed until something else
   * happened to touch it. Re-reading five minutes is cheap now that
   * LastModifiedDate is indexed, and an upsert of a row that has not changed
   * costs nothing but the write.
   *
   * With no marker at all -- first run after deploy -- an hour is enough to
   * catch up without walking the whole mirror.
   */
  v_since := coalesce(v_since, v_started - interval '1 hour') - interval '5 minutes';

  r := public.apply_salesforce_transforms(v_since);

  insert into public.salesforce_sync_state (object, watermark, last_run_at, last_run_rows, last_error)
  values ('__transforms', v_started, v_started,
          (select sum(value::int) from jsonb_each_text(r)), null)
  on conflict (object) do update set
    watermark     = excluded.watermark,
    last_run_at   = excluded.last_run_at,
    last_run_rows = excluded.last_run_rows,
    last_error    = null;

  return r;
end;
$function$;

comment on function public.apply_salesforce_transforms_incremental() is
  'Runs every Salesforce transform over whatever has changed since the last run, with five minutes of deliberate overlap. Called by the salesforce-transforms cron job.';

revoke all on function public.apply_salesforce_transforms_incremental() from public, anon;
grant execute on function public.apply_salesforce_transforms_incremental() to service_role;

insert into public.salesforce_sync_state (object) values ('__transforms')
on conflict (object) do nothing;


/*
 * Three minutes, offset from the fetch by design -- the mirrors want something
 * in them before this runs. run_once() means a slow run is skipped rather than
 * stacked, the same guard the fetch uses, and for the same reason: on
 * 3 September a job that lapped itself took the database down.
 */
select cron.schedule(
  'salesforce-transforms',
  '*/3 * * * *',
  $cron$
  select public.run_once(
    'salesforce-transforms',
    'select public.apply_salesforce_transforms_incremental()'
  );
  $cron$
);

select cron.alter_job(
  (select jobid from cron.job where jobname = 'salesforce-transforms'),
  active := false
);
