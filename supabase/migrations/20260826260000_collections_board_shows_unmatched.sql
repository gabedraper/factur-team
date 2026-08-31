/*
 * Everything with an open balance, matched to a client or not.
 *
 * Eleven QuickBooks customers owing $68,205 between them have no client record
 * in the app at all -- never linked, never rejected, simply names the app has
 * never seen. They were invisible everywhere except the linking screen, which
 * is a strange place for sixty-eight thousand dollars to hide.
 *
 * They now appear on the board as their own rows, saying what they are. They
 * carry no client, so there is nothing to chase them with and no sequence to
 * put them in: the row exists to be noticed and linked, and the buttons stay
 * off until it is.
 *
 * Unmatched debt belongs to nobody in particular, so only people who see
 * everything see it -- putting it in front of one account manager would be
 * arbitrary, and in front of all of them would be worse.
 */
drop function if exists public.get_collections_board(text, uuid);

create function public.get_collections_board(
  p_scope text default 'mine',
  p_as_member uuid default null
)
returns table (
  client_id uuid,
  client_name text,
  client_active boolean,
  matched boolean,
  qb_customer_id text,
  qb_customer text,
  to_email text,
  cc_emails text,
  contact_first_name text,
  payment_terms text,
  days_past_due integer,
  overdue_since date,
  past_due_total numeric,
  open_balance numeric,
  bucket_current numeric,
  bucket_1_30 numeric,
  bucket_31_60 numeric,
  bucket_61_90 numeric,
  bucket_91_plus numeric,
  oldest_invoice_no text,
  invoice_lines text,
  step_id uuid,
  step_position integer,
  step_days integer,
  subject text,
  body text,
  last_sent_at timestamptz,
  last_step_position integer,
  next_step_position integer,
  next_step_days integer,
  next_step_on date,
  paused_until date,
  paused_reason text
)
language sql stable security definer set search_path to 'public'
as $function$
  with vis as (select * from public.collections_visibility(p_as_member)),
  allowed as (
    select 1 from vis where can_see_all or attached
  ),
  mine as (
    select client_id from public.my_client_ids(p_as_member)
  ),
  -- Former clients included: a debt outlives the contract.
  matched as (
    select client_id, qb_customer_id from public.get_client_quickbooks(true)
  ),
  /*
   * Starts from QuickBooks rather than from the client list, which is the whole
   * change: a customer with no client behind them still owes the money.
   */
  owing as (
    select i.customerref_value::text as qb_id,
           i.customerref_name as qb_name,
           min(i.duedate)::date as anchor,
           (current_date - min(i.duedate)::date)::integer as days_past_due,
           sum(i.balance)::numeric as past_due_total,
           (array_agg(coalesce(i.docnumber::text, i.id::text) order by i.duedate))[1] as oldest_invoice_no,
           string_agg(
             'Invoice ' || coalesce(i.docnumber::text, i.id::text)
               || ' · ' || to_char(i.balance, 'FM$999,999,990')
               || ' · due ' || to_char(i.duedate, 'DD Mon YYYY'),
             E'\n' order by i.duedate) as invoice_lines
    from public.qb_invoices_raw i
    where i.balance > 0 and i.duedate < current_date
      and i.customerref_value is not null
    group by i.customerref_value, i.customerref_name
  ),
  candidates as (
    select o.*, m.client_id
    from owing o
    left join matched m on m.qb_customer_id = o.qb_id
  ),
  visible as (
    select c.*
    from candidates c, vis
    where exists (select 1 from allowed)
      and (
        -- Somebody's client, and this viewer's to see.
        (c.client_id is not null
         and (case when p_scope = 'all' and vis.can_see_all then true
                   else c.client_id in (select client_id from mine) end))
        -- Or nobody's, which only the whole-company view carries.
        or (c.client_id is null and vis.can_see_all and p_scope = 'all')
      )
  ),
  ageing as (
    select v.qb_id,
           coalesce(a.total, 0)::numeric        as open_balance,
           coalesce(a.current, 0)::numeric      as bucket_current,
           coalesce(a._1___30, 0)::numeric      as bucket_1_30,
           coalesce(a._31___60, 0)::numeric     as bucket_31_60,
           coalesce(a._61___90, 0)::numeric     as bucket_61_90,
           coalesce(a._91_and_over, 0)::numeric as bucket_91_plus
    from visible v
    join public.qb_ar_aging_raw a on a.untitled = v.qb_name
  ),
  billed_to as (
    select distinct on (v.qb_id) v.qb_id,
           coalesce(nullif(trim(i.billemail_address), ''),
                    (select nullif(trim(c.primaryemailaddr_address), '')
                       from public.qb_customers_raw c
                      where c.id::text = v.qb_id)) as to_email
    from visible v
    join public.qb_invoices_raw i on i.customerref_value::text = v.qb_id
    order by v.qb_id, i.txndate desc
  ),
  customer as (
    select v.qb_id,
           nullif(trim(c.givenname), '') as contact_first_name,
           nullif(trim(c.salestermref_name), '') as payment_terms
    from visible v
    join public.qb_customers_raw c on c.id::text = v.qb_id
  ),
  cc as (
    select c.id as client_id,
           string_agg(distinct m.email, ', ' order by m.email) as cc_emails
    from public.org_clients c
    join public.org_members m on m.id in (c.account_manager_id, c.team_lead_id)
    where m.active
      and nullif(trim(m.email), '') is not null
      and lower(m.email) <> lower((select send_as from public.collections_settings limit 1))
    group by c.id
  ),
  history as (
    select cs.client_id,
           max(cs.sent_at) as last_sent_at,
           (array_agg(cs.step_position order by cs.sent_at desc))[1] as last_step_position
    from public.collections_sent cs
    group by cs.client_id
  ),
  -- Only a matched client has a ladder to be on.
  outstanding as (
    select v.client_id, v.qb_id, s.id as step_id, s.position, s.days_past_due as step_days,
           s.subject, s.body, v.days_past_due as client_days,
           (v.anchor + s.days_past_due)::date as falls_on
    from visible v
    join public.collections_client_state st on st.client_id = v.client_id
    join public.collections_steps s on s.active
    where v.client_id is not null
      and st.overdue_since is not null
      and not exists (
        select 1 from public.collections_sent cs
        where cs.client_id = v.client_id
          and cs.step_id = s.id
          and cs.sent_at::date >= st.overdue_since
      )
  ),
  due as (
    select o.*, row_number() over (
             partition by o.qb_id order by o.step_days desc, o.position desc) as furthest
    from outstanding o
    where o.step_days <= o.client_days
  ),
  upcoming as (
    select o.*, row_number() over (
             partition by o.qb_id order by o.step_days asc, o.position asc) as soonest
    from outstanding o
    where o.step_days > o.client_days
  )
  select v.client_id,
         coalesce(c.name, v.qb_name) as client_name,
         case when c.id is null then null
              else (c.active and coalesce(c.status, '') <> 'Inactive') end as client_active,
         (v.client_id is not null) as matched,
         v.qb_id, v.qb_name,
         billed_to.to_email, cc.cc_emails,
         customer.contact_first_name, customer.payment_terms,
         v.days_past_due, st.overdue_since,
         v.past_due_total,
         coalesce(ageing.open_balance, v.past_due_total),
         coalesce(ageing.bucket_current, 0), coalesce(ageing.bucket_1_30, 0),
         coalesce(ageing.bucket_31_60, 0), coalesce(ageing.bucket_61_90, 0),
         coalesce(ageing.bucket_91_plus, 0),
         v.oldest_invoice_no, v.invoice_lines,
         due.step_id, due.position, due.step_days, due.subject, due.body,
         history.last_sent_at, history.last_step_position,
         upcoming.position, upcoming.step_days, upcoming.falls_on,
         st.paused_until, st.paused_reason
  from visible v
  left join public.org_clients c on c.id = v.client_id
  left join public.collections_client_state st on st.client_id = v.client_id
  left join ageing on ageing.qb_id = v.qb_id
  left join billed_to on billed_to.qb_id = v.qb_id
  left join customer on customer.qb_id = v.qb_id
  left join cc on cc.client_id = v.client_id
  left join history on history.client_id = v.client_id
  left join due on due.qb_id = v.qb_id and due.furthest = 1
  left join upcoming on upcoming.qb_id = v.qb_id and upcoming.soonest = 1
  -- Alphabetical, as the ageing report is, whichever name we have for them.
  order by coalesce(c.name, v.qb_name);
$function$;

revoke all on function public.get_collections_board(text, uuid) from public, anon;
grant execute on function public.get_collections_board(text, uuid) to authenticated, service_role;
