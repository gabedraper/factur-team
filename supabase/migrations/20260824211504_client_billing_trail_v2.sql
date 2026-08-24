/*
 * Which QuickBooks customer is which client.
 *
 * Built from the invoice history rather than the ageing report: the ageing
 * report only lists customers who currently owe something -- 60 of them,
 * against 166 clients with any billing history at all. Matched on a normalised
 * name, and only where unambiguous in both directions, for the reason that
 * holds everywhere here: attaching one company's money to another is worse
 * than giving no answer.
 *
 * Everything is cast explicitly. Coupler infers column types from whatever it
 * happened to load, so a customer reference is a bigint today and could be text
 * after a sync that sees one with a letter in it.
 */
create or replace function public.get_client_quickbooks()
returns table (client_id uuid, client_name text, qb_customer_id text, qb_customer_name text)
language sql stable security definer set search_path to 'public'
as $$
  with qb as (
    select distinct customerref_value::text as qb_id, customerref_name as qb_name,
           public.norm_company(customerref_name) as key
    from public.qb_invoices_raw where customerref_value is not null
  ),
  cl as (
    select id, name, public.norm_company(name) as key
    from public.org_clients
    where active and coalesce(status, '') <> 'Inactive'
  ),
  counts as (
    select k.key,
           (select count(*) from cl where cl.key = k.key) as clients_here,
           (select count(*) from qb where qb.key = k.key) as customers_here
    from (select distinct key from qb union select distinct key from cl) k
  )
  select cl.id, cl.name, qb.qb_id, qb.qb_name
  from cl
  join counts c on c.key = cl.key
  join qb on qb.key = cl.key
  where c.clients_here = 1 and c.customers_here = 1;
$$;

/*
 * Everything that happened about one client's money, newest first.
 *
 * Invoices raised and payments received from QuickBooks, woven together with
 * the billing conversation from Salesforce. Interleaved is the point: an
 * invoice going out, a chase a fortnight later, the client's reply, the
 * payment. Any one of those alone says very little.
 *
 * The conversation is picked out by keywords in the subject, because nothing
 * marks an email as being about billing. That will miss a chase which never
 * uses any of these words -- the alternative is showing every email the client
 * ever sent, which is not a billing trail.
 */
create or replace function public.get_client_billing_trail(p_client_id uuid)
returns table (
  at date, kind text, title text, detail text,
  amount numeric, outstanding numeric, url text
)
language sql stable security definer set search_path to 'public'
as $$
  with qb as (
    select qb_customer_id from public.get_client_quickbooks()
    where client_id = p_client_id and public.is_factur_user()
  ),
  acct as (
    select sf.client_account__c as account_id
    from public.org_clients c
    join public.sf_clients_raw sf on sf.id = c.salesforce_client_id
    where c.id = p_client_id and public.is_factur_user()
  ),
  invoices as (
    select i.txndate as at,
           'invoice'::text as kind,
           ('Invoice ' || coalesce(i.docnumber::text, i.id::text))::text as title,
           (case when i.emailstatus = 'EmailSent'
                 then 'emailed to ' || coalesce(i.billemail_address, 'the client')
                 else 'not emailed' end
            || case when i.duedate is not null
                    then ' · due ' || to_char(i.duedate, 'DD Mon YYYY') else '' end)::text as detail,
           i.totalamt::numeric as amount,
           i.balance::numeric as outstanding,
           i.invoicelink::text as url
    from public.qb_invoices_raw i
    join qb on qb.qb_customer_id = i.customerref_value::text
  ),
  payments as (
    select p.txndate, 'payment'::text,
           'Payment received'::text,
           (case when p.paymentrefnum is not null
                 then 'reference ' || p.paymentrefnum::text
                 else 'received' end)::text,
           p.totalamt::numeric, null::numeric, null::text
    from public.qb_payments_raw p
    join qb on qb.qb_customer_id = p.customerref_value::text
  ),
  conversation as (
    select ra.activity_date,
           (case when ra.email_category = 'Received' then 'email_in'
                 when ra.activity_type = 'Call' then 'call'
                 else 'email_out' end)::text,
           coalesce(ra.subject, '(no subject)')::text,
           coalesce(ra.activity_type, 'activity')::text,
           null::numeric, null::numeric,
           ('https://factur.lightning.force.com/lightning/r/Task/' || ra.id || '/view')::text
    from public.raw_activities ra
    join acct on acct.account_id = ra.account_id
    where ra.is_dedup_primary
      and ra.subject ~* 'invoice|payment|past due|remittance|receivable|billing|overdue|statement|collections'
  )
  select * from invoices
  union all select * from payments
  union all select * from conversation
  order by at desc;
$$;

revoke all on function public.get_client_quickbooks() from public, anon;
revoke all on function public.get_client_billing_trail(uuid) from public, anon;
grant execute on function public.get_client_quickbooks() to authenticated, service_role;
grant execute on function public.get_client_billing_trail(uuid) to authenticated, service_role;
