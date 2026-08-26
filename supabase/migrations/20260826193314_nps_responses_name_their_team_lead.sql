/*
 * A response names the team lead who would act on it.
 *
 * Two people are now on each row and they are not the same question:
 * `sender_email` is who it went out as at the time, frozen on the send, while
 * `team_lead` is who leads that client today. They agree on the day a survey
 * goes out and drift apart afterwards -- and it is the second one that answers
 * "so who deals with this?", which is the only reason to look at a detractor.
 *
 * Resolved the same way everywhere else does it: the explicit team_lead_id when
 * set, the account manager's manager otherwise.
 *
 * The new columns are appended rather than slotted in beside sender_email --
 * `create or replace view` refuses to renumber existing columns, and a drop
 * would take the grants with it.
 */
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
  end as band,
  coalesce(tl.full_name, amgr.full_name)  as team_lead,
  coalesce(tl.email, amgr.email)          as team_lead_email
from public.client_nps n
join public.org_clients oc on oc.id = n.client_id
left join public.nps_sends s on s.id = n.nps_send_id
left join public.nps_campaigns c on c.id = s.campaign_id
left join public.org_members am   on am.id   = oc.account_manager_id
left join public.org_members tl   on tl.id   = oc.team_lead_id
left join public.org_members amgr on amgr.id = am.manager_member_id;
