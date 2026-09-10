/*
 * The A/R ladder, keyed to the invoice.
 *
 * The collections sequence we had counts days past due for a *client* and
 * starts on the due date. Breno's process counts days either side of *an
 * invoice's* due date and opens a week before it falls due, so a client with
 * three invoices at three ages runs three ladders at once rather than one
 * chase about their oldest. None of that is expressible in the old shape, so
 * this is a second set of tables rather than a widened first.
 *
 * The old collections_* tables stay where they are. The board still reads
 * them, and nothing is migrated until the new ladder has been watched for a
 * while against real invoices.
 */

-- ---------------------------------------------------------------------------
-- How fresh is the QuickBooks snapshot?
-- ---------------------------------------------------------------------------

/*
 * Coupler drops and recreates its tables on every sync, so the relation's oid
 * changes each time it lands. That is the only honest "we heard from
 * QuickBooks" signal available to us -- row contents cannot distinguish a
 * quiet day from a broken pipeline, and a pipeline that stopped on Friday is
 * exactly the case that must not send a chase to somebody who has paid.
 */
create table if not exists public.staging_sync_watermark (
  table_name  text primary key,
  last_oid    oid         not null,
  changed_at  timestamptz not null default now(),
  checked_at  timestamptz not null default now()
);

alter table public.staging_sync_watermark enable row level security;

drop policy if exists staging_sync_watermark_read on public.staging_sync_watermark;
create policy staging_sync_watermark_read on public.staging_sync_watermark
  for select to authenticated
  using (public.is_factur_user());

create or replace function public.note_staging_sync()
returns void
language sql security definer set search_path to 'public'
as $function$
  insert into public.staging_sync_watermark as w (table_name, last_oid)
  select c.relname, c.oid
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('qb_invoices_raw', 'qb_payments_raw', 'qb_customers_raw')
  on conflict (table_name) do update
    set checked_at = now(),
        changed_at = case
          when w.last_oid <> excluded.last_oid then now()
          else w.changed_at
        end,
        last_oid = excluded.last_oid;
$function$;

/** Minutes since QuickBooks invoices last landed. Null when never seen. */
create or replace function public.qb_data_age_minutes()
returns integer
language sql stable security definer set search_path to 'public'
as $function$
  select (extract(epoch from (now() - changed_at)) / 60)::integer
    from public.staging_sync_watermark
   where table_name = 'qb_invoices_raw';
$function$;

-- ---------------------------------------------------------------------------
-- The steps
-- ---------------------------------------------------------------------------

create table if not exists public.ar_steps (
  id           uuid primary key default gen_random_uuid(),
  position     integer not null,
  code         text    not null unique,
  name         text    not null,
  /* Days either side of the due date: -7 is a week before, +31 is the pause. */
  offset_days  integer not null,
  subject      text    not null,
  body         text    not null,
  /* Which of the client's own people are copied: 'am', 'tl'. */
  cc_roles     text[]  not null default '{}',
  /* Breno suppresses the pre-due nudge for anybody already on autopay. */
  skip_when_autopay boolean not null default false,
  /* Several rungs also raise an internal task. Null where there is none. */
  internal_to      text[],
  internal_subject text,
  internal_body    text,
  active       boolean not null default true,
  updated_at   timestamptz not null default now(),
  updated_by   text
);

create unique index if not exists ar_steps_position_idx on public.ar_steps (position);

-- ---------------------------------------------------------------------------
-- What has gone out
-- ---------------------------------------------------------------------------

create table if not exists public.ar_sent (
  id              uuid primary key default gen_random_uuid(),
  qb_invoice_id   bigint not null,
  client_id       uuid references public.org_clients (id) on delete set null,
  step_id         uuid not null references public.ar_steps (id) on delete cascade,
  step_position   integer not null,
  /* 'client' is the chase itself; 'internal' is the task email beside it. */
  kind            text not null default 'client' check (kind in ('client', 'internal')),
  offset_days     integer,
  invoice_no      text,
  invoice_balance numeric,
  account_total   numeric,
  to_email        text,
  cc_emails       text,
  subject         text,
  body            text,
  mode            text,
  gmail_draft_id  text,
  rfc_message_id  text,
  sent_at         timestamptz not null default now(),
  sent_by         text
);

