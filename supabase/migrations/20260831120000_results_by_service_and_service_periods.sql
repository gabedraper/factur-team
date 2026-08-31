/*
 * Results belong to the service that produced them, and a client's service
 * changes.
 *
 * The first cut of client_monthly_results carried one flattened service per
 * client, taken from Clients__c.Service__c. That is wrong for anyone who ever
 * upgraded, downgraded or ran two at once. Sirois is the clear case: three
 * years on OP, a transition through 2023, LG only by 2024 -- and a client
 * record that says, simply, "LG".
 *
 * The fix is that Opportunity carries its own Service__c, filled on 99.7% of
 * result opportunities going back to 2018. Every lead, quote and PO already
 * knows which service produced it. Nobody has to remember to record any of it.
 */

-- ---------------------------------------------------------------------------
-- Which number a service is judged on
-- ---------------------------------------------------------------------------

/*
 * Said once, here, because three places need it and they must not drift.
 *
 * LG delivers leads, OSDR appointments, OP quotes. Every service tracks POs,
 * so POs are never the headline -- they are the outcome beside it.
 */
create or replace function public.service_headline_metric(service text)
returns text
language sql
immutable
as $fn$
  select case
    when service in ('OP', 'OBDM', 'SMB - OBDM', 'Constructur - OBDM') then 'quotes'
    when service in ('OSDR', 'SMB - OSDR', 'Constructur - OSDR')       then 'appointments'
    when service in ('LG', 'Constructur - LG', 'RG')                   then 'leads'
    else null
  end;
$fn$;

-- ---------------------------------------------------------------------------
-- Monthly results, now per service
-- ---------------------------------------------------------------------------

/*
 * Rebuilt rather than altered. Every row is derived from Salesforce and the
 * loader repopulates the lot, so there is nothing here worth migrating -- and
 * adding a column to a primary key in place is more ceremony than it is worth.
 */
drop table if exists public.client_monthly_results;

create table public.client_monthly_results (
  salesforce_client_id text not null
    references public.client_roster (salesforce_client_id) on delete cascade,
  /*
   * The service tag on the opportunities themselves. 'Other' collects the
   * marketing, website and recruiting services, which together are 3% of
   * result volume and produce nothing the results page reports on.
   */
  service text not null,
  month_index int not null check (month_index >= 1),
  month_start date not null,
  leads int not null default 0,
  appointments int not null default 0,
  quotes int not null default 0,
  pos int not null default 0,
  quote_amount numeric not null default 0,
  po_amount numeric not null default 0,
  computed_at timestamptz not null default now(),
  primary key (salesforce_client_id, service, month_index)
);

create index client_monthly_results_month_idx
  on public.client_monthly_results (month_index);
create index client_monthly_results_service_idx
  on public.client_monthly_results (service);

comment on table public.client_monthly_results is
  'Opportunities counted into the month of the engagement they landed in, split by the service that produced them.';

alter table public.client_monthly_results enable row level security;

create policy client_monthly_results_read on public.client_monthly_results
  for select using (public.is_factur_user());

grant select on public.client_monthly_results to authenticated;

-- ---------------------------------------------------------------------------
-- Service periods
-- ---------------------------------------------------------------------------

/*
 * One row per stint a client spent on a service. An upgrade is not an edit --
 * it closes one row and opens another, so the history keeps itself.
 *
 * Overlap between rows is allowed and correct: a client can genuinely run two
 * services at once, and Sirois ran OP and LG together through all of 2023. The
 * constraint that would force a single active service is exactly the mistake
 * that made the last two attempts at this unusable.
 *
 * People are deliberately not here. Staffing changes on its own clock -- an
 * account manager can turn over three times inside one unbroken engagement --
 * and if the AM were a column here, every staffing change would have to close
 * and reopen the period, splitting one engagement into four. Who held which
 * role and when already lives in client_history; join the two on overlapping
 * dates when you need "who ran the OP engagement".
 */
