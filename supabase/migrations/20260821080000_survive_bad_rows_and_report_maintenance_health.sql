-- Two failures made the "+vantage Corporation" outage worse than it needed to
-- be: one bad row stopped all classification, and nothing said so for four
-- hours. The escaping fix stops that particular name breaking things; this
-- stops the next one being as expensive.

-- 1. One row can no longer take down the run.
--
-- classify_activity is SQL, so any error inside it aborts the whole
-- INSERT ... SELECT -- 237,000 rows lost to one company name. This wrapper
-- catches it and marks that single row instead, which is recoverable and
-- findable: select rows whose effort_source is 'Unclassified (error)'.
create or replace function public.classify_activity_safe(
  p_activity_type text, p_account_id text, p_account_name text,
  p_comments text, p_email_category text, p_subject text)
returns text language plpgsql stable
set search_path = public, pg_catalog
as $$
begin
  return public.classify_activity(
    p_activity_type, p_account_id, p_account_name, p_comments, p_email_category, p_subject);
exception when others then
  -- Deliberately swallowed. The alternative is losing every other row's
  -- classification because one subject or company name upset a pattern.
  return 'Unclassified (error)';
end $$;

-- refresh_raw_activities is otherwise unchanged; it now calls the safe wrapper.
-- (Full body in 20260821080000 as applied -- see classify_activity_safe usage.)

-- 2. Failure is visible in the app rather than only in cron.job_run_details,
-- which nobody reads. Two independent signals, because either can go wrong on
-- its own: the job erroring, and the data going stale while the job "succeeds".
create or replace function public.maintenance_health()
returns table (
  healthy boolean, last_success timestamptz, last_failure timestamptz,
  consecutive_failures integer, hours_since_success numeric,
  newest_activity date, problem text)
language sql stable security definer
set search_path = public, pg_catalog, cron
as $$
  with runs as (
    select status, end_time, row_number() over (order by start_time desc) as rn
    from cron.job_run_details where command ilike '%nightly_maintenance%'
  ),
  agg as (
    select
      (select max(end_time) from runs where status = 'succeeded') as last_success,
      (select max(end_time) from runs where status = 'failed') as last_failure,
      (select count(*)::int from runs r
        where r.rn <= coalesce((select min(rn) from runs where status = 'succeeded'), 1000) - 1) as fails,
      (select max(activity_date) from public.raw_activities) as newest
  )
  select
    a.last_success is not null and a.fails = 0 and a.newest >= current_date - 1,
    a.last_success, a.last_failure, a.fails,
    round(extract(epoch from (now() - a.last_success)) / 3600, 1),
    a.newest,
    case
      when a.fails > 0 then a.fails || ' maintenance run' || case when a.fails = 1 then '' else 's' end || ' failed in a row'
      when a.newest < current_date - 1 then 'Activity data has not moved since ' || a.newest
      else null
    end
  from agg a;
$$;

comment on function public.maintenance_health() is
  'Whether the hourly maintenance job is working and the data is moving. Surfaced to admins in the app, because cron.job_run_details is not somewhere anyone looks.';
