/*
 * What the Integrations page reads.
 *
 * Both of these exist because the answers live in Postgres's own catalogues,
 * which the API role cannot read directly. Wrapping them is the point: the
 * page shows the schedules the scheduler is actually running and the tables
 * the database actually holds, rather than a written description of either.
 */

create or replace function public.integration_schedules()
returns table (jobname text, schedule text, active boolean)
language sql
stable
security definer
set search_path = public, cron
as $$
  select j.jobname::text, j.schedule::text, j.active
  from cron.job j
  order by j.jobname;
$$;

comment on function public.integration_schedules() is
  'Scheduled jobs, for the Integrations page. Names and cadence only -- never the command, which can carry arguments not everyone should read.';

/*
 * The last-changed proxy must not count our own housekeeping.
 *
 * ensure_staging_ready() runs ANALYZE on every staging table, and it runs
 * every ten minutes. That sets last_analyze, so a proxy built on it would have
 * reported every table as freshly synced at all times -- confidently, and
 * always wrongly. Manual ANALYZE and autovacuum's write to different columns,
 * so reading only the automatic ones leaves the signal to Coupler's bulk load,
 * which is the thing being asked about.
 */
create or replace function public.integration_table_state()
returns table (name text, rows bigint, size text, last_changed timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.relname::text,
    t.n_live_tup,
    pg_size_pretty(pg_total_relation_size(t.relid)),
    -- Automatic only. See the note above.
    greatest(t.last_autoanalyze, t.last_autovacuum)
  from pg_stat_user_tables t
  where t.schemaname = 'public'
  order by t.relname;
$$;

comment on function public.integration_table_state() is
  'Row counts, sizes and a last-changed proxy per table, for the Integrations page. The proxy reads autovacuum/autoanalyze only, so the ten-minute ANALYZE in ensure_staging_ready does not mask it.';

revoke all on function public.integration_schedules() from public, anon;
revoke all on function public.integration_table_state() from public, anon;
grant execute on function public.integration_schedules() to authenticated, service_role;
grant execute on function public.integration_table_state() to authenticated, service_role;