/*
 * One send per step per invoice, for good. An invoice is a one-off object --
 * unlike a client, it cannot fall behind a second time -- so this is the whole
 * of the idempotency rule and there is no need for the epoch the client-level
 * table had to carry.
 */
create unique index if not exists ar_sent_once
  on public.ar_sent (qb_invoice_id, step_id, kind);

create index if not exists ar_sent_invoice_idx on public.ar_sent (qb_invoice_id, sent_at desc);
create index if not exists ar_sent_client_idx  on public.ar_sent (client_id, sent_at desc);

-- ---------------------------------------------------------------------------
-- Holds and per-client settings
-- ---------------------------------------------------------------------------

/** Stop one invoice without stopping the client. A query, a disputed line. */
create table if not exists public.ar_invoice_hold (
  qb_invoice_id bigint primary key,
  held_until    date,
  reason        text,
  set_by        text,
  set_at        timestamptz not null default now()
);

/*
 * Autopay cannot be read out of QuickBooks -- allowonlineachpayment says ACH
 * is permitted, not that a recurring charge is armed -- so finance says so
 * here. The interest rate lives here too because the templates quote it and a
 * rate typed into nine separate emails is a rate that will disagree with
 * itself.
 */
create table if not exists public.ar_client_settings (
  client_id     uuid primary key references public.org_clients (id) on delete cascade,
  autopay       boolean not null default false,
  interest_rate text,
  updated_at    timestamptz not null default now(),
  updated_by    text
);

alter table public.ar_steps           enable row level security;
alter table public.ar_sent            enable row level security;
alter table public.ar_invoice_hold    enable row level security;
alter table public.ar_client_settings enable row level security;

/* Reading follows the money permissions; every write goes through the server. */
drop policy if exists ar_steps_read on public.ar_steps;
create policy ar_steps_read on public.ar_steps
  for select to authenticated
  using (public.is_factur_user()
         and (public.has_permission('clients.health')
              or public.has_permission('finance.collections')
              or public.has_permission('org.manage')));

drop policy if exists ar_sent_read on public.ar_sent;
create policy ar_sent_read on public.ar_sent
  for select to authenticated
  using (public.is_factur_user()
         and (public.has_permission('clients.health')
              or public.has_permission('finance.collections')
              or public.has_permission('org.manage')));

drop policy if exists ar_invoice_hold_read on public.ar_invoice_hold;
create policy ar_invoice_hold_read on public.ar_invoice_hold
  for select to authenticated
  using (public.is_factur_user()
         and (public.has_permission('clients.health')
              or public.has_permission('finance.collections')
              or public.has_permission('org.manage')));

drop policy if exists ar_client_settings_read on public.ar_client_settings;
create policy ar_client_settings_read on public.ar_client_settings
  for select to authenticated
  using (public.is_factur_user()
         and (public.has_permission('clients.health')
              or public.has_permission('finance.collections')
              or public.has_permission('org.manage')));

-- ---------------------------------------------------------------------------
-- Who gets copied
-- ---------------------------------------------------------------------------

/*
 * The client's own people, by role, for one rung of the ladder.
 *
 * Breno widens the copy list as an invoice ages -- finance alone at first, the
 * account manager at a week, the team lead at a fortnight -- so which roles to
 * copy is a property of the step, not of the client. Somebody who has left is
 * left off, and so is whoever the mail is sent as: copying yourself is noise.
 */
