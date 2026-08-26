/*
 * How long this client takes to pay, invoice date to payment date.
 *
 * A payment carries the invoices it was applied to on its lines, as raw JSON
 * QuickBooks returned, one line per applied transaction. That is the only link
 * between the two -- matching on amount would tie a payment to whichever
 * invoice happened to cost the same -- so the lines are unpicked here.
 *
 * Only invoices that are fully settled count. A part-paid invoice would take
 * the date of the payment that did not finish it and report a client as
 * quicker than they were.
 *
 * Payments dated before the invoice they settle are real and not rare: money
 * already sitting on account when the invoice was raised. They count as nought
 * days rather than being dropped, since dropping them would make the clients
 * who pay ahead look like the slowest of all.
 */
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
  bucket_91_plus numeric,
  avg_days_to_pay numeric,
  invoices_paid integer
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
  ),
  applied as (
    -- Lines arrive joined by carriage returns, each its own JSON array. A line
    -- that is not valid JSON is stepped over rather than failing the page.
    select (elem->>'TxnId') as invoice_id, p.txndate as paid_on
    from public.qb_payments_raw p
    join qb on qb.qb_customer_id = p.customerref_value::text
    cross join lateral unnest(string_to_array(coalesce(p.line_linkedtxn, ''), E'\r')) as part
    cross join lateral jsonb_array_elements(
      case when pg_input_is_valid(part, 'jsonb') then part::jsonb else '[]'::jsonb end) as elem
    where coalesce(p.totalamt, 0) <> 0 and elem->>'TxnType' = 'Invoice'
  ),
  settled as (
    -- The payment that finished it, where more than one was applied.
    select invoice_id, max(paid_on) as paid_on from applied group by invoice_id
  ),
  speed as (
    select round(avg(greatest(s.paid_on - i.txndate, 0)), 0)::numeric as avg_days_to_pay,
           count(*)::integer as invoices_paid
    from public.qb_invoices_raw i
    join qb on qb.qb_customer_id = i.customerref_value::text
    join settled s on s.invoice_id = i.id::text
    where coalesce(i.balance, 0) = 0
  )
  select qb.qb_customer_name,
         terms.payment_terms,
         coalesce(ageing.open_balance, 0),
         coalesce(ageing.bucket_current, 0),
         coalesce(ageing.bucket_1_30, 0),
         coalesce(ageing.bucket_31_60, 0),
         coalesce(ageing.bucket_61_90, 0),
         coalesce(ageing.bucket_91_plus, 0),
         speed.avg_days_to_pay,
         coalesce(speed.invoices_paid, 0)
  from qb
  cross join terms
  cross join speed
  left join ageing on true;
$function$;

revoke all on function public.get_client_billing_summary(uuid) from public, anon;
grant execute on function public.get_client_billing_summary(uuid) to authenticated, service_role;
