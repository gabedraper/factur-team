/*
 * Owed and credits on the client screen, so it agrees with the health page.
 *
 * The ageing tiles mirror the A/R Ageing Summary column for column, negative
 * buckets included, and that stays -- it is what QuickBooks shows. But the
 * health page now talks in what a client actually owes, and a client screen
 * saying $2,500 beside a health page saying $8,000 reads as a bug even though
 * both are true.
 *
 * Both figures come out, and the screen shows them only where there is a credit
 * to explain. For everyone else the open balance already is what they owe, and
 * a row of zeroes teaches nobody anything.
 */
drop function if exists public.get_client_billing_summary(uuid);

create function public.get_client_billing_summary(p_client_id uuid)
returns table (
  qb_customer text,
  payment_terms text,
  open_balance numeric,
  owed numeric,
  credits numeric,
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
           coalesce(a._91_and_over, 0)::numeric as bucket_91_plus,
           -- What is actually behind, and what is held against it.
           (greatest(coalesce(a.current, 0), 0) + greatest(coalesce(a._1___30, 0), 0)
            + greatest(coalesce(a._31___60, 0), 0) + greatest(coalesce(a._61___90, 0), 0)
            + greatest(coalesce(a._91_and_over, 0), 0))::numeric as owed,
           (-(least(coalesce(a.current, 0), 0) + least(coalesce(a._1___30, 0), 0)
              + least(coalesce(a._31___60, 0), 0) + least(coalesce(a._61___90, 0), 0)
              + least(coalesce(a._91_and_over, 0), 0)))::numeric as credits
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
    select (elem->>'TxnId') as invoice_id, p.txndate as paid_on
    from public.qb_payments_raw p
    join qb on qb.qb_customer_id = p.customerref_value::text
    cross join lateral unnest(string_to_array(coalesce(p.line_linkedtxn, ''), E'\r')) as part
    cross join lateral jsonb_array_elements(
      case when pg_input_is_valid(part, 'jsonb') then part::jsonb else '[]'::jsonb end) as elem
    where coalesce(p.totalamt, 0) <> 0 and elem->>'TxnType' = 'Invoice'
  ),
  settled as (
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
         coalesce(ageing.owed, 0),
         coalesce(ageing.credits, 0),
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
