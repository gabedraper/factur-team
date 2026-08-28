/*
 * One row per client, cohort and lifetime results already joined.
 *
 * The list page shows 987 clients at once and sorts on any column, so the
 * aggregation has to happen here rather than over 10,000 monthly rows shipped
 * to a browser.
 *
 * first_3_* is the whole reason the section exists: it is the number a salesperson
 * needs when a prospect asks what happens in the first quarter, and it is only
 * comparable across clients because month_index is relative to each client's
 * own start.
 */
create or replace view public.client_results_summary as
  with totals as (
    select salesforce_client_id,
           count(*)               as months_with_results,
           max(month_index)       as last_month_index,
           sum(leads)             as leads,
           sum(appointments)      as appointments,
           sum(quotes)            as quotes,
           sum(pos)               as pos,
           sum(quote_amount)      as quote_amount,
           sum(po_amount)         as po_amount
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
  )
  select
    c.*,
    /*
     * Which number this client should be judged on. LG is contracted to
     * deliver leads, OSDR appointments, OBDM and OP quotes. Every service
     * tracks POs, so POs are never the headline -- they are the outcome
     * shown alongside whatever the headline is.
     */
    case
      when c.primary_service in ('SMB - OBDM', 'Constructur - OBDM', 'OP') then 'quotes'
      when c.primary_service in ('SMB - OSDR', 'Constructur - OSDR', 'OSDR') then 'appointments'
      when c.primary_service in ('LG', 'Constructur - LG', 'RG') then 'leads'
      else null
    end as headline_metric,
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
    -- Leads per month of the engagement, the one figure that compares a
    -- three-month client to a three-year one.
    case when coalesce(t.months_with_results, 0) > 0
         then round(t.leads::numeric / t.months_with_results, 1) end as leads_per_month
  from public.client_cohorts c
  left join totals  t using (salesforce_client_id)
  left join first_3 f using (salesforce_client_id);

grant select on public.client_results_summary to authenticated;
