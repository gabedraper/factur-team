/*
 * Which QuickBooks customer belongs to which client, and what they owe.
 *
 * A function rather than a view, deliberately. Coupler drops and recreates its
 * destination table on every run, and a view built on that table is dropped
 * with it -- which took the whole Client Health page down with a 500 the first
 * time the sync ran after it was created. Postgres does not track a function
 * body's dependencies, so this survives the table being replaced underneath it.
 *
 * A match is only used when it is unambiguous in both directions -- one client
 * for that name, one customer for that client. Attaching one company's debt to
 * another is worse than showing no figure: it is the difference between
 * chasing a client who has already paid and not chasing at all.
 */
create or replace function public.get_client_ar()
returns table (
  client_id uuid, client_name text, quickbooks_customer text,
  bucket_current numeric, bucket_1_30 numeric, bucket_31_60 numeric,
  bucket_61_90 numeric, bucket_91_plus numeric,
  total numeric, overdue_60_plus numeric
)
language sql stable security definer set search_path to 'public'
as $$
  with qb as (
    select untitled as customer,
           public.norm_company(untitled) as key,
           coalesce(current, 0)::numeric      as bucket_current,
           coalesce(_1___30, 0)::numeric      as bucket_1_30,
           coalesce(_31___60, 0)::numeric     as bucket_31_60,
           coalesce(_61___90, 0)::numeric     as bucket_61_90,
           coalesce(_91_and_over, 0)::numeric as bucket_91_plus,
           coalesce(total, 0)::numeric        as total
    from public.qb_ar_aging_raw
    -- The report's own footer row, not a customer.
    where untitled is not null and upper(untitled) <> 'TOTAL'
  ),
  cl as (
    select id, name, public.norm_company(name) as key
    from public.org_clients
    where active and coalesce(status, '') <> 'Inactive'
  ),
  counts as (
    select k.key,
           (select count(*) from cl where cl.key = k.key) as clients_here,
           (select count(*) from qb where qb.key = k.key) as customers_here
    from (select distinct key from qb union select distinct key from cl) k
  )
  select cl.id, cl.name, qb.customer,
         qb.bucket_current, qb.bucket_1_30, qb.bucket_31_60,
         qb.bucket_61_90, qb.bucket_91_plus, qb.total,
         -- Anything past sixty days is the part worth ringing about.
         qb.bucket_61_90 + qb.bucket_91_plus
  from cl
  join counts c on c.key = cl.key
  join qb on qb.key = cl.key
  where c.clients_here = 1 and c.customers_here = 1;
$$;

revoke all on function public.get_client_ar() from public, anon;
grant execute on function public.get_client_ar() to authenticated, service_role;
