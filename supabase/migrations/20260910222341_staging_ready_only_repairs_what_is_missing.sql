/*
 * ensure_staging_ready() now repairs only what is actually missing.
 *
 * It exists because Coupler drops and recreates the sf_ and qb_ staging tables
 * on every sync, and a recreated table comes back with no RLS, no policy and no
 * indexes. So every ten minutes it put them back.
 *
 * But it did so unconditionally: DROP POLICY and CREATE POLICY on all fourteen
 * tables, every run, whether or not anything had changed. Measured directly,
 * DROP POLICY on these tables takes an AccessExclusiveLock on all sixteen
 * tables in the auth schema -- users, sessions, identities, flow_state and the
 * rest. So every ten minutes, sign-in froze for as long as the run took.
 * Wrapped inside nightly_maintenance() the lock was held for the whole
 * multi-minute maintenance transaction, which is what locked people out of the
 * app outright (fixed separately in maintenance_stops_holding_the_auth_tables).
 *
 * The drop-and-recreate was pointless on almost every run: it replaced a policy
 * with an identical one. Now each table is checked first, and touched only if:
 *   - RLS is off                     -> enable it
 *   - the legacy policy still exists -> drop it
 *   - our policy is missing          -> create it
 * A table Coupler has not just rebuilt needs none of that, so a routine run
 * takes no auth lock at all. A freshly rebuilt table has no policy to drop, so
 * even the repair path mostly skips the statement that caused this.
 *
 * Verified after applying: a routine run locks 0 auth tables (was 16), and all
 * 14 staging tables keep RLS and their is_factur_user() policy.
 *
 * NB: never write a glob like "sf_*" followed by "/" inside a block comment --
 * "*" then "/" ends the comment. The first attempt at this migration failed on
 * exactly that.
 *
 * Indexes and ANALYZE are unchanged.
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
    'qb_customers_raw', 'qb_credit_memos_raw'
  ];
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
    ['qb_customers_raw',         'qb_customers_display_idx',     'lower(displayname)',         ''],
    ['qb_credit_memos_raw',      'qb_credit_memos_customer_idx', 'customerref_value, txndate', '']
  ];
begin
  foreach t in array tables
  loop
    if to_regclass('public.' || quote_ident(t)) is null then
      continue;
    end if;

    -- Only when off. Enabling RLS takes an exclusive lock on the table even
    -- when it is already on.
    if not (select relrowsecurity from pg_class where oid = ('public.' || quote_ident(t))::regclass) then
      execute format('alter table public.%I enable row level security', t);
    end if;

    -- The legacy name, from before the domain check. Dropped only if present.
    if exists (select 1 from pg_policies
               where schemaname = 'public' and tablename = t
                 and policyname = 'authenticated_read_' || t) then
      execute format('drop policy %I on public.%I', 'authenticated_read_' || t, t);
    end if;

    -- Created only if missing. The subquery around is_factur_user() is the
    -- whole point of the using clause: written bare, the domain check runs once
    -- per row -- a quarter of a million times on sf_opp_tasks_raw -- and leaves
    -- the planner with no row estimate.
    if not exists (select 1 from pg_policies
                   where schemaname = 'public' and tablename = t
                     and policyname = 'factur_users_read_' || t) then
      execute format(
        'create policy %I on public.%I for select to authenticated
           using ((select public.is_factur_user()))',
        'factur_users_read_' || t, t);
    end if;
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

  foreach t in array tables
  loop
    if to_regclass('public.' || quote_ident(t)) is null then
      continue;
    end if;
    execute format('analyze public.%I', t);
  end loop;
end;
$function$;
