/*
 * Re-apply row security to every Coupler-loaded table.
 *
 * Coupler drops and recreates its destination table on each run, which takes
 * the table's row security and policies with it -- so these tables sit open to
 * the public key from the moment a sync finishes until this runs again. Two
 * tables added today were missing from the list entirely, which left Salesforce
 * stage history and QuickBooks receivables readable by anyone holding the
 * anon key.
 */
create or replace function public.ensure_staging_rls()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  t text;
begin
  foreach t in array array[
    'sf_tasks_raw', 'sf_events_raw', 'sf_clients_raw',
    'sf_opportunities_raw', 'sf_orders_raw', 'sf_users_raw',
    'sf_opp_leads_raw', 'sf_opp_tasks_raw',
    'sf_opp_stage_changes_raw', 'qb_ar_aging_raw'
  ]
  loop
    -- A table is absent between its drop and recreate, so skip rather than fail.
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
