/*
 * Turning an address into the person who signs in with it.
 *
 * Needed by anything that receives a message from outside the app -- Google
 * Chat first -- where all that arrives is an address Google has vouched for.
 *
 * security definer because auth.users is not readable through the API, and
 * narrow on purpose: it takes one address and returns one id and name. It
 * cannot be used to walk the list, which matters because it is reachable by
 * anything holding a session. The domain is checked here as well as by the
 * caller, so a lookalike address finds nobody rather than finding somebody.
 */
create or replace function public.user_for_email(p_email text)
returns table (user_id uuid, full_name text)
language sql
stable
security definer
set search_path = public, pg_catalog, auth
as $$
  select u.id, p.full_name
    from auth.users u
    left join public.profiles p on p.id = u.id
   where lower(u.email) = lower(trim(p_email))
     and lower(split_part(u.email, '@', 2)) in ('bethefactur.com', 'facturmfg.com')
   limit 1;
$$;

revoke all on function public.user_for_email(text) from public, anon, authenticated;
