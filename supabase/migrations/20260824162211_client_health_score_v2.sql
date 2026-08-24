-- Recorded after the fact: this was run by hand at the time. Postgres cannot
-- change a function's return type with CREATE OR REPLACE, so a clean replay
-- of this history fails here without it.
drop function if exists public.get_client_health();

/*
 * A health score per client, from the inputs that have data behind them.
 *
 * The rule throughout: an input with nothing to measure returns null, never
 * zero. A client with no receivables on file is unmeasured, not unhealthy, and
 * scoring the gap as a nought would mark the best-paying clients as failing.
 * The overall is the weighted average of whatever is known, and the number of
 * contributing inputs travels with it, so a score resting on one signal can be
 * told apart from one resting on five.
 *
 * Leads join on the client's Salesforce id rather than its name -- the same
 * reason the timelines match reps on id: a name typed two ways is two clients.
 */
create or replace function public.get_client_health()
returns table (
  client_id uuid, client_name text, status text, account_manager text,
  manual_health text,
  leads_30d bigint, leads_prior_30d bigint, lead_flow_score int,
  activities_30d bigint, activities_prior_30d bigint, activity_score int,
  nps_latest smallint, nps_previous smallint, nps_on date, nps_score int,
  quoted bigint, no_quoted bigint, dm_known int, engagement_score int,
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
           sf.client_account__c as account_id,
           sf.open_balance__c as open_balance,
           sf.last_payment_received__c as last_payment
    from org_clients c
    left join org_members m on m.id = c.account_manager_id
    left join sf_clients_raw sf on sf.id = c.salesforce_client_id
    where public.is_factur_user()
      and c.active
      and coalesce(c.status, '') <> 'Inactive'
  ),
  leads as (
    select b.id,
           count(l.id) filter (where l.createddate >= now() - interval '30 days') as recent,
           count(l.id) filter (where l.createddate >= now() - interval '60 days'
                                 and l.createddate <  now() - interval '30 days') as prior,
           count(l.id) filter (where l.stagename ilike '%Quot%'
                                 and l.stagename not ilike '%No Quote%') as quoted,
           count(l.id) filter (where l.stagename ilike '%No Quote%') as no_quoted,
           count(l.id) as total,
           count(l.contact_title__c) as with_title
    from base b
    left join sf_opp_leads_raw l on l.client__c = b.salesforce_client_id
    group by b.id
  ),
  acts as (
    select b.id,
           count(ra.id) filter (where ra.activity_date >= current_date - 30) as recent,
           count(ra.id) filter (where ra.activity_date >= current_date - 60
                                  and ra.activity_date <  current_date - 30) as prior
    from base b
    left join raw_activities ra on ra.account_id = b.account_id
    group by b.id
  ),
  scored as (
    select b.*, l.recent leads_recent, l.prior leads_prior, l.quoted, l.no_quoted,
           l.total, l.with_title, a.recent acts_recent, a.prior acts_prior,
           n.latest_score, n.previous_score, n.latest_on,

           -- Measured against the client's own previous month, capped at 100.
           -- Steady (ratio 1) reads as 75: holding the line is doing the job.
           case when coalesce(l.prior, 0) = 0 and coalesce(l.recent, 0) = 0 then null
                when coalesce(l.prior, 0) = 0 then 100
                else least(100, round(l.recent::numeric / l.prior * 75))::int
           end as lead_flow_score,

           case when coalesce(a.prior, 0) = 0 and coalesce(a.recent, 0) = 0 then null
                when coalesce(a.prior, 0) = 0 then 100
                else least(100, round(a.recent::numeric / a.prior * 75))::int
           end as activity_score,

           (n.latest_score * 10)::int as nps_score,

           -- The average of whichever engagement signals can be computed: how
           -- many of the leads that reached a quoting decision were actually
           -- quoted, and how often a decision maker is named on one.
           (select round(avg(v))::int from (values
              (case when coalesce(l.quoted, 0) + coalesce(l.no_quoted, 0) > 0
                    then l.quoted::numeric / (l.quoted + l.no_quoted) * 100 end),
              (case when coalesce(l.total, 0) > 0
                    then l.with_title::numeric / l.total * 100 end)
            ) t(v) where v is not null) as engagement_score,

           case when b.open_balance is null then null
                when b.open_balance <= 0 then 100
                -- An outstanding balance with no payment on record is a worry,
                -- but not knowing when they last paid is not the same as
                -- knowing they never did.
                when b.last_payment is null then 40
                else greatest(0, 100 - (current_date - b.last_payment))::int
           end as receivables_score
    from base b
    left join leads l on l.id = b.id
    left join acts a on a.id = b.id
    left join client_nps_latest n on n.client_id = b.id
  ),
  parts as (
    select s.id, v.input, v.score
    from scored s
    cross join lateral (values
      ('lead_flow',   s.lead_flow_score),
      ('activity',    s.activity_score),
      ('nps',         s.nps_score),
      ('engagement',  s.engagement_score),
      ('receivables', s.receivables_score)
    ) as v(input, score)
  ),
  rolled as (
    select p.id,
           sum(w.weight) filter (where p.score is not null) as live_weight,
           sum(w.weight * p.score) filter (where p.score is not null) as weighted_sum,
           count(*) filter (where p.score is not null)::int as inputs_measured
    from parts p join w on w.input = p.input
    group by p.id
  )
  select s.id, s.name, s.status, s.am, s.manual,
         s.leads_recent, s.leads_prior, s.lead_flow_score,
         s.acts_recent, s.acts_prior, s.activity_score,
         s.latest_score, s.previous_score, s.latest_on, s.nps_score,
         s.quoted, s.no_quoted,
         case when s.total > 0 then round(s.with_title::numeric / s.total * 100)::int end,
         s.engagement_score,
         s.open_balance,
         case when s.last_payment is not null then (current_date - s.last_payment)::int end,
         s.receivables_score,
         coalesce(r.inputs_measured, 0),
         case when r.live_weight > 0 then round(r.weighted_sum / r.live_weight)::int end
  from scored s
  left join rolled r on r.id = s.id;
$$;

revoke all on function public.get_client_health() from public, anon;
grant execute on function public.get_client_health() to authenticated, service_role;
