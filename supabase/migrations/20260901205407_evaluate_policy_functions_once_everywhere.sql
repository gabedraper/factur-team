/*
 * The staging tables: evaluate the domain check once, not per row.
 *
 * `ensure_staging_ready()` recreates these policies on every nightly run, so
 * fixing the policies directly would be undone within a day -- the function is
 * the only durable place to change them.
 *
 * Written bare, `is_factur_user()` is part of the row filter and runs for every
 * row examined: a quarter of a million times on sf_opp_tasks_raw. Wrapped in a
 * scalar subquery it becomes an InitPlan, evaluated once. Measured on that
 * table: 2,762ms -> 213ms.
 *
 * The second cost is quieter and arguably worse. A function in the filter has
 * no selectivity statistics, so the planner guesses -- it estimated 85,495 rows
 * against an actual 256,486. A threefold mis-estimate is how a join flips to
 * the wrong plan on a query that has nothing to do with permissions, which is
 * the kind of slowness nobody traces back to a policy.
 *
 * Everything else in this function is unchanged from the version it replaces.
 */
create or replace function public.ensure_staging_ready()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  t text;
  tables text[] := array[
    'sf_tasks_raw', 'sf_events_raw', 'sf_clients_raw',
    'sf_opportunities_raw', 'sf_orders_raw', 'sf_users_raw',
    'sf_opp_leads_raw', 'sf_opp_tasks_raw',
    'sf_opp_stage_changes_raw',
    'qb_ar_aging_raw', 'qb_invoices_raw', 'qb_payments_raw',
    'qb_customers_raw'
  ];
  -- table, index name, key columns, included columns. Only what the app
  -- actually joins or filters on; an unused index still costs on every sync.
  indexes text[][] := array[
    ['sf_opp_leads_raw',         'sf_opp_leads_client_idx',      'client__c',                  ''],
    ['sf_opp_leads_raw',         'sf_opp_leads_owner_idx',       'ownerid',                    ''],
    ['sf_opp_leads_raw',         'sf_opp_leads_created_idx',     'createddate',                ''],
    ['sf_opp_leads_raw',         'sf_opp_leads_cover_idx',       'client__c',                  'createddate, stagename'],
    ['sf_opp_tasks_raw',         'sf_opp_tasks_what_idx',        'whatid',                     ''],
    ['sf_opp_stage_changes_raw', 'sf_opp_stage_changes_idx',     'whatid, createddate',        ''],
    ['sf_clients_raw',           'sf_clients_id_idx',            'id',                         ''],
    ['sf_clients_raw',           'sf_clients_account_idx',       'client_account__c',          ''],
    ['qb_invoices_raw',          'qb_invoices_customer_idx',     'customerref_value, txndate', ''],
    ['qb_invoices_raw',          'qb_invoices_docnumber_idx',    'docnumber',                  ''],
    ['qb_payments_raw',          'qb_payments_customer_idx',     'customerref_value, txndate', ''],
    ['qb_customers_raw',         'qb_customers_id_idx',          'id',                         ''],
    ['qb_customers_raw',         'qb_customers_display_idx',     'lower(displayname)',         '']
  ];
begin
  foreach t in array tables
  loop
    -- A table is absent between its drop and recreate, so skip rather than fail.
    if to_regclass('public.' || quote_ident(t)) is null then
      continue;
    end if;

    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', 'authenticated_read_' || t, t);
    execute format('drop policy if exists %I on public.%I', 'factur_users_read_' || t, t);
    /*
     * The subquery is the whole point of this line -- see the header. Removing
     * it puts a quarter of a million function calls back on every read.
     */
    execute format(
      'create policy %I on public.%I for select to authenticated
         using ((select public.is_factur_user()))',
      'factur_users_read_' || t, t);
  end loop;

  for i in 1 .. array_length(indexes, 1)
  loop
    if to_regclass('public.' || quote_ident(indexes[i][1])) is null then
      continue;
    end if;

    if coalesce(indexes[i][4], '') = '' then
      execute format('create index if not exists %I on public.%I (%s)',
                     indexes[i][2], indexes[i][1], indexes[i][3]);
    else
      execute format('create index if not exists %I on public.%I (%s) include (%s)',
                     indexes[i][2], indexes[i][1], indexes[i][3], indexes[i][4]);
    end if;
  end loop;

  /*
   * Statistics last, once the indexes exist. Cheap -- ANALYZE samples rather
   * than reading everything -- and the alternative is a planner working from
   * nothing on a freshly recreated table.
   */
  foreach t in array tables
  loop
    if to_regclass('public.' || quote_ident(t)) is null then
      continue;
    end if;
    execute format('analyze public.%I', t);
  end loop;
end;
$function$;

-- Apply it now rather than waiting for tonight's run.
select public.ensure_staging_ready();
