/*
 * QuickBooks names a customer its own way: "Abt, Inc." in Salesforce is
 * "Abt Inc" in the books. Matching strips punctuation, the usual corporate
 * suffixes and case, leaving a key that survives both spellings.
 */
create or replace function public.norm_company(name text)
returns text
language sql immutable
as $$
  select nullif(
    regexp_replace(
      regexp_replace(lower(coalesce(name, '')), '\s+(inc|llc|ltd|corp|corporation|co|company|holdings|group)\.?$', '', 'g'),
      '[^a-z0-9]', '', 'g'),
    '');
$$;

/*
 * Which QuickBooks customer belongs to which client.
 *
 * A match is only used when it is unambiguous in both directions -- one client
 * for that name, one name for that client. Two customers normalising to the
 * same key ("Geospace" and "Geospace - Machining" do not, but near-misses
 * exist) would otherwise attach one company's debt to another, and a wrong
 * number here is worse than no number: it is the difference between calling a
 * client about an overdue invoice they have already paid and not calling at all.
 */
create or replace view public.client_ar
with (security_invoker = true) as
with qb as (
  select untitled as customer,
         public.norm_company(untitled) as key,
         coalesce(current, 0)      as bucket_current,
         coalesce(_1___30, 0)      as bucket_1_30,
         coalesce(_31___60, 0)     as bucket_31_60,
         coalesce(_61___90, 0)     as bucket_61_90,
         coalesce(_91_and_over, 0) as bucket_91_plus,
         coalesce(total, 0)        as total
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
  select key,
         (select count(*) from cl where cl.key = k.key) as clients_here,
         (select count(*) from qb where qb.key = k.key) as customers_here
  from (select distinct key from qb union select distinct key from cl) k
)
select cl.id as client_id, cl.name as client_name,
       qb.customer as quickbooks_customer,
       qb.bucket_current, qb.bucket_1_30, qb.bucket_31_60,
       qb.bucket_61_90, qb.bucket_91_plus, qb.total,
       -- Anything past 60 days is the part worth ringing about.
       qb.bucket_61_90 + qb.bucket_91_plus as overdue_60_plus
from cl
join counts c on c.key = cl.key
join qb on qb.key = cl.key
where c.clients_here = 1 and c.customers_here = 1;
