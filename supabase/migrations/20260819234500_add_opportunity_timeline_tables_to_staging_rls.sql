-- Coupler drops and recreates every sf_*_raw table on each load, which clears
-- RLS along with the table. ensure_staging_rls() reasserts it, but its table
-- list was hardcoded and did not include the two tables added for Opportunity
-- Timelines -- so they would have stayed world-readable indefinitely.
--
-- Also skips tables that do not exist yet, so the function is safe to run while
-- a Coupler load is mid-flight between drop and recreate.
create or replace function public.ensure_staging_rls()
returns void
language plpgsql
set search_path to 'public', 'pg_catalog'
as $function$
declare
  t text;
begin
  foreach t in array array[
    'sf_tasks_raw', 'sf_events_raw', 'sf_clients_raw',
    'sf_opportunities_raw', 'sf_orders_raw', 'sf_users_raw',
    'sf_opp_leads_raw', 'sf_opp_tasks_raw'
  ]
  loop
    if to_regclass('public.' || quote_ident(t)) is null then
      continue;
    end if;

    execute format('alter table public.%I enable row level security', t);

    -- Retire the old blanket policy if anything recreates it.
    execute format('drop policy if exists %I on public.%I',
                   'authenticated_read_' || t, t);

    execute format('drop policy if exists %I on public.%I',
                   'factur_users_read_' || t, t);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (public.is_factur_user())',
      'factur_users_read_' || t, t);
  end loop;
end;
$function$;

select public.ensure_staging_rls();
