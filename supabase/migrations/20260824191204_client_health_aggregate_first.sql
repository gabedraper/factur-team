-- Superseded by (activity_date, account_id), which answers the same question
-- from the index alone. An unused index still costs on every write.
drop index if exists public.raw_activities_account_date_idx;

/*
 * A health score per client.
 *
 * Each source is aggregated down to one row per client *before* being joined,
 * rather than joined and then counted. Counting is cheap; fetching is not, and
 * the join-then-count shape fanned 212 clients out to 40,000 activity rows and
 * fetched every one from disk -- twenty-five seconds, well past the statement
 * timeout, which is what took this page down.
 *
 * The rule throughout: an input with nothing to measure returns null, never
 * zero. A client with no receivables on file is unmeasured, not unhealthy.
 */
create or replace function public.get_client_health()
returns table (
  client_id uuid, client_name text, status text, account_manager text,
  manual_health text,
  leads_30d bigint, leads_prior_30d bigint, lead_flow_score int,
  activities_30d bigint, activities_prior_30d bigint, activity_score int,
  nps_latest smallint, nps_previous smallint, nps_on date, nps_score int,
  quoted bigint, no_quoted bigint, dm_known int, engagement_score int,
  ar_total numeric, ar_overdue_60_plus numeric, receivables_score int,
  inputs_measured int, overall_score int
)
language sql stable security definer set search_path to 'public'
as $$
  with w as (
    select input, weight from client_health_weights where enabled and weight > 0
  ),
  base as (
    select c.id, c.name, c.status, c.salesforce_client_id,
           m.full_name as am, sf.health_score__c as manual,
           sf.client_account__c as account_id
    from org_clients c
    left join org_members m on m.id = c.account_manager_id
    left join sf_clients_raw sf on sf.id = c.salesforce_client_id
    where public.is_factur_user()
      and c.active and coalesce(c.status, '') <> 'Inactive'
  ),
  -- One row per account, straight off the index, before anything is joined.
  acts as (
    select account_id,
           count(*) filter (where activity_date >= current_date - 30) as recent,
           count(*) filter (where activity_date >= current_date - 60
                              and activity_date <  current_date - 30) as prior
    from raw_activities
    where activity_date >= current_date - 60 and account_id is not null
    group by account_id
  ),
  -- One row per client, likewise.
  leads as (
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
    group by client__c
  ),
  ar as (select * from public.get_client_ar()),
  scored as (
    select b.*, l.recent leads_recent, l.prior leads_prior, l.quoted, l.no_quoted,
           l.total, l.with_title, a.recent acts_recent, a.prior acts_prior,
           n.latest_score, n.previous_score, n.latest_on,
           ar.total as ar_total, ar.overdue_60_plus,
           case when coalesce(l.prior, 0) = 0 and coalesce(l.recent, 0) = 0 then null
                when coalesce(l.prior, 0) = 0 then 100
                else least(100, round(l.recent::numeric / l.prior * 75))::int end as lead_flow_score,
           case when coalesce(a.prior, 0) = 0 and coalesce(a.recent, 0) = 0 then null
                when coalesce(a.prior, 0) = 0 then 100
                else least(100, round(a.recent::numeric / a.prior * 75))::int end as activity_score,
           (n.latest_score * 10)::int as nps_score,
           (select round(avg(v))::int from (values
              (case when coalesce(l.quoted, 0) + coalesce(l.no_quoted, 0) > 0
                    then l.quoted::numeric / (l.quoted + l.no_quoted) * 100 end),
              (case when coalesce(l.total, 0) > 0
                    then l.with_title::numeric / l.total * 100 end)
            ) t(v) where v is not null) as engagement_score,
           -- How much of what they owe has gone stale. All current is 100, all
           -- past ninety days is 0, the buckets between count by how late.
           case when ar.total is null then null
                when ar.total <= 0 then 100
                else greatest(0, round(100 - (
                       (ar.bucket_1_30 * 0.10 + ar.bucket_31_60 * 0.35
                      + ar.bucket_61_90 * 0.65 + ar.bucket_91_plus * 1.00)
                       / ar.total * 100)))::int end as receivables_score
    from base b
    left join leads l on l.client_key = b.salesforce_client_id
    left join acts a on a.account_id = b.account_id
    left join client_nps_latest n on n.client_id = b.id
    left join ar on ar.client_id = b.id
  ),
  parts as (
    select s.id, v.input, v.score from scored s
    cross join lateral (values
      ('lead_flow', s.lead_flow_score), ('activity', s.activity_score),
      ('nps', s.nps_score), ('engagement', s.engagement_score),
      ('receivables', s.receivables_score)) as v(input, score)
  ),
  rolled as (
    select p.id,
           sum(w.weight) filter (where p.score is not null) as live_weight,
           sum(w.weight * p.score) filter (where p.score is not null) as weighted_sum,
           count(*) filter (where p.score is not null)::int as inputs_measured
    from parts p join w on w.input = p.input group by p.id
  )
  select s.id, s.name, s.status, s.am, s.manual,
         s.leads_recent, s.leads_prior, s.lead_flow_score,
         s.acts_recent, s.acts_prior, s.activity_score,
         s.latest_score, s.previous_score, s.latest_on, s.nps_score,
         s.quoted, s.no_quoted,
         case when s.total > 0 then round(s.with_title::numeric / s.total * 100)::int end,
         s.engagement_score, s.ar_total, s.overdue_60_plus, s.receivables_score,
         coalesce(r.inputs_measured, 0),
         case when r.live_weight > 0 then round(r.weighted_sum / r.live_weight)::int end
  from scored s left join rolled r on r.id = s.id;
$$;

revoke all on function public.get_client_health() from public, anon;
grant execute on function public.get_client_health() to authenticated, service_role;
