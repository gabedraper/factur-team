/*
 * Two reads for the NPS section.
 *
 * `security_invoker` on both, so they answer as whoever asked and the policies
 * on client_nps and nps_sends still apply. Neither touches sf_clients_raw --
 * Coupler drops that table on every sync and would take a dependent view with
 * it. Everything here is app-owned.
 */

-- Every response, campaign-sent or hand-entered. The left joins are what keep
-- the hand-entered ones visible: they have no send and no campaign, and they
-- are still real answers.
create or replace view public.nps_response_detail
with (security_invoker = true) as
select
  n.id,
  n.client_id,
  oc.name              as client_name,
  n.score,
  n.comment,
  n.follow_up_requested,
  n.collected_on,
  n.respondent,
  s.recipient_email    as respondent_email,
  s.sender_email,
  s.campaign_id,
  c.name               as campaign_name,
  c.source             as campaign_source,
  case
    when n.score >= 9 then 'promoter'
    when n.score >= 7 then 'passive'
    else 'detractor'
  end as band
from public.client_nps n
join public.org_clients oc on oc.id = n.client_id
left join public.nps_sends s on s.id = n.nps_send_id
left join public.nps_campaigns c on c.id = s.campaign_id;

create or replace view public.nps_campaign_summary
with (security_invoker = true) as
select
  c.id,
  c.name,
  c.period,
  c.status,
  c.source,
  c.sent_at,
  count(s.id)                                          as sent,
  count(s.responded_at)                                as responded,
  count(*) filter (where s.error is not null)          as failed,
  count(n.id) filter (where n.score >= 9)              as promoters,
  count(n.id) filter (where n.score between 7 and 8)   as passives,
  count(n.id) filter (where n.score <= 6)              as detractors,
  count(n.id) filter (where n.follow_up_requested)     as follow_ups,
  round(avg(n.score), 1)                               as average_score,
  -- Promoters minus detractors as a percentage of everyone who answered. Null
  -- rather than zero when nobody has: an unanswered campaign has no score, and
  -- showing it as 0 would put it alongside a genuinely middling one.
  case when count(n.id) = 0 then null else
    round(100.0 * (count(n.id) filter (where n.score >= 9)
                 - count(n.id) filter (where n.score <= 6)) / count(n.id))
  end as nps
from public.nps_campaigns c
left join public.nps_sends s on s.campaign_id = c.id
left join public.client_nps n on n.nps_send_id = s.id
group by c.id, c.name, c.period, c.status, c.source, c.sent_at;
