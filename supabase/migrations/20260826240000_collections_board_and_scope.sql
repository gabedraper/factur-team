/*
 * Collections as a board rather than an inbox.
 *
 * It listed only who was due an email today, which meant it was empty most
 * mornings and told you nothing about the client who is ninety days late but
 * was chased on Tuesday. It now lists every client in arrears, in the order the
 * A/R Ageing Summary lists them, with what was last sent and what is next.
 *
 * Who sees what follows the reporting line, which is how this app has always
 * decided it -- a manager is somebody people report to, not somebody holding a
 * permission, so nobody has to grant it per person.
 */

/*
 * The clients somebody is named on, plus those of anyone reporting to them.
 *
 * p_as_member exists for role preview: previewing a person has to narrow the
 * page or it is not a preview. Only admins can set that cookie, and the caller
 * passes it -- this function does not read cookies.
 */
create or replace function public.my_client_ids(p_as_member uuid default null)
returns table (client_id uuid)
language sql stable security definer set search_path to 'public'
as $function$
  with me as (
    select id from public.org_members
    where active
      and (case when p_as_member is not null
                then id = p_as_member
                else auth_user_id = auth.uid() end)
  ),
  circle as (
    select id from me
    union
    select m.id from public.org_members m
    join me on m.manager_member_id = me.id
    where m.active
  )
  select c.id
  from public.org_clients c
  where c.active and coalesce(c.status, '') <> 'Inactive'
    and (c.account_manager_id in (select id from circle)
      or c.team_lead_id in (select id from circle)
      or c.sdr_id in (select id from circle)
      or c.marketing_strategist_id in (select id from circle)
      or c.data_analyst_id in (select id from circle)
      or c.data_engineer_id in (select id from circle)
      or c.data_team_lead_id in (select id from circle)
      or c.member_id in (select id from circle));
$function$;

/*
 * What the viewer is allowed to do on this page, in one round trip.
 *
 * `attached` being false with `can_see_all` false is the signal to hide the
 * page altogether: somebody on no client has no business reading the company's
 * debtors.
 */
create or replace function public.collections_visibility(p_as_member uuid default null)
returns table (can_see_all boolean, is_manager boolean, attached boolean, can_act boolean)
language sql stable security definer set search_path to 'public'
as $function$
  with me as (
    select id from public.org_members
    where active
      and (case when p_as_member is not null
                then id = p_as_member
                else auth_user_id = auth.uid() end)
  ),
  manager as (
    select exists (
      select 1 from public.org_members m join me on m.manager_member_id = me.id
      where m.active
    ) as yes
  )
  select
    public.is_factur_user()
      and (public.has_permission('org.manage')
           or public.has_permission('finance.collections')
           or (select yes from manager)),
    (select yes from manager),
    exists (select 1 from public.my_client_ids(p_as_member)),
    public.is_factur_user()
      and (public.has_permission('org.manage')
           or public.has_permission('finance.collections'));
$function$;

/*
 * Every client in arrears, alphabetically, as the ageing report lists them.
 *
 * Where a step is due the row carries it, so the board can draft without a
 * second lookup. Where none is due, the step columns are empty and the next
 * date says when one will be.
 */
create or replace function public.get_collections_board(
  p_scope text default 'mine',
  p_as_member uuid default null
)
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
  scoped as (
    select c.id as client_id
    from public.org_clients c, vis
    where exists (select 1 from allowed)
      and c.active and coalesce(c.status, '') <> 'Inactive'
      -- 'all' only means all for somebody entitled to it; for everyone else it
      -- quietly means theirs, rather than erroring at them.
      and (case when p_scope = 'all' and vis.can_see_all then true
                else c.id in (select client_id from public.my_client_ids(p_as_member)) end)
  ),
  links as (
    select l.client_id, l.qb_customer_id, l.qb_customer_name
    from public.get_client_quickbooks() l
    join scoped s on s.client_id = l.client_id
  ),
  late as (
    select l.client_id, l.qb_customer_id, l.qb_customer_name,
           min(i.duedate)::date as anchor,
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
  ageing as (
    select l.client_id,
           coalesce(a.total, 0)::numeric        as open_balance,
           coalesce(a.current, 0)::numeric      as bucket_current,
           coalesce(a._1___30, 0)::numeric      as bucket_1_30,
           coalesce(a._31___60, 0)::numeric     as bucket_31_60,
           coalesce(a._61___90, 0)::numeric     as bucket_61_90,
           coalesce(a._91_and_over, 0)::numeric as bucket_91_plus
    from links l
    join public.qb_ar_aging_raw a on a.untitled = l.qb_customer_name
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
  -- Every active step this client has not had during this run of arrears.
  outstanding as (
    select late.client_id, s.id as step_id, s.position, s.days_past_due as step_days,
           s.subject, s.body,
           (late.anchor + s.days_past_due)::date as falls_on
    from late
    join public.collections_client_state st on st.client_id = late.client_id
    join public.collections_steps s on s.active
    where st.overdue_since is not null
      and not exists (
        select 1 from public.collections_sent cs
        where cs.client_id = late.client_id
          and cs.step_id = s.id
          and cs.sent_at::date >= st.overdue_since
      )
  ),
  -- Due now: the furthest one reached, as the queue has always chosen.
  due as (
    select o.*, row_number() over (
             partition by o.client_id order by o.step_days desc, o.position desc) as furthest
    from outstanding o
    where o.step_days <= (select days_past_due from late where late.client_id = o.client_id)
  ),
  -- Next up: the soonest one not yet reached.
  upcoming as (
    select o.*, row_number() over (
             partition by o.client_id order by o.step_days asc, o.position asc) as soonest
    from outstanding o
    where o.step_days > (select days_past_due from late where late.client_id = o.client_id)
  )
  select late.client_id, c.name, late.qb_customer_name,
         billed_to.to_email, cc.cc_emails,
         customer.contact_first_name, customer.payment_terms,
         late.days_past_due, st.overdue_since,
         late.past_due_total,
         coalesce(ageing.open_balance, late.past_due_total),
         coalesce(ageing.bucket_current, 0), coalesce(ageing.bucket_1_30, 0),
         coalesce(ageing.bucket_31_60, 0), coalesce(ageing.bucket_61_90, 0),
         coalesce(ageing.bucket_91_plus, 0),
         late.oldest_invoice_no, late.invoice_lines,
         due.step_id, due.position, due.step_days, due.subject, due.body,
         history.last_sent_at, history.last_step_position,
         upcoming.position, upcoming.step_days, upcoming.falls_on,
         st.paused_until, st.paused_reason
  from late
  join public.org_clients c on c.id = late.client_id
  join public.collections_client_state st on st.client_id = late.client_id
  left join ageing on ageing.client_id = late.client_id
  left join billed_to on billed_to.client_id = late.client_id
  left join cc on cc.client_id = late.client_id
  left join customer on customer.client_id = late.client_id
  left join history on history.client_id = late.client_id
  left join due on due.client_id = late.client_id and due.furthest = 1
  left join upcoming on upcoming.client_id = late.client_id and upcoming.soonest = 1
  -- Alphabetical, as the ageing report is.
  order by c.name;
$function$;

revoke all on function public.my_client_ids(uuid) from public, anon;
revoke all on function public.collections_visibility(uuid) from public, anon;
revoke all on function public.get_collections_board(text, uuid) from public, anon;
grant execute on function public.my_client_ids(uuid) to authenticated, service_role;
grant execute on function public.collections_visibility(uuid) to authenticated, service_role;
grant execute on function public.get_collections_board(text, uuid) to authenticated, service_role;
