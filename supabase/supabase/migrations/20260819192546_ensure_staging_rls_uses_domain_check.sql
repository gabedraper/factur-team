-- nightly_maintenance() calls ensure_staging_rls() every night, and that
-- function recreated the wide-open `USING (true)` read policies -- so last
-- migration's fix would have been reverted on the next run. Rewrite it to
-- reassert the domain-restricted policies instead, keeping it idempotent.

create or replace function public.ensure_staging_rls()
returns void
language plpgsql
set search_path = public, pg_catalog
as $fn$
declare
  t text;
begin
  foreach t in array array[
    'sf_tasks_raw', 'sf_events_raw', 'sf_clients_raw',
    'sf_opportunities_raw', 'sf_orders_raw', 'sf_users_raw'
  ]
  loop
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
$fn$;

-- Pin the helper's search_path too, so it can't be shadowed at call time.
create or replace function public.is_factur_user()
returns boolean
language sql
stable
set search_path = public, pg_catalog
as $$
  select lower(split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 2))
         in ('facturmfg.com', 'bethefactur.com');
$$;
