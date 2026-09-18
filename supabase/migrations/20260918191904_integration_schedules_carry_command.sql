-- The Schedules table on the Integrations page showed a job's name, cron and
-- state, and nothing about what it does. The command is the one thing the
-- database can say about that -- which function it calls or which route it
-- posts to -- so it is returned alongside. The words (what records, from
-- where, to where, on what criteria) live in lib/integrations/schedules.ts;
-- the page flags a job that has no entry there.
--
-- Postgres will not change a function's result columns in place, so the old
-- definition is dropped first. Callers only ever read it by column name.
drop function if exists public.integration_schedules();

create function public.integration_schedules()
returns table (jobname text, schedule text, active boolean, command text)
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
    select j.jobname::text, j.schedule::text, j.active, j.command::text
    from cron.job j
    order by j.jobname;
end;
$$;

comment on function public.integration_schedules() is
  'Scheduled jobs with what they run, for the Integrations page. Direct callers need org.manage; the service role is trusted because the server action checks first.';
