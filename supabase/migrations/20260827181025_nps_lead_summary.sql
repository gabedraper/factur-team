/*
 * The campaign broken down by team lead.
 *
 * Per campaign as well as per lead, so the page can respect its campaign filter
 * and still add the rows up correctly when "all campaigns" is chosen. Counts
 * rather than a stored NPS for exactly that reason: an NPS is a ratio and
 * ratios do not add, so the number is recomputed from promoters and detractors
 * at whatever level it is being shown. Averaging each campaign's NPS would
 * weight a campaign of three the same as one of a hundred.
 *
 * Built from sends rather than from responses, which is what makes a response
 * *rate* possible -- silence is only measurable against a known ask, and
 * whether sending as the team lead actually earns replies is the whole reason
 * that choice was made.
 *
 * The lead is resolved live rather than read from nps_sends.sender_email: the
 * question this answers is "how are this lead's clients feeling", and that
 * should follow a client when it moves to a new lead. sender_email stays on the
 * send for the other question -- who actually pressed send at the time.
 */
create or replace view public.nps_lead_summary
with (security_invoker = true) as
select
  c.id                                   as campaign_id,
  c.name                                 as campaign_name,
  coalesce(tl.full_name, amgr.full_name) as team_lead,
  coalesce(tl.email, amgr.email)         as team_lead_email,
  count(s.id)                                        as sent,
  count(s.responded_at)                              as responded,
  count(n.id) filter (where n.score >= 9)            as promoters,
  count(n.id) filter (where n.score between 7 and 8) as passives,
  count(n.id) filter (where n.score <= 6)            as detractors,
  count(n.id) filter (where n.follow_up_requested)   as follow_ups,
  round(avg(n.score), 1)                             as average_score
from public.nps_sends s
join public.nps_campaigns c on c.id = s.campaign_id
join public.org_clients oc on oc.id = s.client_id
left join public.org_members am   on am.id   = oc.account_manager_id
left join public.org_members tl   on tl.id   = oc.team_lead_id
left join public.org_members amgr on amgr.id = am.manager_member_id
left join public.client_nps n on n.nps_send_id = s.id
group by c.id, c.name,
         coalesce(tl.full_name, amgr.full_name),
         coalesce(tl.email, amgr.email);
