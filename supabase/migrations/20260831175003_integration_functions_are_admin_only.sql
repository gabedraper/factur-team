/*
 * The Integrations page moved behind org.manage, so these move with it.
 *
 * They are security definer, which means they run with the owner's rights
 * whoever calls them, and they were granted to every signed-in account. The
 * page checking a permission is not enough on its own: PostgREST is reachable
 * directly, so anybody with a session could have asked for the schedules and
 * the size of every table in the database.
 *
 * The guard has to let trusted server code through, though. has_permission()
 * answers for the signed-in person, and the service role has no signed-in
 * person -- auth.uid() is null, so it reads false. The app calls these with
 * the service role from a server action that has already checked org.manage,
 * so guarding on has_permission() alone refused the only caller that
 * legitimately exists and let nobody in at all. That was caught before it
 * shipped, but only by testing it.
 *
 * Guarded inside the function rather than by revoking execute, so the refusal
 * is a clear message rather than a permissions error from the API layer.
 */

create or replace function public.integration_schedules()
returns table (jobname text, schedule text, active boolean)
language plpgsql
stable
security definer
set search_path = public, cron
as $$
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin')
     and not public.has_permission('org.manage') then
    raise exception 'org.manage required' using errcode = '42501';
  end if;

  return query
    select j.jobname::text, j.schedule::text, j.active
    from cron.job j
    order by j.jobname;
end;
$$;

comment on function public.integration_schedules() is
  'Scheduled jobs, for the Integrations page. Direct callers need org.manage; the service role is trusted because the server action checks first.';

create or replace function public.integration_table_state()
returns table (name text, rows bigint, size text, last_changed timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin')
     and not public.has_permission('org.manage') then
    raise exception 'org.manage required' using errcode = '42501';
  end if;

  return query
    select
      t.relname::text,
      t.n_live_tup,
      pg_size_pretty(pg_total_relation_size(t.relid)),
      /*
       * Automatic only. ensure_staging_ready() runs ANALYZE on every staging
       * table every ten minutes, so a proxy including manual analyze would
       * report everything as freshly synced at all times.
       */
      greatest(t.last_autoanalyze, t.last_autovacuum)
    from pg_stat_user_tables t
    where t.schemaname = 'public'
    order by t.relname;
end;
$$;

comment on function public.integration_table_state() is
  'Row counts, sizes and a last-changed proxy per table, for the Integrations page. Direct callers need org.manage; the service role is trusted because the server action checks first.';