create or replace function public.ar_cc_for(p_client_id uuid, p_roles text[])
returns text
language sql stable security definer set search_path to 'public'
as $function$
  select string_agg(distinct m.email, ', ' order by m.email)
    from public.org_clients c
    join public.org_members m
      on (('am' = any(p_roles) and m.id = c.account_manager_id)
       or ('tl' = any(p_roles) and m.id = c.team_lead_id))
   where c.id = p_client_id
     and m.active
     and nullif(trim(m.email), '') is not null
     and lower(m.email) <> lower(coalesce(
           (select send_as from public.collections_settings limit 1), ''));
$function$;

-- ---------------------------------------------------------------------------
-- The queue
-- ---------------------------------------------------------------------------

/*
 * Every open invoice, the rung it is standing on, and -- where it cannot be
 * chased -- the reason.
 *
 * The reason is returned rather than the row being dropped. An invoice nobody
 * can chase because QuickBooks holds no billing address is precisely the thing
 * Breno needs to see; silently filtering it out is how a client goes ninety
 * days without hearing from us and nobody notices.
 */
create or replace function public.get_ar_queue(p_grace_days integer default 3)
returns table (
  qb_invoice_id     bigint,
  invoice_no        text,
  client_id         uuid,
  client_name       text,
  qb_customer_id    text,
  qb_customer_name  text,
  due_date          date,
  age_days          integer,
  invoice_balance   numeric,
  account_total     numeric,
  autopay           boolean,
  interest_rate     text,
  to_email          text,
  cc_emails         text,
  contact_first_name text,
  payment_terms     text,
  pay_link          text,
  step_id           uuid,
  step_position     integer,
  step_code         text,
  step_name         text,
  step_offset       integer,
  subject           text,
  body              text,
  internal_to       text[],
  internal_subject  text,
  internal_body     text,
  last_sent_at      timestamptz,
  last_step_position integer,
  blocked           text
)
language sql stable security definer set search_path to 'public'
as $function$
  with allowed as (
    select 1 where public.is_factur_user()
      and (public.has_permission('finance.collections') or public.has_permission('org.manage'))
  ),
  links as (
    select l.client_id, l.qb_customer_id, l.qb_customer_name
      from public.get_client_quickbooks(true) l
     where exists (select 1 from allowed)
  ),
  stale as (
    select public.qb_data_age_minutes() as age_minutes
  ),
  -- Every open invoice belonging to a customer we have matched to a client.
  inv as (
    select i.id                                        as qb_invoice_id,
           coalesce(nullif(trim(i.docnumber::text), ''), i.id::text) as invoice_no,
           l.client_id, l.qb_customer_id, l.qb_customer_name,
           i.duedate::date                             as due_date,
           (current_date - i.duedate::date)::integer   as age_days,
           i.balance::numeric                          as invoice_balance,
           nullif(trim(i.invoicelink), '')             as pay_link,
           nullif(trim(i.billemail_address), '')       as bill_email
      from links l
      join public.qb_invoices_raw i
        on i.customerref_value::text = l.qb_customer_id
     where i.balance > 0
       and i.duedate is not null
  ),
  account as (
    select client_id, sum(invoice_balance)::numeric as account_total
      from inv group by client_id
  ),
  customer as (
    select l.client_id,
           nullif(trim(c.givenname), '')          as contact_first_name,
           nullif(trim(c.salestermref_name), '')  as payment_terms,
           nullif(trim(c.primaryemailaddr_address), '') as customer_email
      from links l
      join public.qb_customers_raw c on c.id::text = l.qb_customer_id
  ),
  /*
   * Anybody who has paid us in the last few days may have money in flight that
   * QuickBooks has not allocated yet. Their invoice still shows a balance, and
   * chasing it is the mistake Breno asked us hardest to avoid.
   */
  recent_payment as (
    select distinct l.client_id
      from links l
      join public.qb_payments_raw p on p.customerref_value::text = l.qb_customer_id
     where p.txndate >= current_date - greatest(p_grace_days, 0)
  ),
  history as (
    select s.qb_invoice_id,
           max(s.sent_at) as last_sent_at,
           (array_agg(s.step_position order by s.sent_at desc))[1] as last_step_position
      from public.ar_sent s
     where s.kind = 'client'
     group by s.qb_invoice_id
  ),
  -- The furthest rung this invoice has reached that has not gone out yet.
  due as (
    select inv.qb_invoice_id, st.id as step_id, st.position, st.code, st.name,
           st.offset_days, st.subject, st.body,
           st.internal_to, st.internal_subject, st.internal_body,
           st.skip_when_autopay, st.cc_roles,
           row_number() over (
             partition by inv.qb_invoice_id
             order by st.offset_days desc, st.position desc
           ) as furthest
      from inv
      join public.ar_steps st
        on st.active and st.offset_days <= inv.age_days
     where not exists (
       select 1 from public.ar_sent s
        where s.qb_invoice_id = inv.qb_invoice_id
          and s.step_id = st.id
          and s.kind = 'client'
     )
  )
  select inv.qb_invoice_id,
         inv.invoice_no,
         inv.client_id,
         c.name,
         inv.qb_customer_id,
         inv.qb_customer_name,
         inv.due_date,
         inv.age_days,
         inv.invoice_balance,
         account.account_total,
         coalesce(cs.autopay, false),
         cs.interest_rate,
         coalesce(inv.bill_email, customer.customer_email),
         public.ar_cc_for(inv.client_id, due.cc_roles),
         customer.contact_first_name,
         customer.payment_terms,
         inv.pay_link,
         due.step_id, due.position, due.code, due.name, due.offset_days,
         due.subject, due.body,
         due.internal_to, due.internal_subject, due.internal_body,
         history.last_sent_at, history.last_step_position,
         case
           when coalesce(inv.bill_email, customer.customer_email) is null
             then 'No billing email in QuickBooks'
           when (select age_minutes from stale) is null
             then 'QuickBooks sync has never been seen'
           when (select age_minutes from stale) > 360
             then 'QuickBooks data is ' || ((select age_minutes from stale) / 60) || ' hours old'
           when hold.qb_invoice_id is not null
                and (hold.held_until is null or hold.held_until >= current_date)
             then coalesce('On hold: ' || hold.reason, 'On hold')
           when state.paused_until is not null and state.paused_until >= current_date
             then coalesce('Client paused: ' || state.paused_reason, 'Client paused')
           when rp.client_id is not null
             then 'Payment received in the last ' || p_grace_days || ' days -- may not be allocated yet'
           when due.skip_when_autopay and coalesce(cs.autopay, false)
             then 'On autopay'
           else null
         end
    from inv
    join public.org_clients c on c.id = inv.client_id
    join due on due.qb_invoice_id = inv.qb_invoice_id and due.furthest = 1
    left join account        on account.client_id = inv.client_id
    left join customer       on customer.client_id = inv.client_id
    left join history        on history.qb_invoice_id = inv.qb_invoice_id
    left join public.ar_invoice_hold hold on hold.qb_invoice_id = inv.qb_invoice_id
    left join public.ar_client_settings cs on cs.client_id = inv.client_id
    left join public.collections_client_state state on state.client_id = inv.client_id
    left join recent_payment rp on rp.client_id = inv.client_id
   order by inv.age_days desc, inv.invoice_balance desc;
$function$;

revoke all on function public.ar_cc_for(uuid, text[]) from public, anon;
grant execute on function public.ar_cc_for(uuid, text[]) to authenticated, service_role;

revoke all on function public.note_staging_sync() from public, anon;
revoke all on function public.qb_data_age_minutes() from public, anon;
revoke all on function public.get_ar_queue(integer) from public, anon;
grant execute on function public.note_staging_sync() to authenticated, service_role;
grant execute on function public.qb_data_age_minutes() to authenticated, service_role;
grant execute on function public.get_ar_queue(integer) to authenticated, service_role;

select public.note_staging_sync();
