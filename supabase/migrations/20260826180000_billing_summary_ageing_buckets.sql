/*
 * The ageing split the way the A/R Ageing Summary itself splits it.
 *
 * This was cumulative -- past 30 meaning everything older than thirty days, so
 * each figure contained the ones after it. It now mirrors the report column for
 * column: current, 1-30, 31-60, 61-90, 91 and over, each holding only its own
 * slice, and the five adding up to the total. Anyone comparing the screen to
 * the report in QuickBooks is reading the same five numbers.
 *
 * Payment terms are unchanged: the customer record's default, which is what the
 * next invoice will use, falling back to what the last invoice was billed under.
 */
-- The columns it returns change, which create or replace cannot do.
drop function if exists public.get_client_billing_summary(uuid);

create function public.get_client_billing_summary(p_client_id uuid)
returns table (
  qb_customer text,
  payment_terms text,
  open_balance numeric,
  bucket_current numeric,
  bucket_1_30 numeric,
  bucket_31_60 numeric,
  bucket_61_90 numeric,
  bucket_91_plus numeric
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
    select coalesce(a.total, 0)::numeric        as open_balance,
           coalesce(a.current, 0)::numeric      as bucket_current,
           coalesce(a._1___30, 0)::numeric      as bucket_1_30,
           coalesce(a._31___60, 0)::numeric     as bucket_31_60,
           coalesce(a._61___90, 0)::numeric     as bucket_61_90,
           coalesce(a._91_and_over, 0)::numeric as bucket_91_plus
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
         coalesce(ageing.bucket_current, 0),
         coalesce(ageing.bucket_1_30, 0),
         coalesce(ageing.bucket_31_60, 0),
         coalesce(ageing.bucket_61_90, 0),
         coalesce(ageing.bucket_91_plus, 0)
  from qb
  cross join terms
  left join ageing on true;
$function$;

revoke all on function public.get_client_billing_summary(uuid) from public, anon;
grant execute on function public.get_client_billing_summary(uuid) to authenticated, service_role;
