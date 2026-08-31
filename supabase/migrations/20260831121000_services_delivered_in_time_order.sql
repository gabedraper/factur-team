/*
 * services_delivered is rendered as "OP -> LG", so it has to be in the order
 * the client actually took them, not in order of volume. busiest_service stays
 * volume-ranked: it answers a different question -- which service defined the
 * engagement, and therefore which metric the client is judged on.
 */
create or replace view public.client_results_summary as
  with totals as (
    select salesforce_client_id,
           count(distinct month_index) as months_with_results,
           max(month_index)            as last_month_index,
           sum(leads) as leads, sum(appointments) as appointments,
           sum(quotes) as quotes, sum(pos) as pos,
           sum(quote_amount) as quote_amount, sum(po_amount) as po_amount
    from public.client_monthly_results group by salesforce_client_id
  ),
  first_3 as (
    select salesforce_client_id,
           sum(leads) as first_3_leads, sum(appointments) as first_3_appointments,
           sum(quotes) as first_3_quotes, sum(pos) as first_3_pos
    from public.client_monthly_results where month_index <= 3
    group by salesforce_client_id
  ),
  per_service as (
    select salesforce_client_id, service,
           sum(leads) as leads, min(month_index) as started_at
    from public.client_monthly_results group by salesforce_client_id, service
  ),
  delivered as (
    select salesforce_client_id,
           array_agg(service order by started_at, service) as services_delivered,
           (array_agg(service order by leads desc, service))[1] as busiest_service
    from per_service group by salesforce_client_id
  )
  select
    c.*,
    coalesce(d.services_delivered, '{}') as services_delivered,
    d.busiest_service,
    (cardinality(coalesce(d.services_delivered, '{}')) > 1) as multi_service,
    coalesce(
      public.service_headline_metric(d.busiest_service),
      public.service_headline_metric(c.primary_service)
    ) as headline_metric,
    coalesce(t.months_with_results, 0) as months_with_results,
    t.last_month_index,
    coalesce(t.leads, 0) as leads, coalesce(t.appointments, 0) as appointments,
    coalesce(t.quotes, 0) as quotes, coalesce(t.pos, 0) as pos,
    coalesce(t.quote_amount, 0) as quote_amount, coalesce(t.po_amount, 0) as po_amount,
    coalesce(f.first_3_leads, 0) as first_3_leads,
    coalesce(f.first_3_appointments, 0) as first_3_appointments,
    coalesce(f.first_3_quotes, 0) as first_3_quotes,
    coalesce(f.first_3_pos, 0) as first_3_pos,
    case when coalesce(t.months_with_results, 0) > 0
         then round(t.leads::numeric / t.months_with_results, 1) end as leads_per_month
  from public.client_cohorts c
  left join totals    t using (salesforce_client_id)
  left join first_3   f using (salesforce_client_id)
  left join delivered d using (salesforce_client_id);

grant select on public.client_results_summary to authenticated;
