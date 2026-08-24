/*
 * Invoice and payment history from QuickBooks, added to the list of staging
 * tables that get their security and indexes restored after every sync.
 *
 * Coupler drops and recreates these on each run, so anything set once by hand
 * is gone by the next sync -- and these are the company's billing records.
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
    'qb_ar_aging_raw', 'qb_invoices_raw', 'qb_payments_raw'
  ];
  -- table, index name, column list. Only what the app actually joins or
  -- filters on; an unused index still costs on every sync.
  indexes text[][] := array[
    ['sf_opp_leads_raw',         'sf_opp_leads_client_idx',      'client__c'],
    ['sf_opp_leads_raw',         'sf_opp_leads_owner_idx',       'ownerid'],
    ['sf_opp_leads_raw',         'sf_opp_leads_created_idx',     'createddate'],
    ['sf_opp_tasks_raw',         'sf_opp_tasks_what_idx',        'whatid'],
    ['sf_opp_stage_changes_raw', 'sf_opp_stage_changes_idx',     'whatid, createddate'],
    ['sf_clients_raw',           'sf_clients_id_idx',            'id'],
    ['sf_clients_raw',           'sf_clients_account_idx',       'client_account__c'],
    ['qb_invoices_raw',          'qb_invoices_customer_idx',     'customerref_value, txndate'],
    ['qb_invoices_raw',          'qb_invoices_docnumber_idx',    'docnumber'],
    ['qb_payments_raw',          'qb_payments_customer_idx',     'customerref_value, txndate']
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
    execute format('create index if not exists %I on public.%I (%s)',
                   indexes[i][2], indexes[i][1], indexes[i][3]);
  end loop;
end;
$function$;

select public.ensure_staging_ready();
