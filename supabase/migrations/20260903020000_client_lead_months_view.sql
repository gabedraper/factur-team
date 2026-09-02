/*
 * Leads per client per calendar month, for the Lead Flow card.
 *
 * Summed across services, since client_monthly_results splits by service and
 * the card wants the client's total. Only complete months: that table is a
 * Salesforce backfill rather than a live feed, so the month in progress reads
 * near zero until scripts/rebuild-client-results.py runs again, and showing it
 * would look like a collapse rather than a gap.
 *
 * The card ranks each month against the same month for every other client, so
 * a quiet August is judged against everyone else's August. Cut points sit
 * around 2-3 leads for the bottom third and 5-7 for the top, against a best of
 * 25-49 -- the distribution has a long tail and a short body, which is exactly
 * why fixed thresholds would be useless here.
 */
create or replace view public.client_lead_months_by_client
with (security_invoker = true) as
select oc.id as client_id,
       m.month_start,
       sum(m.leads)::bigint as leads
from public.client_monthly_results m
join public.org_clients oc on oc.salesforce_client_id = m.salesforce_client_id
where m.month_start >= (date_trunc('month', current_date) - interval '6 months')::date
  and m.month_start <  date_trunc('month', current_date)::date
group by oc.id, m.month_start;

grant select on public.client_lead_months_by_client to authenticated;
