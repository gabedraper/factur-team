/*
 * A measurement of something, as at a point in time.
 *
 * The third of three history patterns. An event log records things that
 * happened and can be re-aggregated forever. client_history records who held a
 * role and when. This is for numbers that cannot be recomputed later, because
 * their source is a moving window or a value that gets overwritten:
 * raw_activities holds about two months, qb_ar_aging_raw is a picture of today
 * with no yesterday, and once they roll the old figure is simply gone.
 *
 * The rule for choosing: if it can be recomputed from an event log later, never
 * snapshot it -- snapshots go stale and lie. If it cannot, snapshot it or
 * accept losing it.
 *
 * Deliberately narrow and generic. Adding a metric is a row, not a migration.
 */
create table if not exists public.metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  -- The month being described, as its first day.
  period_start date not null,
  entity_type text not null check (entity_type in ('client', 'member', 'company')),
  entity_id uuid,
  entity_name text,
  metric text not null,
  value numeric,
  captured_at timestamptz not null default now()
);

/*
 * One value per thing per metric per month, last capture wins.
 *
 * Running nightly therefore leaves each month holding its final state, which is
 * what a monthly series should say -- rather than a first-of-month reading that
 * would freeze the month on day one.
 */
create unique index if not exists metric_snapshots_key_idx
  on public.metric_snapshots (period_start, entity_type, entity_id, metric);

create index if not exists metric_snapshots_metric_idx
  on public.metric_snapshots (metric, period_start desc);

alter table public.metric_snapshots enable row level security;

drop policy if exists metric_snapshots_read on public.metric_snapshots;
create policy metric_snapshots_read on public.metric_snapshots
  for select to authenticated using (public.is_factur_user());

create or replace function public.capture_client_metrics(
  p_period date default date_trunc('month', current_date)::date
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_rows integer;
begin
  /*
   * get_client_health() is gated on is_factur_user(), which reads the email out
   * of the request's JWT -- a scheduled job has no JWT and would get an empty
   * answer. So this presents an internal identity for the duration of the
   * transaction. The `true` makes set_config transaction-local: it cannot
   * outlive this call or leak into another session.
   *
   * Done here rather than by widening the gate on get_client_health, so that
   * function keeps exactly one rule about who may read client health -- and so
   * the health logic itself is never duplicated for the sake of snapshotting.
   */
  perform set_config('request.jwt.claims',
                     json_build_object('email', 'snapshots@facturmfg.com')::text,
                     true);

  with captured as (
    insert into public.metric_snapshots
      (period_start, entity_type, entity_id, entity_name, metric, value)
    select p_period, 'client', h.client_id, h.client_name, x.metric, x.value
    from public.get_client_health() h
    cross join lateral (values
      ('leads_30d',          h.leads_30d::numeric),
      ('leads_prior_30d',    h.leads_prior_30d::numeric),
      ('activities_30d',     h.activities_30d::numeric),
      ('ar_total',           h.ar_total),
      ('ar_overdue_60_plus', h.ar_overdue_60_plus),
      ('nps_latest',         h.nps_latest::numeric),
      ('health_overall',     h.overall_score::numeric)
    ) as x(metric, value)
    where x.value is not null
    on conflict (period_start, entity_type, entity_id, metric)
      do update set value = excluded.value, captured_at = now()
    returning 1
  )
  select count(*) into v_rows from captured;

  return v_rows;
end;
$$;

revoke all on function public.capture_client_metrics(date) from public, anon;
grant execute on function public.capture_client_metrics(date) to service_role;
