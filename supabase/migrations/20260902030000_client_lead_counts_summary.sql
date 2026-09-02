/*
 * The lead counts client health needs, worked out once an hour instead of on
 * every page load.
 *
 * The activity half of this page was precomputed on 2026-08-31 and has behaved
 * since. The lead half was left alone, and it is now the whole cost of the
 * page: a parallel sequential scan of all 90,476 rows of sf_opp_leads_raw,
 * every request, to produce 158 rows. Measured at 2.6s against a
 * statement_timeout of 8s, which is why /clients/health has no fast loads at
 * all -- 13 of its last 17 views took over five seconds and the quickest was
 * 3.4s.
 *
 * Worse, sf_opp_leads_raw is a Coupler table. It is dropped and recreated on
 * every sync, so it has no statistics or visibility map worth the name for
 * some part of every hour, and no index will survive to help. Scanning it on a
 * request path was always going to be a page that falls over eventually, and
 * on 2026-09-01 it did.
 *
 * Same treatment as client_activity_counts, for the same reason: the page does
 * not need these live. Rolling 30 and 60 day windows and lifetime totals do not
 * move meaningfully within an hour.
 */

create table if not exists client_lead_counts (
  client_key text primary key,
  recent bigint not null,
  prior bigint not null,
  quoted bigint not null,
  no_quoted bigint not null,
  total bigint not null,
  with_title bigint not null,
  computed_at timestamptz not null default now()
);

alter table client_lead_counts enable row level security;

drop policy if exists client_lead_counts_read on client_lead_counts;
create policy client_lead_counts_read on client_lead_counts
  for select to authenticated using (public.is_factur_user());

create or replace function public.refresh_client_lead_counts()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  /*
   * Rebuilt whole. It is 158 rows out of a table that Coupler replaces
   * wholesale anyway, so there is nothing to be gained by working out which
   * counts moved.
   *
   * The aggregates are copied exactly from the CTE this replaces, including
   * the ilike matching on stage names. Changing what they mean is a separate
   * decision from changing when they are computed.
   */
  create temp table _leads on commit drop as
    select client__c as client_key,
           count(*) filter (where createddate >= now() - interval '30 days') as recent,
           count(*) filter (where createddate >= now() - interval '60 days'
                              and createddate <  now() - interval '30 days') as prior,
           count(*) filter (where stagename ilike '%Quot%'
                              and stagename not ilike '%No Quote%') as quoted,
           count(*) filter (where stagename ilike '%No Quote%') as no_quoted,
           count(*) as total,
           count(contact_title__c) as with_title
    from sf_opp_leads_raw
    where client__c is not null
    group by client__c;

  delete from client_lead_counts;
  insert into client_lead_counts
    (client_key, recent, prior, quoted, no_quoted, total, with_title, computed_at)
    select client_key, recent, prior, quoted, no_quoted, total, with_title, now()
    from _leads;
end;
$$;

comment on function public.refresh_client_lead_counts() is
  'Rebuilds the lead counts client health reads. Hourly; an hour of lag is invisible in a rolling monthly total.';

select public.refresh_client_lead_counts();

-- Hourly at :40, between the activity counts at :35 and the vacuum at :45.
select cron.unschedule('client-lead-counts')
where exists (select 1 from cron.job where jobname = 'client-lead-counts');

select cron.schedule(
  'client-lead-counts',
  '40 * * * *',
  $cron$select public.refresh_client_lead_counts();$cron$
);
