/*
 * Who is due a survey email, and which one.
 *
 * The collections queue's counterpart, and simpler for one reason: arrears are
 * a running condition with no natural start, so collections has to record when
 * an episode began and refresh it on a schedule. An invitation *is* the start.
 * The nps_sends row is the episode, so there is no state table to keep true.
 *
 * A reply ends the ladder, the way a cleared balance ends a chase, and
 * responded_at already records it.
 */
create or replace function public.get_nps_queue()
returns table (
  send_id uuid, client_id uuid, client_name text,
  campaign_id uuid, campaign_name text,
  to_email text, contact_first_name text, token text,
  from_email text, from_name text,
  invited_at timestamptz, days_since_send integer,
  step_id uuid, step_position integer, step_days integer,
  subject text, body text,
  last_sent_at timestamptz, last_step_position integer
)
language sql stable security definer set search_path to 'public'
as $function$
  with allowed as (
    select 1 where public.is_factur_user()
      and (public.has_permission('nps.send') or public.has_permission('org.manage'))
  ),
  open_sends as (
    select s.id as send_id, s.client_id, s.campaign_id, s.recipient_email,
           s.recipient_name, s.token, s.sent_at, s.sender_email,
           case when s.sent_at is null then 0
                else (current_date - s.sent_at::date)::integer end as days_since_send
    from public.nps_sends s
    join public.nps_campaigns c on c.id = s.campaign_id
    where exists (select 1 from allowed)
      and s.responded_at is null
      and s.error is null
      and c.status in ('draft', 'sending', 'sent')
      -- Imported website-form rows are history, not something to chase.
      and c.source = 'app'
  ),
  /*
   * Where several steps have come due at once -- nobody ran this for a
   * fortnight -- the furthest wins, so a client twelve days in gets the last
   * note rather than the first one all over again.
   *
   * An uninvited row is day zero by definition, so only the day-zero step can
   * match it. That is what makes step one the invitation itself rather than
   * something bolted on before the ladder starts.
   */
  due as (
    select o.send_id, st.id as step_id, st.position, st.days_after_send,
           st.subject, st.body,
           row_number() over (
             partition by o.send_id order by st.days_after_send desc, st.position desc
           ) as furthest
    from open_sends o
    join public.nps_steps st
      on st.active and st.days_after_send <= o.days_since_send
    where not exists (
      select 1 from public.nps_sequence_sent ss
      where ss.send_id = o.send_id and ss.step_id = st.id
    )
  ),
  history as (
    select ss.send_id,
           max(ss.sent_at) as last_sent_at,
           (array_agg(ss.step_position order by ss.sent_at desc))[1] as last_step_position
    from public.nps_sequence_sent ss
    group by ss.send_id
  ),
  lead as (
    select oc.id as client_id,
           coalesce(tl.email, amgr.email) as from_email,
           coalesce(tl.full_name, amgr.full_name) as from_name
    from public.org_clients oc
    left join public.org_members am   on am.id   = oc.account_manager_id
    left join public.org_members tl   on tl.id   = oc.team_lead_id
    left join public.org_members amgr on amgr.id = am.manager_member_id
  )
  select o.send_id, o.client_id, c.name, o.campaign_id, cam.name,
         o.recipient_email, o.recipient_name, o.token,
         -- Frozen sender once the invitation has gone, so a mid-ladder change
         -- of lead does not make the reminder arrive from a stranger.
         coalesce(o.sender_email, lead.from_email), lead.from_name,
         o.sent_at, o.days_since_send,
         due.step_id, due.position, due.days_after_send, due.subject, due.body,
         history.last_sent_at, history.last_step_position
  from open_sends o
  join public.org_clients c on c.id = o.client_id
  join public.nps_campaigns cam on cam.id = o.campaign_id
  join due on due.send_id = o.send_id and due.furthest = 1
  left join lead on lead.client_id = o.client_id
  left join history on history.send_id = o.send_id
  -- Nobody to send as means nothing to offer. Better an absent row than one
  -- that silently goes out under somebody else's name.
  where coalesce(o.sender_email, lead.from_email) is not null
  order by due.position desc, c.name;
$function$;

revoke all on function public.get_nps_queue() from public, anon;
grant execute on function public.get_nps_queue() to authenticated, service_role;
