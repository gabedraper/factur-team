/*
 * Every client with at least one opportunity, for the My Opportunities
 * client picker -- security invoker (the default), so it runs as the
 * calling user and opportunities_scoped RLS still limits this to their own
 * clients (or every client for org.manage). A plain distinct query rather
 * than sampling rows client-side: one client alone can carry tens of
 * thousands of opportunities, so a capped sample risks silently dropping a
 * client whose rows just don't happen to land in it.
 */
create or replace function public.my_pursuit_clients()
returns table(client_id uuid, name text)
language sql
stable
set search_path to 'public'
as $function$
  select distinct o.client_id, c.name
  from public.opportunities o
  join public.org_clients c on c.id = o.client_id
  order by c.name;
$function$;

revoke all on function public.my_pursuit_clients() from public, anon;
grant execute on function public.my_pursuit_clients() to authenticated;
