/*
 * Evaluate policy functions once per statement across the rest of the app.
 *
 * Companion to the staging-table fix in the migration before this one. Only
 * three functions are touched -- is_factur_user, has_permission and
 * can_author_training -- all scalar, and all taking either no argument or a
 * constant one. That is what makes the rewrite provably neutral: they cannot
 * vary by row, so evaluating once gives the same answer for every row.
 *
 * Verified afterwards rather than assumed. An app administrator still sees
 * 1,764 contacts, 987 clients, 18,833 candidates and 909 messages; a member of
 * staff holding no talent permission still sees the contacts and clients and
 * zero candidates and zero messages; anonymous sees nothing at all.
 *
 * Left alone deliberately:
 *   - `my_client_ids()` returns a set and already sits inside a subquery.
 *   - `auth.uid()` appears only on small tables, where the churn would cost
 *     more than the microseconds it saves.
 *
 * Role targeting and permissive/restrictive are carried across. Dropping a
 * `to authenticated` would silently widen a policy to every role, which is the
 * one way a performance change here could become a security one.
 */
do $$
declare
  r record;
  q text;
  w text;
  stmt text;
  target_roles text;
  changed int := 0;
begin
  for r in
    select p.tablename, p.policyname, p.cmd, p.qual, p.with_check,
           p.roles as policy_roles, p.permissive
    from pg_policies p
    where p.schemaname = 'public'
      and (coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) ~
          '(^|[^.\w])(is_factur_user|has_permission|can_author_training)\('
  loop
    q := coalesce(r.qual, '');
    w := coalesce(r.with_check, '');

    q := regexp_replace(q, '(^|[^.\w])is_factur_user\(\)',
                        '\1(select public.is_factur_user())', 'g');
    w := regexp_replace(w, '(^|[^.\w])is_factur_user\(\)',
                        '\1(select public.is_factur_user())', 'g');
    q := regexp_replace(q, '(^|[^.\w])can_author_training\(\)',
                        '\1(select public.can_author_training())', 'g');
    w := regexp_replace(w, '(^|[^.\w])can_author_training\(\)',
                        '\1(select public.can_author_training())', 'g');
    q := regexp_replace(q, '(^|[^.\w])has_permission\(''([a-zA-Z0-9._]+)''::text\)',
                        '\1(select public.has_permission(''\2''::text))', 'g');
    w := regexp_replace(w, '(^|[^.\w])has_permission\(''([a-zA-Z0-9._]+)''::text\)',
                        '\1(select public.has_permission(''\2''::text))', 'g');

    -- Already wrapped, or nothing to do. Makes the migration re-runnable.
    if q = coalesce(r.qual, '') and w = coalesce(r.with_check, '') then
      continue;
    end if;

    target_roles := array_to_string(r.policy_roles, ', ');
    if target_roles is null or target_roles = '' or target_roles = 'public' then
      target_roles := null;
    end if;

    execute format('drop policy %I on public.%I', r.policyname, r.tablename);

    stmt := format('create policy %I on public.%I as %s for %s',
                   r.policyname, r.tablename,
                   case when r.permissive = 'RESTRICTIVE' then 'restrictive' else 'permissive' end,
                   case r.cmd when 'ALL' then 'all' when 'SELECT' then 'select'
                              when 'INSERT' then 'insert' when 'UPDATE' then 'update'
                              else 'delete' end);

    if target_roles is not null then
      stmt := stmt || format(' to %s', target_roles);
    end if;
    if q <> '' and r.cmd <> 'INSERT' then
      stmt := stmt || format(' using (%s)', q);
    end if;
    if w <> '' then
      stmt := stmt || format(' with check (%s)', w);
    end if;

    execute stmt;
    changed := changed + 1;
  end loop;

  raise notice 'rewrote % policies', changed;
end $$;
