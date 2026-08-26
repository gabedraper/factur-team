/*
 * Where a client stands on money, in one row.
 *
 * The ageing figures come from QuickBooks' own AR Ageing Summary rather than
 * being recomputed from invoice due dates. The two disagree on about a sixth of
 * customers -- credits and unapplied payments sit in the report but not on any
 * invoice -- and the report is the number accounting reconciles against, so it
 * is the one the client screen shows. It is also what the health score already
 * uses; two different answers to "what do they owe" on two pages is worse than
 * either answer being slightly off.
 *
 * Past 30 / 60 / 90 are cumulative: everything older than that many days, not
 * the slice between two boundaries. That matches "past 60" as the health score
 * has always meant it.
 *
 * Payment terms come from the customer record, which is what the next invoice
 * will actually use, falling back to what the last invoice was billed under for
 * the customers who have no default set.
 */
create or replace function public.get_client_billing_summary(p_client_id uuid)
returns table (
  qb_customer text,
  payment_terms text,
  open_balance numeric,
  past_30 numeric,
  past_60 numeric,
  past_90 numeric
)
language sql stable security definer set search_path to 'public'
as $function$
  with allowed as (
    select 1 where public.is_factur_user()
      and (public.has_permission('clients.health') or public.has_permission('org.manage'))
  ),
  qb as (
    select qb_customer_id, qb_customer_name
    from public.get_client_quickbooks()
    where client_id = p_client_id and exists (select 1 from allowed)
  ),
  ageing as (
    select coalesce(a.total, 0)::numeric as open_balance,
           (coalesce(a._31___60, 0) + coalesce(a._61___90, 0)
            + coalesce(a._91_and_over, 0))::numeric as past_30,
           (coalesce(a._61___90, 0) + coalesce(a._91_and_over, 0))::numeric as past_60,
           coalesce(a._91_and_over, 0)::numeric as past_90
    from public.qb_ar_aging_raw a
    join qb on a.untitled = qb.qb_customer_name
  ),
  terms as (
    select coalesce(
      (select nullif(trim(c.salestermref_name), '')
         from public.qb_customers_raw c
         join qb on c.id::text = qb.qb_customer_id),
      (select nullif(trim(i.salestermref_name), '')
         from public.qb_invoices_raw i
         join qb on i.customerref_value::text = qb.qb_customer_id
        order by i.txndate desc
        limit 1)
    ) as payment_terms
  )
  select qb.qb_customer_name,
         terms.payment_terms,
         coalesce(ageing.open_balance, 0),
         coalesce(ageing.past_30, 0),
         coalesce(ageing.past_60, 0),
         coalesce(ageing.past_90, 0)
  from qb
  cross join terms
  left join ageing on true;
$function$;

revoke all on function public.get_client_billing_summary(uuid) from public, anon;
grant execute on function public.get_client_billing_summary(uuid) to authenticated, service_role;
