/*
 * Two more sources into the client conversation trail:
 *
 * - collections_sms_sent, the texting counterpart to the existing
 *   collections_sent branch. There's no inbound-SMS ingestion (no Dialpad
 *   webhook wired up), so this only ever shows what was sent, never a
 *   client's reply -- same asymmetry as collections email had before Gmail
 *   ingest caught up to it, just permanent here until that's built.
 *
 * - work_items (the ClickUp mirror), gated on its own permission
 *   (work.view or org.manage) rather than folded into the conversation's
 *   own clients.health gate -- someone who can see a client's health
 *   shouldn't automatically see internal task detail they couldn't already
 *   see on the same page's Work panel.
 */
create or replace function public.get_client_conversation(p_client_id uuid)
returns table(occurred_at timestamp with time zone, on_date date, kind text, direction text, side text, source text, author text, title text, preview text, invoice_no text, service_month date, service text, line_description text, unit_price numeric, quantity numeric, due_date date, bill_email text, amount numeric, outstanding numeric, matched_by text, external_id text, url text)
language sql
stable security definer
set search_path to 'public'
as $function$
  with allowed as (
    select 1 where public.is_factur_user()
      and (public.has_permission('clients.health') or public.has_permission('org.manage'))
  ),
  work_allowed as (
    select 1 where public.is_factur_user()
      and (public.has_permission('work.view') or public.has_permission('org.manage'))
  ),
  qb as (
    select qb_customer_id from public.get_client_quickbooks(true) where client_id = p_client_id
  ),
  invoices as (
    select inv.txndate, inv.docnumber, inv.totalamt, inv.balance, inv.id,
           inv.invoicelink, inv.emailstatus, inv.duedate, inv.billemail_address,
           date_trunc('month', inv.txndate)::date as month,
           substring(inv.line_salesitemlinedetail
                     from '"ItemRef":\{"value":"[0-9]+","name":"([^"]+)"') as service,
           nullif(substring(inv.line_salesitemlinedetail from '"UnitPrice":([0-9.]+)'), '')::numeric as unit_price,
           nullif(substring(inv.line_salesitemlinedetail from '"Qty":([0-9.]+)'), '')::numeric as qty,
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
  anchor as (
    select min(i.duedate)::date as on_date,
           (current_date - min(i.duedate)::date)::int as days_past_due
    from public.qb_invoices_raw i
    join qb on qb.qb_customer_id = i.customerref_value::text
    where i.balance > 0 and i.duedate < current_date
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

    union all

    select cs.sent_at, null, 'collections', 'outbound', 'us', null,
           coalesce(cs.sent_by, 'collections'),
           cs.subject,
           left(regexp_replace(cs.body, E'\\s+', ' ', 'g'), 240),
           null, null, cs.mode, null, null, null, null, cs.to_email,
           null, null,
           null, cs.id::text,
           case when cs.rfc_message_id is not null
                then 'https://mail.google.com/mail/u/0/#search/rfc822msgid%3A'
                     || replace(replace(cs.rfc_message_id, '<', ''), '>', '')
                else null end
    from public.collections_sent cs
    where cs.client_id = p_client_id
      and exists (select 1 from allowed)
      and not exists (
        select 1 from public.comm_messages m
        where m.source = 'gmail' and m.external_id = cs.rfc_message_id
      )

    union all

    select null, (anchor.on_date + s.days_past_due)::date, 'collections_upcoming',
           null, 'us', null, null,
           ('Step ' || s.position || ' chase')::text,
           ('day ' || s.days_past_due || ' of the sequence')::text,
           null, null,
           case when (anchor.on_date + s.days_past_due) <= current_date
                then 'due' else 'scheduled' end,
           null, null, null, null, null,
           null, null,
           null, s.id::text, null
    from public.collections_steps s
    cross join anchor
    join public.collections_client_state st on st.client_id = p_client_id
    where exists (select 1 from allowed)
      and s.active
      and anchor.on_date is not null
      and st.overdue_since is not null
      and not exists (
        select 1 from public.collections_sent cs
        where cs.client_id = p_client_id and cs.step_id = s.id
          and cs.sent_at::date >= st.overdue_since
      )

    union all

    /*
     * A collections text sent -- see the module comment above for why this
     * never shows an inbound side.
     */
    select cs.sent_at, null, 'collections_sms', 'outbound', 'us', null,
           coalesce(m.full_name, m.email, 'collections'),
           'Text sent'::text,
           left(regexp_replace(cs.body, E'\\s+', ' ', 'g'), 240),
           null, null, null, null, null, null, null, cs.to_phone,
           null, null,
           null, cs.id::text, null
    from public.collections_sms_sent cs
    left join public.org_members m on m.id = cs.sent_by
    where cs.client_id = p_client_id
      and exists (select 1 from allowed)

    union all

    /*
     * Notes somebody wrote here. Only the unpinned ones: a pinned note has been
     * lifted out to the top of the screen deliberately, and leaving a copy in
     * the trail would undo the pinning.
     */
    select n.created_at, null, 'note', null, 'internal', null,
           coalesce(n.author_email, 'someone'),
           'Note'::text,
           n.body,
           null, null, null, null, null, null, null, null,
           null, null,
           null, n.id::text, null
    from public.client_notes n
    where n.client_id = p_client_id
      and not n.pinned
      and exists (select 1 from allowed)

    union all

    /*
     * Open ClickUp work against this client. Gated on work_allowed, not
     * allowed -- clients.health doesn't imply seeing internal task detail.
     */
    select wi.created_at_remote, null, 'task', null, 'internal', null,
           wi.pod,
           wi.title::text,
           wi.status::text,
           null, null, null, null, null, null,
           wi.due_at::date, null,
           null, null,
           null, wi.id::text, wi.clickup_url::text
    from public.work_items wi
    where wi.client_id = p_client_id
      and wi.status_type in ('open', 'custom')
      and exists (select 1 from work_allowed)
  )
  select a, b, c, d, e, f, g, h, i, j, k, l, m1, n1, o1, p1, q1, r1, s1, t1, u1, v1
  from everything
  order by coalesce((a at time zone 'America/Chicago')::date, b) desc, a desc nulls last;
$function$;
