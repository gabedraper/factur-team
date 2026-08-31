/*
 * One answer to "is this customer matched", and a suggestion that means
 * something.
 *
 * The linking screen decided matched-or-not from get_client_ar(), which only
 * ever looked at current clients. GRG Design is an inactive client, correctly
 * matched, owing $45,000 -- so the collections board showed it attributed and
 * this screen showed it belonging to nobody. Sixteen customers and $188,432
 * read one way here and the other way there.
 *
 * Both now ask get_client_quickbooks(true), which is the function that actually
 * decides, and the pool of names to suggest widens with it: proposing only
 * current clients for a customer whose client has left could never produce the
 * right answer.
 *
 * A client whose name normalises to nothing -- one of them is written in
 * Chinese characters, which norm_company strips entirely -- is left out of the
 * suggestions. similarity() against it is null, and `order by ... desc` sorts
 * nulls first in Postgres, so that one client was being proposed as the closest
 * match for every unmatched customer in the book, with no score beside it.
 */
create or replace function public.get_unmatched_quickbooks()
returns table (
  qb_customer_name text, owed numeric, overdue_60_plus numeric,
  suggested_client_id uuid, suggested_client_name text, score numeric,
  already_decided boolean
)
language sql stable security definer set search_path to 'public'
as $function$
  with ar as (
    select untitled as name,
           public.norm_company(untitled) as key,
           coalesce(total, 0)::numeric as total,
           (coalesce(_61___90, 0) + coalesce(_91_and_over, 0))::numeric as overdue
    from public.qb_ar_aging_raw
    where public.is_factur_user()
      and untitled is not null and upper(untitled) <> 'TOTAL'
      and coalesce(total, 0) <> 0
  ),
  matched as (
    select qb_customer_name from public.get_client_quickbooks(true)
  ),
  -- Every client, since the one being looked for has usually left.
  cl as (
    select id, name, public.norm_company(name) as key,
           (active and coalesce(status, '') <> 'Inactive') as is_current
    from public.org_clients
    where nullif(trim(public.norm_company(name)), '') is not null
  ),
  unmatched as (
    select ar.* from ar
    where not exists (select 1 from matched m where m.qb_customer_name = ar.name)
  )
  select u.name, u.total, u.overdue,
         best.id, best.name,
         round(best.sim::numeric, 2),
         exists (select 1 from public.client_quickbooks_links l
                  where l.qb_customer_name = u.name)
  from unmatched u
  left join lateral (
    select cl.id, cl.name, similarity(cl.key, u.key) as sim
    from cl
    -- A current client wins a tie; two records of the same name usually differ
    -- only in which of them is still trading.
    order by similarity(cl.key, u.key) desc nulls last, cl.is_current desc
    limit 1
  ) best on true
  order by u.total desc;
$function$;

revoke all on function public.get_unmatched_quickbooks() from public, anon;
grant execute on function public.get_unmatched_quickbooks() to authenticated, service_role;