create table if not exists public.client_service_periods (
  id uuid primary key default gen_random_uuid(),
  salesforce_client_id text not null
    references public.client_roster (salesforce_client_id) on delete cascade,
  service text not null,
  started_on date not null,
  -- Null means still running.
  ended_on date,
  -- Commercial terms belong to the stint, not the client: they change with it.
  monthly_rate numeric,
  tier text,
  /*
   * 'derived' rows are rebuilt from opportunity tags on every load. 'manual'
   * rows are never touched by the loader, which is what makes a hand
   * correction stick.
   */
  source text not null default 'derived' check (source in ('derived', 'manual')),
  note text,
  created_at timestamptz not null default now(),
  constraint client_service_periods_dates check (ended_on is null or ended_on >= started_on)
);

create index if not exists client_service_periods_client_idx
  on public.client_service_periods (salesforce_client_id);
create unique index if not exists client_service_periods_derived_uniq
  on public.client_service_periods (salesforce_client_id, service, started_on)
  where source = 'derived';

comment on table public.client_service_periods is
  'One row per stint a client spent on a service. Overlaps are legitimate.';

alter table public.client_service_periods enable row level security;

drop policy if exists client_service_periods_read on public.client_service_periods;
create policy client_service_periods_read on public.client_service_periods
  for select using (public.is_factur_user());

grant select on public.client_service_periods to authenticated;

-- ---------------------------------------------------------------------------
-- The read model
-- ---------------------------------------------------------------------------

create or replace view public.client_results_summary as
  with totals as (
    select salesforce_client_id,
           count(distinct month_index) as months_with_results,
           max(month_index)            as last_month_index,
           sum(leads)                  as leads,
           sum(appointments)           as appointments,
           sum(quotes)                 as quotes,
           sum(pos)                    as pos,
           sum(quote_amount)           as quote_amount,
           sum(po_amount)              as po_amount
    from public.client_monthly_results
    group by salesforce_client_id
  ),
  first_3 as (
    select salesforce_client_id,
           sum(leads)        as first_3_leads,
           sum(appointments) as first_3_appointments,
           sum(quotes)       as first_3_quotes,
           sum(pos)          as first_3_pos
    from public.client_monthly_results
    where month_index <= 3
    group by salesforce_client_id
  ),
  /*
   * The services a client was actually delivered, in order of volume, rather
   * than the one word on their Salesforce record. This is what makes an
   * upgrade visible in a list of 987 clients.
   */
  delivered as (
    select salesforce_client_id,
           array_agg(service order by leads desc) as services_delivered,
           (array_agg(service order by leads desc))[1] as busiest_service
    from (
      select salesforce_client_id, service, sum(leads) as leads
      from public.client_monthly_results
      group by salesforce_client_id, service
    ) s
    group by salesforce_client_id
  )
  select
    c.*,
    coalesce(d.services_delivered, '{}') as services_delivered,
    d.busiest_service,
    (cardinality(coalesce(d.services_delivered, '{}')) > 1) as multi_service,
    /*
     * Judged on the service that actually produced the most for them, falling
     * back to the Salesforce field where nothing was ever delivered.
     */
    coalesce(
      public.service_headline_metric(d.busiest_service),
      public.service_headline_metric(c.primary_service)
    ) as headline_metric,
    coalesce(t.months_with_results, 0) as months_with_results,
    t.last_month_index,
    coalesce(t.leads, 0)          as leads,
    coalesce(t.appointments, 0)   as appointments,
    coalesce(t.quotes, 0)         as quotes,
    coalesce(t.pos, 0)            as pos,
    coalesce(t.quote_amount, 0)   as quote_amount,
    coalesce(t.po_amount, 0)      as po_amount,
    coalesce(f.first_3_leads, 0)        as first_3_leads,
    coalesce(f.first_3_appointments, 0) as first_3_appointments,
    coalesce(f.first_3_quotes, 0)       as first_3_quotes,
    coalesce(f.first_3_pos, 0)          as first_3_pos,
    case when coalesce(t.months_with_results, 0) > 0
         then round(t.leads::numeric / t.months_with_results, 1) end as leads_per_month
  from public.client_cohorts c
  left join totals    t using (salesforce_client_id)
  left join first_3   f using (salesforce_client_id)
  left join delivered d using (salesforce_client_id);

grant select on public.client_results_summary to authenticated;
