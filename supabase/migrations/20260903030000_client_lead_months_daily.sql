/*
 * Leads by month, refreshed daily, with the date it was refreshed.
 *
 * The card was reading client_monthly_results, which is a Salesforce backfill
 * run by hand -- so the month in progress read near zero and the card had to
 * hide it. Running that loader daily is not possible: it reads cached SOQL
 * result files and the app holds no Salesforce credentials.
 *
 * sf_opp_leads_raw does refresh, on Coupler's schedule, and is current to
 * today. It covers 158 of the 214 active clients. So each (client, month) takes
 * the fresher of the two:
 *
 *   daily     counted from sf_opp_leads_raw, for the clients Coupler syncs
 *   backfill  client_monthly_results, for everyone else
 *
 * source says which, and computed_at says when, so the card can state what it
 * is showing rather than implying every number is live.
 *
 * The stage rule matches the one Client Results settled on, so a month counted
 * here means the same thing as a month counted there.
 */
create table if not exists client_lead_months (
  salesforce_client_id text not null
    references client_roster (salesforce_client_id) on delete cascade,
  month_start date not null,
  leads bigint not null,
  source text not null check (source in ('daily', 'backfill')),
  computed_at timestamptz not null default now(),
  primary key (salesforce_client_id, month_start)
);

alter table client_lead_months enable row level security;
drop policy if exists client_lead_months_read on client_lead_months;
create policy client_lead_months_read on client_lead_months
  for select to authenticated using (public.is_factur_user());

create or replace function public.refresh_client_lead_months()
returns void
language plpgsql
security definer
set search_path = public
set statement_timeout = '10min'
as $fn$
declare
  -- The same stages Client Results counts as delivered.
  delivered text[] := array[
    'Lead Generated', 'Lead Generated: Scheduled', 'Pipeline Hot: Appointment set',
    'Pipeline Hot: Quoting', 'Pipeline Hot: Quote Follow up',
    'Pipeline Hot: Client RFQ Review', 'Pipeline Hot: Supplier forms / NDA',
    'Pipeline - Selling', 'Closed: Closed Won', 'Closed: Closed Lost',
    'Closed: No Quote', 'Sales Support', 'Appointment Set', 'Proposal',
    'Needs Analysis'];
  since date := (date_trunc('month', current_date) - interval '6 months')::date;
begin
  create temp table _leads on commit drop as
  with fresh as (
    select l.client__c as salesforce_client_id,
           date_trunc('month', l.createddate)::date as month_start,
           count(*)::bigint as leads
    from sf_opp_leads_raw l
    where l.client__c is not null
      and l.createddate >= since
      and l.stagename = any(delivered)
    group by 1, 2
  ),
  -- Which clients Coupler covers at all. A covered client with no leads in a
  -- month should read zero, not fall back to a stale backfill number.
  covered as (
    select distinct client__c as salesforce_client_id
    from sf_opp_leads_raw where client__c is not null
  ),
  backfill as (
    select m.salesforce_client_id,
           m.month_start,
           sum(m.leads)::bigint as leads
    from client_monthly_results m
    where m.month_start >= since
    group by 1, 2
  )
  select coalesce(f.salesforce_client_id, b.salesforce_client_id) as salesforce_client_id,
         coalesce(f.month_start, b.month_start) as month_start,
         coalesce(f.leads, b.leads, 0) as leads,
         case when c.salesforce_client_id is not null then 'daily' else 'backfill' end as source
  from backfill b
  full outer join fresh f
    on f.salesforce_client_id = b.salesforce_client_id and f.month_start = b.month_start
  left join covered c
    on c.salesforce_client_id = coalesce(f.salesforce_client_id, b.salesforce_client_id)
  where coalesce(f.salesforce_client_id, b.salesforce_client_id)
        in (select salesforce_client_id from client_roster);

  delete from client_lead_months;
  insert into client_lead_months (salesforce_client_id, month_start, leads, source, computed_at)
    select salesforce_client_id, month_start, leads, source, now() from _leads;
end;
$fn$;

comment on function public.refresh_client_lead_months() is
  'Leads per client per month over the last six. Daily from sf_opp_leads_raw where Coupler covers the client, else the Salesforce backfill.';

select public.refresh_client_lead_months();

/*
 * The month in progress is now included: it is counted daily rather than left
 * to a hand-run loader, so a partial month is real information rather than an
 * artefact.
 */
create or replace view public.client_lead_months_by_client
with (security_invoker = true) as
select oc.id as client_id, m.month_start, m.leads, m.source, m.computed_at
from public.client_lead_months m
join public.org_clients oc on oc.salesforce_client_id = m.salesforce_client_id;

grant select on public.client_lead_months_by_client to authenticated;

select cron.unschedule('client-lead-months')
where exists (select 1 from cron.job where jobname = 'client-lead-months');

-- 05:40 daily, before anyone is looking at the page.
select cron.schedule(
  'client-lead-months',
  '40 5 * * *',
  $cron$select public.refresh_client_lead_months();$cron$
);
