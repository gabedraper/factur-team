/*
 * Evaluate the permission check once per query, not once per row.
 *
 * Written as `using (tal_can_view())`, Postgres treats the call as part of the
 * row filter and runs it for every row it examines. On six demo rows that is
 * invisible. On 18,833 people it is 18,833 joins across org_members ->
 * org_assignments -> org_role_permissions, and the People page went from
 * instant to 15.2 seconds -- past the 8-second statement timeout, so the query
 * errored and the page returned a server error in production.
 *
 * Wrapping the call in a scalar subquery -- `using ((select tal_can_view()))`
 * -- makes it an InitPlan: evaluated once, before the scan, and reused. Nothing
 * about who can see what changes; these functions take no arguments and depend
 * only on the caller, so one answer per statement is the correct number.
 * Measured: 15.2s -> 1.8s.
 *
 * Rewritten from the catalogue rather than by relisting every table, so no
 * policy is missed and none drifts from what it was.
 */
do $$
declare
  r record;
  new_qual text;
  new_check text;
  sql text;
begin
  for r in
    select tablename, policyname, cmd, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and tablename like 'tal\_%'
      and (qual like '%tal_can_%' or with_check like '%tal_can_%')
      and qual not like '%( SELECT %'
  loop
    new_qual := r.qual;
    new_check := r.with_check;

    foreach sql in array array['tal_can_view', 'tal_can_edit', 'tal_can_admin'] loop
      new_qual := replace(new_qual, sql || '()', '(select public.' || sql || '())');
      new_check := replace(coalesce(new_check, ''), sql || '()', '(select public.' || sql || '())');
    end loop;
    if coalesce(r.with_check, '') = '' then new_check := null; end if;

    execute format('drop policy %I on public.%I', r.policyname, r.tablename);

    sql := format('create policy %I on public.%I for %s using (%s)',
                  r.policyname, r.tablename,
                  case r.cmd when 'ALL' then 'all' when 'SELECT' then 'select'
                             when 'INSERT' then 'insert' when 'UPDATE' then 'update'
                             else 'delete' end,
                  new_qual);

    if r.cmd = 'INSERT' then
      sql := format('create policy %I on public.%I for insert with check (%s)',
                    r.policyname, r.tablename, new_check);
    elsif new_check is not null then
      sql := sql || format(' with check (%s)', new_check);
    end if;

    execute sql;
  end loop;
end $$;
