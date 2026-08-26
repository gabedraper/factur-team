/*
 * The mode switch, a starting ladder, and chases in the billing feed.
 *
 * Semi-auto leaves a draft in her mailbox for her to read and send. Full auto
 * sends it. It starts on semi and it starts with every step switched off:
 * wording that goes to a customer should be read by a person once before it
 * ever goes anywhere, and a fresh install that quietly began emailing would be
 * the worst possible first impression.
 */
create table if not exists public.collections_settings (
  -- One row, and the check keeps it that way.
  id boolean primary key default true check (id),
  mode text not null default 'semi' check (mode in ('semi', 'full')),
  send_as text not null default 'brenolene.govender@facturmfg.com',
  updated_at timestamptz not null default now(),
  updated_by text
);

insert into public.collections_settings (id) values (true) on conflict (id) do nothing;

alter table public.collections_settings enable row level security;

drop policy if exists collections_settings_read on public.collections_settings;
create policy collections_settings_read on public.collections_settings
  for select to authenticated
  using (public.is_factur_user()
         and (public.has_permission('clients.health')
              or public.has_permission('finance.collections')
              or public.has_permission('org.manage')));

/*
 * A ladder to start from, switched off. The figures in braces are filled in
 * per client when the email is built.
 */
insert into public.collections_steps (position, days_past_due, subject, body, active)
select * from (values
  (1, 7,
   'Factur invoice {{oldest_invoice}} — friendly reminder',
   E'Hi {{contact}},\n\nA quick note that the following is now showing as unpaid on your account with Factur:\n\n{{invoices}}\n\nTotal past due: {{past_due}}\nPayment terms: {{terms}}\n\nIf it has already been paid, please ignore this and send me the remittance so I can match it up. If anything looks wrong, tell me and I will sort it out.\n\nKind regards,\n{{sender}}',
   false),
  (2, 21,
   'Factur invoice {{oldest_invoice}} — {{days}} days past due',
   E'Hi {{contact}},\n\nFollowing up on the below, which is now {{days}} days past due:\n\n{{invoices}}\n\nTotal past due: {{past_due}}\n\nCould you let me know when we can expect payment, or put me in touch with whoever handles your accounts payable?\n\nKind regards,\n{{sender}}',
   false),
  (3, 45,
   'Overdue balance for {{client}} — {{past_due}}',
   E'Hi {{contact}},\n\nWe have not yet received payment on the following, the oldest of which is now {{days}} days past due:\n\n{{invoices}}\n\nTotal past due: {{past_due}}\n\nI would like to get this settled without it going any further. Please reply today with a payment date.\n\nKind regards,\n{{sender}}',
   false),
  (4, 60,
   'Account on hold — {{client}}',
   E'Hi {{contact}},\n\nThe balance below is now {{days}} days past due and I have not had a reply:\n\n{{invoices}}\n\nTotal past due: {{past_due}}\n\nUnless we hear from you, the account will be placed on hold and passed on internally. I would much rather resolve it with you directly — please call or reply today.\n\nKind regards,\n{{sender}}',
   false)
) as seed(position, days_past_due, subject, body, active)
where not exists (select 1 from public.collections_steps);

/*
 * The billing feed, with chases in it.
 *
 * A chase shows from our own record until the ingest collects the sent copy out
 * of her mailbox, at which point the real email takes its place -- they carry
 * the same Message-ID, which is why it is stamped by hand at draft time. A
 * draft she never sends stays a draft in the feed, which is the truth of it.
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

    union all

    select cs.sent_at, null, 'collections', 'outbound', 'us', null,
           coalesce(cs.sent_by, 'collections'),
           cs.subject,
           -- Enough of it to recognise, not the whole letter.
           left(regexp_replace(cs.body, E'\\s+', ' ', 'g'), 240),
           -- The mode rides in the service slot, which invoices use and this
           -- does not, so the feed can say whether it was drafted or sent.
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
      -- Gone once the real sent copy arrives, so the chase appears once.
      and not exists (
        select 1 from public.comm_messages m
        where m.source = 'gmail' and m.external_id = cs.rfc_message_id
      )
  )
  select a, b, c, d, e, f, g, h, i, j, k, l, m1, n1, o1, p1, q1, r1, s1, t1, u1, v1
  from everything
  order by coalesce((a at time zone 'America/Chicago')::date, b) desc, a desc nulls last;
$function$;

revoke all on function public.get_client_conversation(uuid) from public, anon;
grant execute on function public.get_client_conversation(uuid) to authenticated, service_role;

/* Keep the arrears clock current even when nobody opens the page. */
select cron.schedule('collections-state', '5 * * * *',
                     $$select public.refresh_collections_state();$$)
where not exists (select 1 from cron.job where jobname = 'collections-state');
