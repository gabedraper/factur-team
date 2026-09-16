/*
 * Keeping client_contacts up to date.
 *
 * The table was filled once by a backfill on 2026-08-26 and nothing has written
 * to it since: the newest row was 2026-09-02, so every client onboarded after
 * that had no contact at all and would have been skipped silently by anything
 * that emails clients. This is that backfill turned into a function, plus a
 * nightly job to run it.
 *
 * The three rules are the ones the original backfill used:
 *   primary        <- sf_clients_raw.client_main_contact_email__c
 *   decision_maker <- sf_clients_raw.client_decision_maker_contact_email__c
 *   billing        <- the billing address on the client's most recent
 *                     QuickBooks invoice, falling back to the customer record,
 *                     split on commas because some clients hold two
 *
 * What it will not do, which matters more than what it does:
 *
 * - It never clears opted_out_at or bounced_at. Somebody who asked not to be
 *   emailed must not be un-asked by a sync job, so a returning address stays
 *   marked. That is why this upserts a narrow set of columns instead of the row.
 * - It never deletes or deactivates. An address that disappears from Salesforce
 *   keeps its row, and simply stops being the newest one for that client and
 *   role, which is how client_contact_current already decides between several.
 * - It never outranks a person. client_contact_current prefers source='manual'
 *   above everything, so a hand-entered correction still wins the morning after
 *   a sync puts the old address back.
 *
 * Bumping updated_at on a row the source still lists is the point, not
 * bookkeeping: the resolver view orders by updated_at to pick the current
 * address, so "still there this morning" has to be recorded to beat an address
 * that has gone quiet.
 *
 * Names are not touched. Neither source carries one -- the original backfill
 * took them from a table that has since been retired -- so a new row arrives
 * with an address and no name, and {{contact}} falls back to "there" until
 * somebody fills it in.
 *
 * Only clients we might actually write to, which means status <> 'Inactive'.
 * Run against everybody it wanted to add 708 billing addresses, 694 of them for
 * clients that left years ago -- every invoice QuickBooks still holds for a dead
 * account, in a table meant to answer "who do we email here". The ones already
 * there from the first backfill stay; this simply stops adding more. Widening it
 * later is one predicate, if win-back campaigns ever need them.
 */
create or replace function public.refresh_client_contacts()
returns table (added integer, refreshed integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_before integer;
  v_touched integer;
begin
  select count(*) into v_before from public.client_contacts;

  with from_salesforce as (
    select c.id as client_id, 'primary'::text as role,
           lower(trim(r.client_main_contact_email__c)) as email
    from public.org_clients c
    join public.sf_clients_raw r on r.id = c.salesforce_client_id
    where trim(coalesce(r.client_main_contact_email__c, '')) <> ''
      and coalesce(c.status, '') <> 'Inactive'
    union all
    select c.id, 'decision_maker',
           lower(trim(r.client_decision_maker_contact_email__c))
    from public.org_clients c
    join public.sf_clients_raw r on r.id = c.salesforce_client_id
    where trim(coalesce(r.client_decision_maker_contact_email__c, '')) <> ''
      and coalesce(c.status, '') <> 'Inactive'
  ),
  /* The newest invoice per client is the one whose billing address is current. */
  newest_invoice as (
    select distinct on (l.client_id)
           l.client_id, l.qb_customer_id, i.billemail_address
    from public.get_client_quickbooks(true) l
    join public.qb_invoices_raw i on i.customerref_value::text = l.qb_customer_id
    join public.org_clients c on c.id = l.client_id
    where coalesce(c.status, '') <> 'Inactive'
    order by l.client_id, i.txndate desc
  ),
  from_quickbooks as (
    select n.client_id, 'billing'::text as role,
           lower(trim(part)) as email
    from newest_invoice n
    cross join lateral unnest(
      string_to_array(
        coalesce(
          nullif(trim(n.billemail_address), ''),
          (select nullif(trim(q.primaryemailaddr_address), '')
             from public.qb_customers_raw q
            where q.id::text = n.qb_customer_id)
        ),
        ','
      )
    ) as part
    where trim(coalesce(part, '')) <> ''
  ),
  wanted as (
    select client_id, role, email from from_salesforce
    union all
    select client_id, role, email from from_quickbooks
  ),
  /* One address can appear twice in a source; the index would reject the
     second, so they are folded here rather than at insert time. */
  distinct_wanted as (
    select distinct client_id, role, email
    from wanted
    where email ~ '^[^@[:space:],;]+@[^@[:space:],;]+\.[^@[:space:],;]+$'
  ),
  written as (
    insert into public.client_contacts
      (client_id, email, role, source, updated_at, updated_by)
    select w.client_id, w.email, w.role,
           case when w.role = 'billing' then 'quickbooks' else 'salesforce' end,
           now(), 'sync'
    from distinct_wanted w
    on conflict (client_id, lower(email), role) do update
      /* Only the clock and who touched it. Never active, never opted_out_at,
         never bounced_at -- a sync must not undo a person's decision. */
      set updated_at = now(), updated_by = 'sync'
    returning 1
  )
  select count(*) into v_touched from written;

  return query
  select (select count(*) from public.client_contacts)::integer - v_before,
         v_touched::integer;
end;
$function$;

revoke all on function public.refresh_client_contacts() from public, anon;
grant execute on function public.refresh_client_contacts() to authenticated;

/*
 * Nightly, after the Coupler syncs have landed. Not hourly: the sources change
 * about ten times a month between them, and a job that writes nothing 23 times
 * a day is just noise in the log.
 */
select cron.unschedule('client-contacts-sync')
where exists (select 1 from cron.job where jobname = 'client-contacts-sync');

select cron.schedule(
  'client-contacts-sync',
  '40 6 * * *',
  $$select public.refresh_client_contacts()$$
);
