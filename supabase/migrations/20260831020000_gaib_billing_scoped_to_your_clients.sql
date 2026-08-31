/*
 * Billing questions, answered for the clients you are allowed to see.
 *
 * Two things forced this to be a function rather than a policy on the tables.
 *
 * The first is that a policy would not survive. Coupler drops and recreates
 * qb_invoices_raw and its neighbours on every sync, and anything attached to
 * them goes with it -- which is the same reason those tables were sitting open
 * to the internet this morning. A rule that is wiped every few hours is not a
 * rule.
 *
 * The second is that the raw tables are the wrong source anyway. Matching a
 * QuickBooks customer to a client, netting credits off a balance and bucketing
 * an ageing report are all decisions the app already makes, in
 * get_client_ar(). An agent reading the raw rows would do its own arithmetic
 * and quietly disagree with the screens, which is worse than refusing to
 * answer -- two numbers and no way to tell which is right.
 *
 * So the agent gets this instead, and the raw tables are taken off the list it
 * may query at all.
 *
 * Who sees what follows the rule the app already uses for money, rather than a
 * second one invented here:
 *
 *   everything   org.manage, finance.collections, or anyone with direct reports
 *   their own    every other signed-in person, via my_client_ids(), which
 *                already includes the clients of anyone reporting to them
 */
create or replace function public.gaib_billing(
  p_client text default null,
  p_detail boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_all boolean;
  v_result jsonb;
  v_client_id uuid;
begin
  if not public.is_factur_user() then
    raise exception 'Not signed in.';
  end if;

  select can_see_all into v_all from public.collections_visibility();

  /*
   * The summary. One row per client with a balance, ageing already bucketed.
   *
   * Ordered by what is most overdue rather than by name, because every question
   * that reaches this without naming a client is some version of "who owes us
   * and how badly".
   */
  if not p_detail then
    select coalesce(jsonb_agg(to_jsonb(r) order by r.overdue_60_plus desc nulls last), '[]'::jsonb)
      into v_result
      from (
        select ar.*
          from public.get_client_ar() ar
         where (v_all or ar.client_id in (select client_id from public.my_client_ids()))
           and (p_client is null or ar.client_name ilike '%' || p_client || '%')
         limit 100
      ) r;

    return jsonb_build_object(
      'scope', case when v_all then 'every client' else 'your clients only' end,
      'clients', v_result
    );
  end if;

  -- The detail. One client, named, with what has actually been billed and paid.
  select ar.client_id into v_client_id
    from public.get_client_ar() ar
   where (v_all or ar.client_id in (select client_id from public.my_client_ids()))
     and p_client is not null
     and ar.client_name ilike '%' || p_client || '%'
   order by ar.total desc nulls last
   limit 1;

  if v_client_id is null then
    /*
     * Deliberately does not say whether the client exists.
     *
     * "No such client" and "not one of yours" are different facts, and telling
     * somebody which one they hit turns this into a way to enumerate the client
     * list. The agent is told to say it cannot see it rather than that there is
     * nothing there.
     */
    return jsonb_build_object('found', false,
      'scope', case when v_all then 'every client' else 'your clients only' end);
  end if;

  select jsonb_build_object(
           'found', true,
           'client_id', v_client_id,
           'summary', (select to_jsonb(s) from public.get_client_billing_summary(v_client_id) s),
           'trail', coalesce((
             select jsonb_agg(to_jsonb(t) order by t.at desc)
               from (select * from public.get_client_billing_trail(v_client_id) limit 60) t
           ), '[]'::jsonb)
         )
    into v_result;

  return v_result;
end;
$$;

revoke all on function public.gaib_billing(text, boolean) from public, anon;
grant execute on function public.gaib_billing(text, boolean) to authenticated;

/*
 * And take the sync's tables off the list an agent may query.
 *
 * They cannot be protected -- every sync hands them back to anon with row level
 * security off, and the watchdog that closes that runs afterwards rather than
 * instead. Nothing an agent needs is only available there: billing comes from
 * gaib_billing above, and the client, activity and NPS tables it does still
 * reach are ordinary tables that keep their policies.
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
    'org_members','org_roles','org_teams','org_services','org_assignments',
    'org_permissions','org_role_permissions','profiles','reps','google_people',
    'org_clients','org_client_assignments','client_history','client_contacts',
    'client_aliases','client_nps','client_quickbooks_links',
    'collections_client_state','collections_steps','collections_sent',
    'raw_activities','deal_activities','metric_snapshots','timeline_summaries',
    'nps_campaigns','nps_sends','nps_send_team','sequences','sequence_runs',
    'tal_people','tal_jobs','tal_companies','tal_candidates','tal_activities',
    'tal_person_jobs','tal_person_educations','tal_placements','tal_applications',
    'tal_workflow_stages','tal_workflows','tal_lists','tal_list_members',
    'courses','modules','lessons','enrollments','lesson_progress','certificates'
  ];
begin
  if lowered !~ '^ ?(select|with) ' then
    raise exception 'Only SELECT is allowed here.';
  end if;

  if position(';' in trim(trailing ';' from trim(p_sql))) > 0 then
    raise exception 'Only one statement at a time.';
  end if;

  if lowered ~ '\m(insert|update|delete|drop|alter|grant|revoke|truncate|copy|vacuum|call)\M' then
    raise exception 'Only SELECT is allowed here.';
  end if;

  if lowered ~ '(pg_sleep|dblink|pg_read_file|pg_ls_dir|lo_import|lo_export|pg_stat_file)' then
    raise exception 'That function is not available.';
  end if;

  select coalesce(array_agg(m[1]), '{}')
    into ctes
    from regexp_matches(lowered, '([a-z_][a-z0-9_]*) as \(', 'g') m;

  for target in
    select (regexp_matches(lowered, '(?:from|join) ([a-z_][a-z0-9_.]*)', 'g'))[1]
  loop
    target := replace(target, 'public.', '');
    if not (target = any (allowed)) and not (target = any (ctes)) then
      if target like 'qb\_%' or target like 'sf\_%' then
        raise exception 'Billing and Salesforce figures come from the billing tool, not from "%".', target;
      end if;
      raise exception 'Table "%" is not available to agents.', target;
    end if;
  end loop;

  set local statement_timeout = '8s';

  execute format(
    'select coalesce(jsonb_agg(row_to_json(t)), ''[]''::jsonb) from (select * from (%s) q limit 200) t',
    p_sql
  ) into result;

  return result;
end;
$$;
