/*
 * Copy the client's own people on the chase.
 *
 * The account manager and team lead are the two who will hear about it, and
 * being copied is how they find out before the client rings them rather than
 * after. Inactive people are left off -- somebody who has left the company
 * should not be on an email to a customer -- and so is whoever the mail is
 * being sent as, since copying yourself is just noise in a sent folder.
 */
alter table public.collections_sent
  add column if not exists cc_emails text;

drop function if exists public.get_collections_queue();

create function public.get_collections_queue()
returns table (
  client_id uuid,
  client_name text,
  qb_customer text,
  to_email text,
  cc_emails text,
  contact_first_name text,
  payment_terms text,
  days_past_due integer,
  overdue_since date,
  past_due_total numeric,
  open_balance numeric,
  oldest_invoice_no text,
  invoice_lines text,
  step_id uuid,
  step_position integer,
  step_days integer,
  subject text,
  body text,
  last_sent_at timestamptz,
  last_step_position integer,
  paused_until date,
  paused_reason text
)
language sql stable security definer set search_path to 'public'
as $function$
  with allowed as (
    select 1 where public.is_factur_user()
      and (public.has_permission('finance.collections') or public.has_permission('org.manage'))
  ),
  links as (
    select l.client_id, l.qb_customer_id, l.qb_customer_name
    from public.get_client_quickbooks() l
    where exists (select 1 from allowed)
  ),
  late as (
    select l.client_id, l.qb_customer_id, l.qb_customer_name,
           (current_date - min(i.duedate)::date)::integer as days_past_due,
           sum(i.balance)::numeric as past_due_total,
           (array_agg(coalesce(i.docnumber::text, i.id::text) order by i.duedate))[1] as oldest_invoice_no,
           string_agg(
             'Invoice ' || coalesce(i.docnumber::text, i.id::text)
               || ' · ' || to_char(i.balance, 'FM$999,999,990')
               || ' · due ' || to_char(i.duedate, 'DD Mon YYYY'),
             E'\n' order by i.duedate) as invoice_lines
    from links l
    join public.qb_invoices_raw i on i.customerref_value::text = l.qb_customer_id
    where i.balance > 0 and i.duedate < current_date
    group by l.client_id, l.qb_customer_id, l.qb_customer_name
  ),
  owing as (
    select l.client_id, sum(i.balance)::numeric as open_balance
    from links l
    join public.qb_invoices_raw i on i.customerref_value::text = l.qb_customer_id
    where i.balance > 0
    group by l.client_id
  ),
  billed_to as (
    select distinct on (l.client_id)
           l.client_id,
           coalesce(nullif(trim(i.billemail_address), ''),
                    (select nullif(trim(c.primaryemailaddr_address), '')
                       from public.qb_customers_raw c
                      where c.id::text = l.qb_customer_id)) as to_email
    from links l
    join public.qb_invoices_raw i on i.customerref_value::text = l.qb_customer_id
    order by l.client_id, i.txndate desc
  ),
  /*
   * The two people who own the relationship. Distinct, because on a small pod
   * the same person is often both, and nobody wants to be copied twice.
   */
  cc as (
    select c.id as client_id,
           string_agg(distinct m.email, ', ' order by m.email) as cc_emails
    from public.org_clients c
    join public.org_members m
      on m.id in (c.account_manager_id, c.team_lead_id)
    where m.active
      and nullif(trim(m.email), '') is not null
      and lower(m.email) <> lower((select send_as from public.collections_settings limit 1))
    group by c.id
  ),
  customer as (
    select l.client_id,
           nullif(trim(c.givenname), '') as contact_first_name,
           nullif(trim(c.salestermref_name), '') as payment_terms
    from links l
    join public.qb_customers_raw c on c.id::text = l.qb_customer_id
  ),
  history as (
    select cs.client_id,
           max(cs.sent_at) as last_sent_at,
           (array_agg(cs.step_position order by cs.sent_at desc))[1] as last_step_position
    from public.collections_sent cs
    group by cs.client_id
  ),
  due as (
    select late.client_id, s.id as step_id, s.position, s.days_past_due as step_days,
           s.subject, s.body,
           row_number() over (
             partition by late.client_id order by s.days_past_due desc, s.position desc
           ) as furthest
    from late
    join public.collections_client_state st on st.client_id = late.client_id
    join public.collections_steps s
      on s.active and s.days_past_due <= late.days_past_due
    where st.overdue_since is not null
      and not exists (
        select 1 from public.collections_sent cs
        where cs.client_id = late.client_id
          and cs.step_id = s.id
          and cs.sent_at::date >= st.overdue_since
      )
  )
  select late.client_id, c.name, late.qb_customer_name,
         billed_to.to_email, cc.cc_emails,
         customer.contact_first_name, customer.payment_terms,
         late.days_past_due, st.overdue_since,
         late.past_due_total, coalesce(owing.open_balance, late.past_due_total),
         late.oldest_invoice_no, late.invoice_lines,
         due.step_id, due.position, due.step_days, due.subject, due.body,
         history.last_sent_at, history.last_step_position,
         st.paused_until, st.paused_reason
  from late
  join public.org_clients c on c.id = late.client_id
  join public.collections_client_state st on st.client_id = late.client_id
  join due on due.client_id = late.client_id and due.furthest = 1
  left join owing on owing.client_id = late.client_id
  left join billed_to on billed_to.client_id = late.client_id
  left join cc on cc.client_id = late.client_id
  left join customer on customer.client_id = late.client_id
  left join history on history.client_id = late.client_id
  order by late.days_past_due desc;
$function$;

revoke all on function public.get_collections_queue() from public, anon;
grant execute on function public.get_collections_queue() to authenticated, service_role;
