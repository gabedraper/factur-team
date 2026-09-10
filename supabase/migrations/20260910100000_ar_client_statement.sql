/*
 * What a client owes, line by line, for the statement attached to the later
 * rungs of the ladder.
 *
 * QuickBooks has statements but does not expose them -- they are drawn in its
 * own screens and there is no statement entity on the API -- so we draw our
 * own from the invoices we already hold. That is the better end of the trade
 * anyway: it is current at the moment of sending rather than whenever somebody
 * last exported one.
 *
 * Open invoices only. A statement here answers "what do I owe", not "what has
 * moved on my account", so unallocated credits are deliberately absent and the
 * covering email should not imply otherwise.
 */
create or replace function public.get_client_statement(p_client_id uuid)
returns table (
  invoice_no text,
  txn_date   date,
  due_date   date,
  original   numeric,
  balance    numeric,
  age_days   integer
)
language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(nullif(trim(i.docnumber::text), ''), i.id::text) as invoice_no,
         i.txndate::date,
         i.duedate::date,
         i.totalamt::numeric,
         i.balance::numeric,
         (current_date - i.duedate::date)::integer
    from public.get_client_quickbooks(true) l
    join public.qb_invoices_raw i
      on i.customerref_value::text = l.qb_customer_id
   where l.client_id = p_client_id
     and i.balance > 0
     and public.is_factur_user()
     and (public.has_permission('clients.health')
          or public.has_permission('finance.collections')
          or public.has_permission('org.manage'))
   order by i.duedate, invoice_no;
$function$;

revoke all on function public.get_client_statement(uuid) from public, anon;
grant execute on function public.get_client_statement(uuid) to authenticated, service_role;

/* Which documents a rung promises. Read at send time, not inferred from prose. */
alter table public.ar_steps
  add column if not exists attachments text[] not null default '{}';

update public.ar_steps set attachments = '{statement}'
 where code in ('final_25', 'pause_31', 'arrangement_32');

update public.ar_steps set attachments = '{invoice}'
 where code = 'invoice_raised';
