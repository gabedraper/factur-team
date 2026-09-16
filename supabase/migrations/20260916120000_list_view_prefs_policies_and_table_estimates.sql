/*
 * Two things the Data section needs.
 *
 * 1. list_view_prefs could not be read or written by anybody.
 *
 * The table was created with row level security enabled and no policies. That
 * is not a half-open door, it is a shut one: with RLS on, a table with no
 * policy denies every row to every ordinary role. Both callers use the
 * user-scoped client, so `resolveViews` has been reading an empty set of
 * preferences and pinView/hideView/moveView have been failing outright since
 * the table was added on 2026-09-10 -- pinning a view has never once worked.
 *
 * The policies below are the obvious ones: your own row, nobody else's. The
 * member id is resolved the same way every other policy in this schema does it,
 * from auth.uid() through org_members, so preferences follow the person rather
 * than the browser.
 *
 * 2. Row counts for the table catalogue.
 *
 * The Data landing page lists what we hold and how much of it. select count(*)
 * on crm_accounts is 913,000 rows of work to draw one number on a page nobody
 * is counting on to be exact, so the estimate the planner already keeps is
 * better: reltuples is maintained by autovacuum and costs a single index seek.
 * It is approximate by nature, and the page says so.
 */

-- 1. Your own preferences, nobody else's.
drop policy if exists list_view_prefs_own on public.list_view_prefs;
create policy list_view_prefs_own on public.list_view_prefs
  for all
  to authenticated
  using (
    public.is_factur_user()
    and member_id = (
      select id from public.org_members
      where active and auth_user_id = auth.uid()
      limit 1
    )
  )
  with check (
    public.is_factur_user()
    and member_id = (
      select id from public.org_members
      where active and auth_user_id = auth.uid()
      limit 1
    )
  );

revoke all on public.list_view_prefs from public, anon;
grant select, insert, update, delete on public.list_view_prefs to authenticated;

-- 2. What the planner already knows about how big a table is.
create or replace function public.data_table_estimates(p_names text[])
returns table (table_name text, approx_rows bigint)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select c.relname::text, greatest(c.reltuples, 0)::bigint
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'm')
    and c.relname = any (p_names)
    and public.is_factur_user()
$function$;

revoke all on function public.data_table_estimates(text[]) from public, anon;
grant execute on function public.data_table_estimates(text[]) to authenticated;
