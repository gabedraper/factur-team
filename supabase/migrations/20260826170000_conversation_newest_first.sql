/*
 * The money conversation, newest first.
 *
 * It was built oldest-first, like a chat window, which reads well the once and
 * badly every time after: the thing anyone opens this page to see is what
 * happened last, and that sat at the bottom of years of history.
 *
 * Only the final sort changes. Within a day the order is reversed too, so a
 * reply still appears above the message it answers.
 */
create or replace function public.get_client_conversation(p_client_id uuid)
returns table (
  occurred_at timestamp with time zone, on_date date, kind text, direction text,
  side text, source text, author text, title text, preview text,
  invoice_no text, service_month date, service text, line_description text,
  unit_price numeric, quantity numeric, due_date date, bill_email text,
  amount numeric, outstanding numeric, matched_by text, external_id text, url text
)
language sql stable security definer set search_path to 'public'
as $function$
  with allowed as (
    select 1 where public.is_factur_user()
      and (public.has_permission('clients.health') or public.has_permission('org.manage'))
  ),
  qb as (
    select qb_customer_id from public.get_client_quickbooks() where client_id = p_client_id
  ),
  invoices as (
    select inv.txndate, inv.docnumber, inv.totalamt, inv.balance, inv.id,
           inv.invoicelink, inv.emailstatus, inv.duedate, inv.billemail_address,
           date_trunc('month', inv.txndate)::date as month,
           -- Line detail is stored as the raw JSON QuickBooks returned, so the
           -- pieces worth showing are pulled out of it here.
           substring(inv.line_salesitemlinedetail
                     from '"ItemRef":\{"value":"[0-9]+","name":"([^"]+)"') as service,
           nullif(substring(inv.line_salesitemlinedetail from '"UnitPrice":([0-9.]+)'), '')::numeric as unit_price,
           nullif(substring(inv.line_salesitemlinedetail from '"Qty":([0-9.]+)'), '')::numeric as qty,
           -- QuickBooks repeats the description with a carriage return between.
           split_part(coalesce(inv.line_description, ''), E'\r', 1) as line_desc
    from public.qb_invoices_raw inv
    join qb on qb.qb_customer_id = inv.customerref_value::text
    where exists (select 1 from allowed)
  ),
  gaps as (
    select gs::date as month
    from invoices,
         lateral generate_series(
           (select min(month) from invoices),
           least((select max(month) from invoices), date_trunc('month', current_date)::date),
           interval '1 month') gs
    where not exists (select 1 from invoices i where i.month = gs::date)
    group by gs
  ),
  everything as (
    select m.occurred_at a, null::date b, 'message'::text c, m.direction d,
           (case when m.direction = 'inbound' then 'client'
                 when m.direction = 'outbound' then 'us' else 'internal' end)::text e,
           m.source f, coalesce(m.author_name, m.author_email, 'unknown')::text g,
           coalesce(m.subject, '(no subject)')::text h, m."extract" i,
           null::text j, null::date k, null::text l,
           null::text m1, null::numeric n1, null::numeric o1,
           null::date p1, null::text q1,
           null::numeric r1, null::numeric s1,
           m.matched_by t1, coalesce(m.gmail_id, m.external_id) u1, m.url v1
    from public.comm_messages m
    where m.client_id = p_client_id and exists (select 1 from allowed)

    union all

    select null, inv.txndate, 'invoice', null, 'us', null, null, null,
           nullif(concat_ws(' · ',
             case inv.emailstatus when 'EmailSent' then 'emailed'
                                  when 'NeedToSend' then 'not sent yet' else null end,
             case when inv.duedate is not null
                  then 'due ' || to_char(inv.duedate, 'DD Mon') end), '')::text,
           coalesce(inv.docnumber::text, inv.id::text), inv.month, inv.service,
           nullif(inv.line_desc, ''), inv.unit_price, inv.qty,
           inv.duedate, inv.billemail_address,
           inv.totalamt::numeric, inv.balance::numeric,
           null, inv.id::text, inv.invoicelink::text
    from invoices inv

    union all

    select null, pay.txndate, 'payment', null, 'client', null, null,
           'Payment received'::text, null,
           null, null, null, null, null, null, null, null,
           pay.totalamt::numeric, null,
           null, pay.id::text, null
    from public.qb_payments_raw pay
    join qb on qb.qb_customer_id = pay.customerref_value::text
    where exists (select 1 from allowed) and coalesce(pay.totalamt, 0) <> 0

    union all

    select null, g.month, 'gap', null, 'us', null, null, null, null,
           null, g.month, null, null, null, null, null, null, null, null,
           null, null, null
    from gaps g
  )
  select a, b, c, d, e, f, g, h, i, j, k, l, m1, n1, o1, p1, q1, r1, s1, t1, u1, v1
  from everything
  order by coalesce((a at time zone 'America/Chicago')::date, b) desc, a desc nulls last;
$function$;

revoke all on function public.get_client_conversation(uuid) from public, anon;
grant execute on function public.get_client_conversation(uuid) to authenticated, service_role;
