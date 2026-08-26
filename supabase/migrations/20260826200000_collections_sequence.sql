/*
 * Collections: the chase emails, when each goes out, and what was sent.
 *
 * Three tables and a queue. The queue answers one question -- who is due a
 * chase today and which one -- and everything else exists to make that answer
 * correct.
 *
 * The hard part is knowing when a ladder should start again. Keying it to the
 * oldest unpaid invoice looks right and is not: pay the oldest of three late
 * invoices and that date jumps forward, which would read as a fresh episode and
 * chase the client from the top again. So how long they have been continuously
 * overdue is recorded rather than inferred, refreshed on a schedule, and a send
 * counts as done only if it happened within the current run of arrears.
 */

insert into public.org_permissions (key, name, description, category, position)
values ('finance.collections', 'Run collections',
        'Write the chase emails, set when they go out, and send them.',
        'Clients', 2)
on conflict (key) do nothing;

/* The ladder itself. One row per email in the sequence. */
create table if not exists public.collections_steps (
  id uuid primary key default gen_random_uuid(),
  position integer not null,
  days_past_due integer not null check (days_past_due >= 0),
  subject text not null,
  body text not null,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by text
);

/*
 * How long each client has been continuously in arrears, and whether anyone
 * has asked for them to be left alone. Null overdue_since means they owe
 * nothing overdue, which is also what ends a ladder.
 */
create table if not exists public.collections_client_state (
  client_id uuid primary key references public.org_clients(id) on delete cascade,
  overdue_since date,
  paused_until date,
  paused_reason text,
  updated_at timestamptz not null default now()
);

/*
 * What was actually sent, kept whole. The template can be rewritten tomorrow;
 * this is the wording that went to the customer, which is the part anyone will
 * later need to stand behind.
 */
create table if not exists public.collections_sent (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.org_clients(id) on delete cascade,
  step_id uuid references public.collections_steps(id) on delete set null,
  step_position integer,
  days_past_due integer not null,
  past_due_total numeric,
  to_email text not null,
  subject text not null,
  body text not null,
  -- 'semi' left a draft in her mailbox; 'full' went straight out.
  mode text not null check (mode in ('semi', 'full')),
  gmail_draft_id text,
  /*
   * The Message-ID we stamp on the mail ourselves, so that when the ingest
   * later collects the sent copy from her mailbox it lands on the same key and
   * the feed shows one email rather than two.
   */
  rfc_message_id text,
  sent_at timestamptz not null default now(),
  sent_by text
);

create index if not exists collections_sent_client_idx
  on public.collections_sent (client_id, sent_at desc);

alter table public.collections_steps enable row level security;
alter table public.collections_client_state enable row level security;
alter table public.collections_sent enable row level security;

/*
 * Reading is open to anyone who can already see a client's money; writing goes
 * through the server, which checks finance.collections first. Nobody edits
 * these tables from the browser.
 */
drop policy if exists collections_steps_read on public.collections_steps;
create policy collections_steps_read on public.collections_steps
  for select to authenticated
  using (public.is_factur_user()
         and (public.has_permission('clients.health')
              or public.has_permission('finance.collections')
              or public.has_permission('org.manage')));

drop policy if exists collections_state_read on public.collections_client_state;
create policy collections_state_read on public.collections_client_state
  for select to authenticated
  using (public.is_factur_user()
         and (public.has_permission('clients.health')
              or public.has_permission('finance.collections')
              or public.has_permission('org.manage')));

drop policy if exists collections_sent_read on public.collections_sent;
create policy collections_sent_read on public.collections_sent
  for select to authenticated
  using (public.is_factur_user()
         and (public.has_permission('clients.health')
              or public.has_permission('finance.collections')
              or public.has_permission('org.manage')));

/*
 * Bring the arrears clock up to date.
 *
 * Run before reading the queue and on a schedule, so a client who quietly
 * cleared their balance stops being chased even if nobody opened the page.
 * First sight of a client already in arrears backdates them to their oldest
 * unpaid invoice rather than to today, or every ladder would restart the day
 * this ships.
 */
create or replace function public.refresh_collections_state()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  with links as (
    select client_id, qb_customer_id from public.get_client_quickbooks()
  ),
  overdue as (
    select l.client_id, min(i.duedate)::date as anchor
    from links l
    join public.qb_invoices_raw i on i.customerref_value::text = l.qb_customer_id
    where i.balance > 0 and i.duedate < current_date
    group by l.client_id
  )
  insert into public.collections_client_state (client_id, overdue_since, updated_at)
  select o.client_id, o.anchor, now()
  from overdue o
  on conflict (client_id) do update
    -- Already counting: leave the start date alone.
    set overdue_since = coalesce(public.collections_client_state.overdue_since, excluded.overdue_since),
        updated_at = now();

  -- Cleared, so the ladder ends.
  update public.collections_client_state s
     set overdue_since = null, updated_at = now()
   where s.overdue_since is not null
     and not exists (
       select 1
       from public.get_client_quickbooks() l
       join public.qb_invoices_raw i on i.customerref_value::text = l.qb_customer_id
       where l.client_id = s.client_id and i.balance > 0 and i.duedate < current_date
     );
end;
$function$;

/*
 * Who is due a chase, and which one.
 *
 * Where several steps have come due at once -- nobody ran collections for a
 * fortnight, say -- the furthest one wins rather than the earliest. A client
 * ninety days late should not receive the gentle day-seven note first.
 */
create or replace function public.get_collections_queue()
returns table (
  client_id uuid,
  client_name text,
  qb_customer text,
  to_email text,
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
  -- Where the last invoice was sent, which is where the chase should go.
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
         billed_to.to_email, customer.contact_first_name, customer.payment_terms,
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
  left join customer on customer.client_id = late.client_id
  left join history on history.client_id = late.client_id
  order by late.days_past_due desc;
$function$;

revoke all on function public.refresh_collections_state() from public, anon;
revoke all on function public.get_collections_queue() from public, anon;
grant execute on function public.refresh_collections_state() to authenticated, service_role;
grant execute on function public.get_collections_queue() to authenticated, service_role;
