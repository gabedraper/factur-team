/*
 * The three-minute transform keys on what the sync fetched, not on when
 * Salesforce last touched the row.
 *
 * It used to take every mirror row with LastModifiedDate later than its own
 * previous run (less five minutes). That is the wrong clock. The sync fetches
 * at most 20,000 rows per object per run, so after a mass update in
 * Salesforce a row can arrive here hours after its LastModifiedDate -- by
 * which time the transform's window has moved on and the row is never taken.
 * The reconciliation found 391 opportunities whose stage in the app was days
 * behind the mirror's, every one of them fetched late.
 *
 * Now each run records the sync's own high-water mark -- the oldest of the
 * per-object watermarks over the objects that change all day -- and the next
 * run transforms everything past the mark it recorded last time. Whatever
 * the sync brought in between two runs has a LastModifiedDate past that
 * mark, however late it arrived. Five minutes of overlap stays, for clocks.
 *
 * The nightly full pass, which was meant to catch anything the incremental
 * run missed, had been timing out every night since at least the 14th under
 * the default statement timeout. It gets an hour.
 */

create or replace function public.apply_salesforce_transforms_incremental()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_since   timestamptz;
  v_floor   timestamptz;
  v_started timestamptz := now();
  v_ids text[];
  r jsonb;
  b jsonb := '{}'::jsonb;
begin
  /* What the previous run saw as the sync's high-water mark. */
  select watermark into v_since
    from public.salesforce_sync_state where object = '__transforms_floor';
  if v_since is null then
    select watermark into v_since from public.salesforce_sync_state where object = '__transforms';
  end if;
  v_since := coalesce(v_since, v_started - interval '1 hour') - interval '5 minutes';

  r := public.apply_salesforce_transforms(v_since);

  select array_agg(id) into v_ids
  from (
    select id from public.salesforce_contact_backfill
    where applied_at is null
    order by fetched_at
    limit 2000
  ) q;
  if v_ids is not null then
    b := public.salesforce_apply_contact_backfill(v_ids);
    update public.salesforce_contact_backfill
       set applied_at = now()
     where id = any(v_ids);
    r := r || jsonb_build_object('backfilled_contacts', b->'contacts', 'backfilled_opportunities', b->'opportunities');
  end if;

  /* The sync's mark as of now: the oldest watermark among the objects that
     move all day. Anything fetched after this run has a LastModifiedDate
     past it. */
  select min(watermark) into v_floor
    from public.salesforce_sync_state
   where object in ('Opportunity', 'Contact', 'Account', 'Task', 'Event', 'Quote', 'Order');
  v_floor := coalesce(v_floor, v_started);

  insert into public.salesforce_sync_state (object, watermark, last_run_at, last_run_rows, last_error)
  values ('__transforms', v_started, v_started,
          (select sum(value::int) from jsonb_each_text(r)), null)
  on conflict (object) do update set
    watermark     = excluded.watermark,
    last_run_at   = excluded.last_run_at,
    last_run_rows = excluded.last_run_rows,
    last_error    = null;

  insert into public.salesforce_sync_state (object, watermark, last_run_at)
  values ('__transforms_floor', v_floor, v_started)
  on conflict (object) do update set watermark = excluded.watermark, last_run_at = excluded.last_run_at;

  return r;
end;
$function$;

/* The nightly full pass gets the time it needs. */
select cron.alter_job(
  (select jobid from cron.job where jobname = 'salesforce-catchup-nightly'),
  command := $job$
  set statement_timeout = '60min';
  select public.run_once(
    'salesforce-catchup-nightly',
    'select public.apply_salesforce_transforms(null)'
  );
  $job$
);
