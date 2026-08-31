/*
 * Gaib can read the client roster.
 *
 * The roster, the website profiles and the monthly results landed three days
 * after this list was written and were never added to it, so an agent asked
 * "have we worked with a company like this one?" looked at org_clients, found
 * nothing describing what a client does, and answered that we do not hold it.
 * We do: what they make, their size and their industry are in client_cohorts,
 * and what we produced for them is in client_results_summary.
 *
 * Nothing about who may read what changes. These tables already carry the same
 * is_factur_user() policy as the rest of the list, and the function is still
 * security invoker, so an agent still sees exactly what its user sees.
 *
 * The copy in lib/gaib/tools.ts is the same list and moves with this one.
 */

create or replace function public.gaib_query(p_sql text)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  lowered text := lower(regexp_replace(p_sql, '\s+', ' ', 'g'));
  target text;
  result jsonb;
  ctes text[] := '{}';
  allowed constant text[] := array[
    -- People and structure
    'org_members', 'org_roles', 'org_teams', 'org_services', 'org_assignments',
    'org_permissions', 'org_role_permissions', 'profiles', 'reps', 'google_people',
    -- Clients
    'org_clients', 'org_client_assignments', 'client_history', 'client_contacts',
    'client_aliases', 'client_nps', 'client_quickbooks_links',
    'client_roster', 'client_profile', 'client_cohorts', 'client_service_periods',
    'client_monthly_results', 'client_results_summary',
    -- Money
    'qb_invoices_raw', 'qb_payments_raw', 'qb_ar_aging_raw', 'qb_customers_raw',
    'collections_client_state', 'collections_steps', 'collections_sent',
    -- Salesforce
    'sf_clients_raw', 'sf_opportunities_raw', 'sf_users_raw', 'sf_orders_raw',
    'sf_tasks_raw', 'sf_events_raw', 'sf_opp_stage_changes_raw',
    -- Performance
    'raw_activities', 'deal_activities', 'metric_snapshots', 'timeline_summaries',
    -- Surveys and sequences
    'nps_campaigns', 'nps_sends', 'nps_send_team', 'sequences', 'sequence_runs',
    -- Talent
    'tal_people', 'tal_jobs', 'tal_companies', 'tal_candidates', 'tal_activities',
    'tal_person_jobs', 'tal_person_educations', 'tal_placements', 'tal_applications',
    'tal_workflow_stages', 'tal_workflows', 'tal_lists', 'tal_list_members',
    -- Learning
    'courses', 'modules', 'lessons', 'enrollments', 'lesson_progress', 'certificates'
  ];
begin
  if lowered !~ '^ ?(select|with) ' then
    raise exception 'Only SELECT is allowed here.';
  end if;

  -- One statement. A semicolon is the only way to smuggle a second one past
  -- the check above, so it is refused outright rather than parsed.
  if position(';' in trim(trailing ';' from trim(p_sql))) > 0 then
    raise exception 'Only one statement at a time.';
  end if;

  if lowered ~ '\m(insert|update|delete|drop|alter|grant|revoke|truncate|copy|vacuum|call)\M' then
    raise exception 'Only SELECT is allowed here.';
  end if;

  -- Functions that reach outside the database, or that can be used to sit on a
  -- connection until something times out.
  if lowered ~ '(pg_sleep|dblink|pg_read_file|pg_ls_dir|lo_import|lo_export|pg_stat_file)' then
    raise exception 'That function is not available.';
  end if;

  /*
   * Every table the query names has to be on the list.
   *
   * Read off the words following from and join, which is crude and errs on the
   * strict side: an alias or a subquery keyword that is not a table will fail
   * the check and the agent will be told to rephrase. Being told to rephrase is
   * a cost worth paying for a rule that is short enough to read in full.
   */
  /*
   * Names introduced by a WITH clause are tables for the length of the query.
   * Without this, every common table expression looked like a table nobody had
   * heard of, and the most natural way to write an aggregate was refused. They
   * smuggle nothing: whatever the expression selects from is still checked.
   */
  select coalesce(array_agg(m[1]), '{}')
    into ctes
    from regexp_matches(lowered, '([a-z_][a-z0-9_]*) as \(', 'g') m;

  for target in
    select (regexp_matches(lowered, '(?:from|join) ([a-z_][a-z0-9_.]*)', 'g'))[1]
  loop
    target := replace(target, 'public.', '');
    if not (target = any (allowed)) and not (target = any (ctes)) then
      raise exception 'Table "%" is not available to agents.', target;
    end if;
  end loop;

  -- A query that will not finish is a query nobody is waiting for any more.
  set local statement_timeout = '8s';

  /*
   * The cap belongs inside, around the rows. Outside, it lands on the single
   * aggregated row and silently does nothing -- the worst kind of limit, one
   * that reads as present and is not.
   */
  execute format(
    'select coalesce(jsonb_agg(row_to_json(t)), ''[]''::jsonb) from (select * from (%s) q limit 200) t',
    p_sql
  ) into result;

  return result;
end;
$$;
