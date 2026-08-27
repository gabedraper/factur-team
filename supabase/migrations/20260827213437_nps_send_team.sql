/*
 * Who was on the account when the survey went out.
 *
 * nps_sends already freezes sender_email for this reason; this does the same
 * for the rest of the team. A score then stays attributable to the people who
 * actually earned it: when Tony Haight's clients moved to Noah Rodman, the live
 * lead breakdown moved Tony's history with them -- right for "whose problem is
 * it now", wrong for "who did this".
 *
 * A child table rather than a jsonb blob, because the whole point is grouping
 * by it -- NPS by account manager, by SDR, by data analyst -- and that should
 * be a join rather than json extraction in every query.
 */
create table if not exists public.nps_send_team (
  send_id uuid not null references public.nps_sends(id) on delete cascade,
  field text not null,
  member_id uuid not null references public.org_members(id) on delete cascade,
  primary key (send_id, field)
);

create index if not exists nps_send_team_member_idx on public.nps_send_team (member_id);

alter table public.nps_send_team enable row level security;

drop policy if exists nps_send_team_read on public.nps_send_team;
create policy nps_send_team_read on public.nps_send_team
  for select to authenticated using (public.is_factur_user());

/*
 * Stamp the team onto a campaign's invitations. Re-runnable, and it never
 * restates one already stamped: a team is fixed when the invitation is created,
 * and a later run must not quietly replace it with today's team.
 *
 * Two inserts, because they answer slightly different questions. The first
 * copies the roles as they sit on the client. The second records the *resolved*
 * team lead, which is a coalesce across two columns -- the explicit lead, or
 * the account manager's manager -- and so cannot come from a column copy.
 */
create or replace function public.freeze_nps_send_team(p_campaign_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_rows integer;
begin
  insert into public.nps_send_team (send_id, field, member_id)
  select s.id, r.field, r.member_id
  from public.nps_sends s
  join public.client_role_now r on r.client_id = s.client_id
  where s.campaign_id = p_campaign_id
    and r.member_id is not null
  on conflict (send_id, field) do nothing;

  insert into public.nps_send_team (send_id, field, member_id)
  select s.id, 'resolved_team_lead', coalesce(oc.team_lead_id, am.manager_member_id)
  from public.nps_sends s
  join public.org_clients oc on oc.id = s.client_id
  left join public.org_members am on am.id = oc.account_manager_id
  where s.campaign_id = p_campaign_id
    and coalesce(oc.team_lead_id, am.manager_member_id) is not null
  on conflict (send_id, field) do nothing;

  select count(*) into v_rows
  from public.nps_send_team t
  join public.nps_sends s on s.id = t.send_id
  where s.campaign_id = p_campaign_id;

  return v_rows;
end;
$$;

revoke all on function public.freeze_nps_send_team(uuid) from public, anon;
grant execute on function public.freeze_nps_send_team(uuid) to authenticated, service_role;

/*
 * NPS attributed to the people who were on the account at the time.
 *
 * The counterpart to nps_lead_summary, which resolves the lead live. That one
 * answers "how are this lead's clients feeling now"; this answers "how did the
 * people who did the work score". The two legitimately disagree the moment
 * anybody changes team, and both are worth having.
 */
create or replace view public.nps_by_person
with (security_invoker = true) as
select
  t.field,
  m.id                                     as member_id,
  m.full_name                              as member_name,
  c.id                                     as campaign_id,
  c.name                                   as campaign_name,
  c.period,
  count(s.id)                                        as sent,
  count(s.responded_at)                              as responded,
  count(n.id) filter (where n.score >= 9)            as promoters,
  count(n.id) filter (where n.score between 7 and 8) as passives,
  count(n.id) filter (where n.score <= 6)            as detractors,
  count(n.id) filter (where n.follow_up_requested)   as follow_ups,
  round(avg(n.score), 1)                             as average_score
from public.nps_send_team t
join public.nps_sends s on s.id = t.send_id
join public.nps_campaigns c on c.id = s.campaign_id
join public.org_members m on m.id = t.member_id
left join public.client_nps n on n.nps_send_id = s.id
group by t.field, m.id, m.full_name, c.id, c.name, c.period;
