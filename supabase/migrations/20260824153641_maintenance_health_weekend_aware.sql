/*
 * The most recent weekday before a given date.
 *
 * Nobody logs activity at the weekend and the sync only runs Monday to Friday,
 * so "yesterday" is the wrong yardstick for whether data is stale: on a Monday
 * it points at Sunday, and Friday's data is then judged three days late when it
 * is in fact the newest there could possibly be.
 */
create or replace function public.last_business_day(d date default current_date)
returns date
language sql immutable
as $$
  select max(day)::date
  from generate_series(d - 4, d - 1, interval '1 day') as g(day)
  where extract(isodow from g.day) between 1 and 5;
$$;

create or replace function public.maintenance_health()
returns table (
  healthy boolean, last_success timestamptz, last_failure timestamptz,
  consecutive_failures integer, hours_since_success numeric,
  newest_activity date, problem text
)
language sql stable security definer
set search_path to 'public', 'pg_catalog', 'cron'
as $function$
  with runs as (
    select status, end_time,
           row_number() over (order by start_time desc) as rn
    from cron.job_run_details
    where command ilike '%nightly_maintenance%'
  ),
  agg as (
    select
      (select max(end_time) from runs where status = 'succeeded') as last_success,
      (select max(end_time) from runs where status = 'failed') as last_failure,
      (select count(*)::int from runs r
        where r.rn <= coalesce((select min(rn) from runs where status = 'succeeded'), 1000) - 1) as fails,
      (select max(activity_date) from public.raw_activities) as newest,
      public.last_business_day() as expected
  )
  select
    a.last_success is not null
      and a.fails = 0
      and a.newest >= a.expected,
    a.last_success, a.last_failure, a.fails,
    round(extract(epoch from (now() - a.last_success)) / 3600, 1),
    a.newest,
    case
      when a.fails > 0 then
        a.fails || ' maintenance run' || case when a.fails = 1 then '' else 's' end || ' failed in a row'
      when a.newest < a.expected then
        'Activity data has not moved since ' || a.newest
      else null
    end
  from agg a;
$function$;
