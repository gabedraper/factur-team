/*
 * An A/R score of 208.
 *
 * Surgically Clean Air owes $8,000 at 31-60 days and holds a $5,500 credit
 * sitting in the 91-and-over column, so their net balance is $2,500. The old
 * sum multiplied that credit by the heaviest weight there is and subtracted a
 * negative, which turned the worst bucket on the report into a bonus: the
 * further past due the credit, the healthier the client looked.
 *
 * Credits now count for nothing rather than counting backwards. The weighting
 * runs over what is actually owed, the share is taken against the same, and the
 * result is held between 0 and 100 -- so a bookkeeping entry nobody has applied
 * yet cannot make a client look better than one who owes nothing at all.
 *
 * Two figures come out alongside it, because "$2,500 owed, all recent" was the
 * other half of the same lie: what they are actually behind on, and what is
 * held in credit against it.
 */
drop function if exists public.get_client_health();

create function public.get_client_health()
returns table (
  client_id uuid, client_name text, status text, account_manager text,
  team_lead text, manual_health text,
  leads_30d bigint, leads_prior_30d bigint, lead_flow_score integer,
  activities_30d bigint, activities_prior_30d bigint, activity_score integer,
  nps_latest smallint, nps_previous smallint, nps_on date, nps_score integer,
  quoted bigint, no_quoted bigint, dm_known integer, engagement_score integer,
  ar_total numeric, ar_owed numeric, ar_credits numeric,
  ar_overdue_60_plus numeric, receivables_score integer,
  inputs_measured integer, overall_score integer
)
language sql stable security definer set search_path to 'public'
as $function$
  with w as (
    select input, weight from client_health_weights where enabled and weight > 0
  ),
  base as (
    select c.id, c.name, c.status, c.salesforce_client_id,
           m.full_name as am, tl.full_name as lead,
           sf.health_score__c as manual, sf.client_account__c as account_id
    from org_clients c
    left join org_members m on m.id = c.account_manager_id
    left join org_members tl on tl.id = c.team_lead_id
    left join sf_clients_raw sf on sf.id = c.salesforce_client_id
    where public.is_factur_user()
      and c.active and coalesce(c.status, '') <> 'Inactive'
  ),
  acts as (
    select account_id,
           count(*) filter (where activity_date >= current_date - 30) as recent,
           count(*) filter (where activity_date >= current_date - 60
                              and activity_date <  current_date - 30) as prior
    from raw_activities
    where activity_date >= current_date - 60 and account_id is not null
    group by account_id
  ),
  leads as (
    select client__c as client_key,
           count(*) filter (where createddate >= now() - interval '30 days') as recent,
           count(*) filter (where createddate >= now() - interval '60 days'
                              and createddate <  now() - interval '30 days') as prior,
           count(*) filter (where stagename ilike '%Quot%'
                              and stagename not ilike '%No Quote%') as quoted,
           count(*) filter (where stagename ilike '%No Quote%') as no_quoted,
           count(*) as total, count(contact_title__c) as with_title
    from sf_opp_leads_raw where client__c is not null group by client__c
  ),
  /*
   * Each bucket floored at nought. A negative bucket is a credit note or an
   * unapplied payment, which is not a debt of negative age.
   */
  ar as (
    select a.*,
           greatest(a.bucket_current, 0)  as owed_current,
           greatest(a.bucket_1_30, 0)     as owed_1_30,
           greatest(a.bucket_31_60, 0)    as owed_31_60,
           greatest(a.bucket_61_90, 0)    as owed_61_90,
           greatest(a.bucket_91_plus, 0)  as owed_91_plus,
           least(a.bucket_current, 0) + least(a.bucket_1_30, 0)
             + least(a.bucket_31_60, 0) + least(a.bucket_61_90, 0)
             + least(a.bucket_91_plus, 0) as credits
    from public.get_client_ar() a
  ),
  scored as (
    select b.*, l.recent leads_recent, l.prior leads_prior, l.quoted, l.no_quoted,
           l.total, l.with_title, a.recent acts_recent, a.prior acts_prior,
           n.latest_score, n.previous_score, n.latest_on,
           ar.total as ar_total,
           (ar.owed_current + ar.owed_1_30 + ar.owed_31_60
            + ar.owed_61_90 + ar.owed_91_plus) as ar_owed,
           -- Reported as a positive number; it is a size, not a direction.
           (-ar.credits) as ar_credits,
           (ar.owed_61_90 + ar.owed_91_plus) as overdue_60_plus,
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
           case
             when ar.total is null then null
             -- Nothing owed, whatever the credits say.
             when (ar.owed_current + ar.owed_1_30 + ar.owed_31_60
                   + ar.owed_61_90 + ar.owed_91_plus) <= 0 then 100
             else least(100, greatest(0, round(100 - (
                    (ar.owed_1_30 * 0.10 + ar.owed_31_60 * 0.35
                   + ar.owed_61_90 * 0.65 + ar.owed_91_plus * 1.00)
                    / (ar.owed_current + ar.owed_1_30 + ar.owed_31_60
                       + ar.owed_61_90 + ar.owed_91_plus) * 100))))::int
           end as receivables_score
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
  select s.id, s.name, s.status, s.am, s.lead, s.manual,
         s.leads_recent, s.leads_prior, s.lead_flow_score,
         s.acts_recent, s.acts_prior, s.activity_score,
         s.latest_score, s.previous_score, s.latest_on, s.nps_score,
         s.quoted, s.no_quoted,
         case when s.total > 0 then round(s.with_title::numeric / s.total * 100)::int end,
         s.engagement_score,
         s.ar_total, s.ar_owed, s.ar_credits, s.overdue_60_plus, s.receivables_score,
         coalesce(r.inputs_measured, 0),
         case when r.live_weight > 0 then round(r.weighted_sum / r.live_weight)::int end
  from scored s left join rolled r on r.id = s.id;
$function$;

revoke all on function public.get_client_health() from public, anon;
grant execute on function public.get_client_health() to authenticated, service_role;
