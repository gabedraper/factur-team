/*
 * Two additions to what runs after a Coupler sync.
 *
 * A covering index for the client-health lead counts. That query reads every
 * lead row -- three of its four counters are time-boxed but the quote counts
 * are all-time, so there is nothing to filter on -- and reading them out of
 * the index instead of the table took it from a 90k-row sequential scan to an
 * index-only scan. Measured on the whole client-health query: 5.8s to 1.4s.
 *
 * And ANALYZE. Coupler drops and recreates these tables, and a recreated table
 * has no statistics at all: the planner believes it is empty and builds joins
 * for nothing, then meets ninety thousand rows. Today org_clients reported
 * zero rows while holding 985, which is how /clients/health ended up over the
 * statement timeout. Until now it was luck whether autovacuum reached a table
 * before somebody opened the page that reads it.
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
  -- The fourth column is empty unless the index needs to carry payload
  -- columns so a read can be answered without touching the table.
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

    if coalesce(indexes[i][4], '') = '' then
      execute format('create index if not exists %I on public.%I (%s)',
                     indexes[i][2], indexes[i][1], indexes[i][3]);
    else
      execute format('create index if not exists %I on public.%I (%s) include (%s)',
                     indexes[i][2], indexes[i][1], indexes[i][3], indexes[i][4]);
    end if;
  end loop;

  /*
   * Statistics last, once the indexes exist.
   *
   * Cheap -- ANALYZE samples rather than reading everything -- and the
   * alternative is a planner working from nothing on a freshly recreated
   * table, which is not a slow plan so much as an arbitrary one.
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
