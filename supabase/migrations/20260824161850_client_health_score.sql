/*
 * A health score per client, from the inputs that actually have data behind
 * them.
 *
 * The rule throughout: an input with nothing to measure returns null, never
 * zero. A client with no receivables data on file is unmeasured, not unhealthy,
 * and scoring the gap as a nought would quietly mark the best-paying clients as
 * failing. The overall is the weighted average of whatever *is* known, and the
 * count of contributing inputs travels with it so a score built on one signal
 * can be told apart from one built on five.
 */
create or replace function public.get_client_health()
returns table (
  client_id uuid, client_name text, status text, account_manager text,
  manual_health text,
  leads_30d bigint, leads_prior_30d bigint, lead_flow_score int,
  activities_30d bigint, activities_prior_30d bigint, activity_score int,
  nps_latest smallint, nps_previous smallint, nps_on date, nps_score int,
  quoted bigint, no_quoted bigint, dm_known numeric, engagement_score int,
  open_balance numeric, days_since_payment int, receivables_score int,
  inputs_measured int, overall_score int
)
language sql stable security definer set search_path to 'public'
as $$
  with w as (
    select input, weight from client_health_weights where enabled and weight > 0
  ),
  base as (
    select c.id, c.name, c.status, c.salesforce_client_id,
           m.full_name as am,
           sf.health_score__c as manual,
           sf.open_balance__c as open_balance,
           sf.last_payment_received__c as last_payment
    from org_clients c
    left join org_members m on m.id = c.account_manager_id
    left join sf_clients_raw sf on sf.id = c.salesforce_client_id
    where public.is_factur_user() and c.active
  ),
  -- 1. Lead flow: this month against the month before it, for this client.
  leads as (
    select b.id,
           count(*) filter (where l.createddate >= now() - interval '30 days') as recent,
           count(*) filter (where l.createddate >= now() - interval '60 days'
                              and l.createddate <  now() - interval '30 days') as prior,
           count(*) filter (where l.stagename ilike '%Quot%'
                              and l.stagename not ilike '%No Quote%') as quoted,
           count(*) filter (where l.stagename ilike '%No Quote%') as no_quoted,
           count(*) as total,
           count(l.contact_title__c) as with_title
    from base b
    left join sf_opp_leads_raw l on l.client__r_name = b.name
    group by b.id
  ),
  -- 2. Account-manager activity on the client's own account, same comparison.
  acts as (
    select b.id,
           count(*) filter (where ra.activity_date >= current_date - 30) as recent,
           count(*) filter (where ra.activity_date >= current_date - 60
                              and ra.activity_date <  current_date - 30) as prior
    from base b
    left join sf_clients_raw sf on sf.id = b.salesforce_client_id
    left join raw_activities ra on ra.account_id = sf.client_account__c
    group by b.id
  ),
  scored as (
    select b.id, b.name, b.status, b.am, b.manual,
           l.recent as leads_recent, l.prior as leads_prior,
           a.recent as acts_recent, a.prior as acts_prior,
           l.quoted, l.no_quoted, l.total, l.with_title,
           n.latest_score, n.previous_score, n.latest_on,
           b.open_balance, b.last_payment,

           -- Ratio against the client's own previous month, capped at 100.
           -- Steady (ratio 1) reads as 75: holding the line is doing the job.
           case when coalesce(l.prior, 0) = 0 and coalesce(l.recent, 0) = 0 then null
                when coalesce(l.prior, 0) = 0 then 100
                else least(100, greatest(0, round(l.recent::numeric / l.prior * 75)))::int
           end as lead_flow_score,

           case when coalesce(a.prior, 0) = 0 and coalesce(a.recent, 0) = 0 then null
                when coalesce(a.prior, 0) = 0 then 100
                else least(100, greatest(0, round(a.recent::numeric / a.prior * 75)))::int
           end as activity_score,

           -- 0-10 on the survey's own scale, read onto 0-100.
           (n.latest_score * 10)::int as nps_score,

           -- 4. Engagement: of the leads that reached a quoting decision, how
           -- many were actually quoted; and how often a decision maker is named.
           case when coalesce(l.quoted, 0) + coalesce(l.no_quoted, 0) = 0
                     and coalesce(l.total, 0) = 0 then null
                else round((
                  coalesce(
                    case when l.quoted + l.no_quoted > 0
                         then l.quoted::numeric / (l.quoted + l.no_quoted) * 100 end,
                    case when l.total > 0 then l.with_title::numeric / l.total * 100 end)
                  + coalesce(
                    case when l.total > 0 then l.with_title::numeric / l.total * 100 end, 0)
                ) / 2)::int
           end as engagement_score,

           case when b.open_balance is null then null
                when b.open_balance <= 0 then 100
                when b.last_payment is null then 40
                else greatest(0, 100 - (current_date - b.last_payment))::int
           end as receivables_score
    from base b
    left join leads l on l.id = b.id
    left join acts a on a.id = b.id
    left join client_nps_latest n on n.client_id = b.id
  ),
  weighted as (
    select s.*,
           (select sum(w.weight) from w
             where (w.input = 'lead_flow'   and s.lead_flow_score  is not null)
                or (w.input = 'activity'    and s.activity_score   is not null)
                or (w.input = 'nps'         and s.nps_score        is not null)
                or (w.input = 'engagement'  and s.engagement_score is not null)
                or (w.input = 'receivables' and s.receivables_score is not null)
           ) as live_weight,
           (select sum(w.weight * v.score) from w
              join lateral (values
                ('lead_flow',   s.lead_flow_score),
                ('activity',    s.activity_score),
                ('nps',         s.nps_score),
                ('engagement',  s.engagement_score),
                ('receivables', s.receivables_score)
              ) as v(input, score) on v.input = w.input
             where v.score is not null) as weighted_sum,
           (case when s.lead_flow_score  is not null then 1 else 0 end
          + case when s.activity_score   is not null then 1 else 0 end
          + case when s.nps_score        is not null then 1 else 0 end
          + case when s.engagement_score is not null then 1 else 0 end
          + case when s.receivables_score is not null then 1 else 0 end) as inputs_measured
    from scored s
  )
  select id, name, status, am, manual,
         leads_recent, leads_prior, lead_flow_score,
         acts_recent, acts_prior, activity_score,
         latest_score, previous_score, latest_on, nps_score,
         quoted, no_quoted,
         case when total > 0 then round(with_title::numeric / total * 100, 0) end,
         engagement_score,
         open_balance,
         case when last_payment is not null then (current_date - last_payment)::int end,
         receivables_score,
         inputs_measured,
         case when live_weight > 0 then round(weighted_sum / live_weight)::int end
  from weighted;
$$;

revoke all on function public.get_client_health() from public, anon;
grant execute on function public.get_client_health() to authenticated, service_role;
