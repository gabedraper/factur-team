/*
 * Put a Coupler-loaded table back into a usable state after a sync.
 *
 * Coupler drops and recreates its destination table on every run. That takes
 * three things with it, and all three have now bitten:
 *   - row security, leaving Salesforce and QuickBooks data open to the anon key
 *   - any view built on the table, which 500'd the Client Health page
 *   - every index, which turned a keyed lookup into a scan of a quarter of a
 *     million rows and timed the same page out
 *
 * So this re-applies security *and* indexes. Views cannot be protected this way
 * and must be written as functions instead.
 */
create or replace function public.ensure_staging_ready()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  t text;
  ix text;
  tables text[] := array[
    'sf_tasks_raw', 'sf_events_raw', 'sf_clients_raw',
    'sf_opportunities_raw', 'sf_orders_raw', 'sf_users_raw',
    'sf_opp_leads_raw', 'sf_opp_tasks_raw',
    'sf_opp_stage_changes_raw', 'qb_ar_aging_raw'
  ];
  -- table, index name, column list. Only the columns actually joined or
  -- filtered on by the app; an index nothing uses still costs every sync.
  indexes text[][] := array[
    ['sf_opp_leads_raw',         'sf_opp_leads_client_idx',      'client__c'],
    ['sf_opp_leads_raw',         'sf_opp_leads_owner_idx',       'ownerid'],
    ['sf_opp_leads_raw',         'sf_opp_leads_created_idx',     'createddate'],
    ['sf_opp_tasks_raw',         'sf_opp_tasks_what_idx',        'whatid'],
    ['sf_opp_stage_changes_raw', 'sf_opp_stage_changes_idx',     'whatid, createddate'],
    ['sf_clients_raw',           'sf_clients_id_idx',            'id'],
    ['sf_clients_raw',           'sf_clients_account_idx',       'client_account__c']
  ];
begin
  foreach t in array tables
  loop
    -- A table is absent between its drop and recreate, so skip rather than fail.
    if to_regclass('public.' || quote_ident(t)) is null then
      continue;
    end if;

    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I',
                   'authenticated_read_' || t, t);
    execute format('drop policy if exists %I on public.%I',
                   'factur_users_read_' || t, t);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (public.is_factur_user())',
      'factur_users_read_' || t, t);
  end loop;

  for i in 1 .. array_length(indexes, 1)
  loop
    if to_regclass('public.' || quote_ident(indexes[i][1])) is null then
      continue;
    end if;
    ix := indexes[i][2];
    execute format('create index if not exists %I on public.%I (%s)',
                   ix, indexes[i][1], indexes[i][3]);
  end loop;
end;
$function$;

-- The old name is still referenced by nightly_maintenance; keep it working.
create or replace function public.ensure_staging_rls()
returns void
language sql
security definer
set search_path to 'public'
as $$ select public.ensure_staging_ready(); $$;

select public.ensure_staging_ready();
