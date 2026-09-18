/*
 * A Dialpad call is two events, and the app was treating it as two calls.
 *
 * The first afternoon of real traffic showed it. A call through a coaching
 * team or a department arrives once for the team -- the entry point, no
 * person on it -- and once for the person who took or placed it, each with
 * its own call_id. The person's leg names the team's as entry_point_call_id.
 * The resolver saw two calls: the person's resolved, the team's went to
 * needs review for want of a member, or made a second row on the same
 * opportunity with nobody on it.
 *
 * Salesforce's Dialpad connector logs the call under the entry point's id
 * (33 of 33 today), so that is the id a call is keyed on from here: the
 * route lands both legs on one event, this landing function merges them
 * with the person's leg winning on who it was, and a resolved event is
 * put back in front of the resolver when the person's leg arrives after
 * the team's. The events already received are re-keyed the same way and
 * re-resolved.
 *
 * Two smaller things the payloads showed. A call that reached voicemail
 * says so in voicemail_link whichever state ended it. And a click-to-call
 * from Salesforce carries the opportunity it was placed from, which is a
 * better answer than any phone match, so the resolver takes it first.
 */

-- ---------------------------------------------------------------------------
-- 0. The fingerprint's index, made usable.
-- ---------------------------------------------------------------------------

/*
 * The fingerprint match scans Salesforce rows that carry no vendor key
 * (external_source is null) by opportunity or by the contact they were
 * logged against. The index for the contact branch was partial on
 * salesforce_activity_id being set, a predicate the query does not state,
 * so the planner could not use it and walked the whole date range instead:
 * two seconds per event. Same index, on the predicate the query uses.
 */
drop index if exists public.opp_activities_who_occurred_idx;
create index if not exists opp_activities_who_occurred_idx
  on public.opp_activities ((metadata ->> 'who_id'), occurred_at)
  where external_source is null;
create index if not exists opp_activities_unkeyed_opp_occurred_idx
  on public.opp_activities (opportunity_id, occurred_at)
  where external_source is null;

-- ---------------------------------------------------------------------------
-- 1. Landing merges legs.
-- ---------------------------------------------------------------------------

create or replace function public.land_activity_event(
  p_source       text,
  p_external_id  text,
  p_event_type   text,
  p_payload      jsonb,
  p_ready        boolean default true,
  p_member_email text default null
)
returns table (event_id uuid, event_status text, is_new boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_member  uuid;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
begin
  if p_member_email is not null then
    v_member := public.member_from_identity('email', p_member_email);
  end if;

  /* Every leg's own id, so a row can be found by any of them. */
  if v_payload ? 'call_id' then
    v_payload := v_payload || jsonb_build_object('leg_ids', jsonb_build_array(v_payload ->> 'call_id'));
  end if;

  return query
  insert into public.activity_events as e (source, external_id, event_type, payload, status, member_id)
  values (p_source, p_external_id, p_event_type, v_payload,
          case when p_ready then 'pending' else 'waiting' end, v_member)
  on conflict (source, external_id) do update set
    /* Nulls in the new leg do not erase what the old one knew, and a
       person's target is never replaced by a team's. */
    payload = (
      case
        when coalesce(e.payload -> 'target' ->> 'type', '') = 'user'
         and coalesce(excluded.payload -> 'target' ->> 'type', '') <> 'user'
        then (e.payload || jsonb_strip_nulls(excluded.payload)) || jsonb_build_object('target', e.payload -> 'target')
        else e.payload || jsonb_strip_nulls(excluded.payload)
      end
    ) || jsonb_build_object('leg_ids', (
      select coalesce(jsonb_agg(distinct x), '[]'::jsonb)
      from jsonb_array_elements_text(
        coalesce(e.payload -> 'leg_ids', '[]'::jsonb) || coalesce(excluded.payload -> 'leg_ids', '[]'::jsonb)
      ) x
    )),
    event_type = coalesce(excluded.event_type, e.event_type),
    member_id  = coalesce(e.member_id, excluded.member_id),
    status     = case
                   when e.status = 'skipped' then e.status
                   /* Resolved stays resolved, unless the person's leg has
                      just arrived after the team's: then it is worth a
                      second look, because now there is someone to credit. */
                   when e.status = 'resolved'
                    and not (coalesce(excluded.payload -> 'target' ->> 'type', '') = 'user'
                             and coalesce(e.payload -> 'target' ->> 'type', '') <> 'user')
                     then e.status
                   when p_ready then 'pending'
                   else e.status
                 end,
    attempts   = case when e.status in ('needs_review', 'failed') then 0 else e.attempts end
  returning e.id, e.status, (e.xmax = 0);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Facts: voicemail is voicemail, and click-to-call names the opportunity.
-- ---------------------------------------------------------------------------

create or replace function public.activity_event_facts(p_source text, p_payload jsonb)
returns jsonb
language plpgsql
stable
as $function$
declare
  p          jsonb := p_payload;
  f          jsonb := '{}'::jsonb;
  v_state    text;
  v_dir      text;
  v_event    text;
  v_secs     numeric;
  v_txt      text;
  v_sf       text;
begin
  if p_source = 'dialpad' then
    v_state := p ->> 'state';
    v_dir := case when lower(coalesce(p ->> 'direction', '')) = 'inbound' then 'inbound' else 'outbound' end;
    v_secs := case when (p ->> 'duration') ~ '^\d+(\.\d+)?$' then round((p ->> 'duration')::numeric / 1000) end;
    v_sf := nullif(p #>> '{integrations,salesforce,primary_record_id}', '');
    f := jsonb_build_object(
      'kind', 'call',
      'direction', v_dir,
      'terminal', v_state in ('hangup', 'missed', 'voicemail'),
      'occurred_at', public.parse_vendor_time(coalesce(p ->> 'date_started', p ->> 'date_rang', p ->> 'event_timestamp')),
      /* Only a person's leg says who; a team's has no email. */
      'user_email', case when p -> 'target' ->> 'type' = 'user' then public.jsonb_first(p, 'target.email') end,
      'user_external_id', case when p -> 'target' ->> 'type' = 'user' then public.jsonb_first(p, 'target.id') end,
      'other_phone', public.phone_last10(p ->> 'external_number'),
      'other_phone_raw', p ->> 'external_number',
      'other_email', public.jsonb_first(p, 'contact.email'),
      'contact_name', public.jsonb_first(p, 'contact.name'),
      'sf_opportunity_id', case when left(v_sf, 3) = '006' then v_sf end,
      'sf_contact_id', case when left(v_sf, 3) = '003' then v_sf end,
      'duration_secs', v_secs,
      'outcome', case
        when v_state = 'voicemail' or nullif(p ->> 'voicemail_link', '') is not null then 'Voicemail'
        when v_state = 'missed' then 'Missed'
        when nullif(p ->> 'date_connected', '') is not null then 'Answered'
        when v_dir = 'inbound' then 'Missed'
        else 'No Answer' end,
      'recording_url', coalesce(p #>> '{recording_details,0,url}',
                                case when jsonb_typeof(p -> 'recording_url') = 'array' then p #>> '{recording_url,0}' else p ->> 'recording_url' end,
                                p ->> 'voicemail_link'),
      'body', coalesce(nullif(p ->> 'recap_summary', ''), nullif(p ->> 'transcription_text', '')),
      'subject', format('Dialpad Call - %s%s', initcap(v_dir),
                        case when v_secs is not null and v_secs > 0 then format(' / %s min', greatest(1, round(v_secs / 60))) else '' end),
      'extra', jsonb_strip_nulls(jsonb_build_object(
        'state', v_state,
        'call_id', p ->> 'call_id',
        'entry_point_call_id', p ->> 'entry_point_call_id',
        'leg_ids', p -> 'leg_ids',
        'target_type', p -> 'target' ->> 'type',
        'target_name', p -> 'target' ->> 'name',
        'master_call_id', p ->> 'master_call_id',
        'internal_number', p ->> 'internal_number',
        'date_connected', public.parse_vendor_time(p ->> 'date_connected'),
        'date_ended', public.parse_vendor_time(p ->> 'date_ended'),
        'was_recorded', p ->> 'was_recorded',
        'recap_outcome', p ->> 'recap_outcome',
        'is_transferred', p ->> 'is_transferred',
        'salesforce_record', v_sf))
    );

  elsif p_source = 'orum' then
    v_event := p ->> 'event';
    if p ? 'payload' and jsonb_typeof(p -> 'payload') = 'object' then p := p -> 'payload'; end if;
    v_txt := public.jsonb_first(p, 'direction', 'call_direction', 'call_type', 'callType', 'type');
    v_dir := case
      when lower(coalesce(v_txt, '')) like '%inbound%' then 'inbound'
      when lower(coalesce(public.jsonb_first(p, 'inbound', 'is_inbound', 'isInbound'), '')) = 'true' then 'inbound'
      else 'outbound' end;
    v_txt := public.jsonb_first(p, 'call_duration', 'duration', 'duration_seconds', 'call_duration_seconds', 'talk_time', 'talkTime');
    v_secs := case
      when v_txt ~ '^\d+(\.\d+)?$' then round(v_txt::numeric)
      when v_txt ~ '^\d+:\d{2}$' then split_part(v_txt, ':', 1)::numeric * 60 + split_part(v_txt, ':', 2)::numeric
      end;
    f := jsonb_build_object(
      'kind', 'call',
      'direction', v_dir,
      'terminal', true,
      'skip_reason', case when lower(coalesce(p_payload ->> 'test', '')) = 'true' then 'test event' end,
      'occurred_at', public.parse_vendor_time(public.jsonb_first(p,
        'datetime', 'date_time', 'call_datetime', 'callDatetime', 'started_at', 'startedAt', 'call_start',
        'start_time', 'timestamp', 'created_at', 'createdAt', 'date')),
      'user_email', public.jsonb_first(p, 'user_email', 'userEmail', 'user.email', 'rep_email', 'caller_email',
                                          'agent_email', 'owner_email', 'user'),
      'user_external_id', public.jsonb_first(p, 'user_id', 'userId', 'user.id'),
      'other_phone', public.phone_last10(public.jsonb_first(p, 'prospect_phone', 'prospectPhone', 'phone_number',
                                          'phoneNumber', 'phone', 'prospect.phone', 'dialed_number', 'to')),
      'other_phone_raw', public.jsonb_first(p, 'prospect_phone', 'prospectPhone', 'phone_number', 'phoneNumber',
                                          'phone', 'prospect.phone', 'dialed_number', 'to'),
      'other_email', public.jsonb_first(p, 'prospect_email', 'prospectEmail', 'prospect.email', 'email'),
      'contact_name', public.jsonb_first(p, 'prospect_name', 'prospectName', 'prospect.name', 'name',
                                          'contact_name', 'full_name'),
      'sf_contact_id', public.jsonb_first(p, 'salesforce_contact_id', 'salesforceContactId', 'sfdc_contact_id',
                                          'sf_contact_id', 'salesforce_id', 'salesforceId', 'crm_id', 'crmId',
                                          'contact_id', 'contactId', 'Salesforce Contact Id', 'Salesforce Id',
                                          'Contact Id', 'Contact ID', 'SFDC ID'),
      'outcome', public.jsonb_first(p, 'disposition', 'disposition_name', 'dispositionName', 'call_disposition',
                                       'outcome', 'result'),
      'duration_secs', v_secs,
      'recording_url', public.jsonb_first(p, 'recording_url', 'recordingUrl', 'recording', 'call_recording',
                                             'recording.url', 'recording_link'),
      'list_name', public.jsonb_first(p, 'list_name', 'listName', 'list', 'list.name', 'call_list'),
      'body', public.jsonb_first(p, 'notes', 'note', 'call_notes', 'comments'),
      'extra', jsonb_strip_nulls(jsonb_build_object(
        'event', v_event,
        'call_id', public.jsonb_first(p, 'call_id', 'callId', 'id', 'call.id'),
        'dial_mode', public.jsonb_first(p, 'dialer_mode', 'dial_mode', 'dialMode', 'mode', 'dialer', 'call_mode', 'session_type'),
        'objections', public.jsonb_first(p, 'objections', 'objection'),
        'recording_type', public.jsonb_first(p, 'recording_type', 'recordingType'),
        'transcript', public.jsonb_first(p, 'transcript', 'call_transcript', 'transcription')))
    );
    f := f || jsonb_build_object('subject',
      format('[Orum] call %s - %s', coalesce(ltrim(f ->> 'other_phone_raw', '+'), '?'), coalesce(f ->> 'outcome', 'Unknown')));

  elsif p_source = 'mixmax' then
    v_event := lower(coalesce(public.jsonb_first(p, 'eventName', 'event', 'type', 'name'), ''));
    v_dir := case
      when v_event in ('message:received', 'message:replied', 'replied', 'received') then 'inbound'
      when v_event in ('message:sent', 'sent') then 'outbound'
      end;
    f := jsonb_build_object(
      'kind', 'email',
      'direction', v_dir,
      'terminal', true,
      'skip_reason', case when v_dir is null then 'not an activity: ' || coalesce(nullif(v_event, ''), 'unnamed event') end,
      'occurred_at', public.parse_vendor_time(public.jsonb_first(p, 'timestamp', 'sentAt', 'receivedAt', 'date', 'createdAt')),
      'user_email', public.jsonb_first(p, 'userEmail', 'user_email', 'user.email', 'senderEmail', 'sender.email',
                                          'ownerEmail', 'from.email'),
      'user_external_id', public.jsonb_first(p, 'userId', 'user_id', 'user.id'),
      'other_email', case when v_dir = 'inbound'
        then public.jsonb_first(p, 'fromEmail', 'from_email', 'senderEmail', 'from.email', 'from', 'email', 'recipientEmail')
        else public.jsonb_first(p, 'recipientEmail', 'recipient_email', 'toEmail', 'to.email', 'to', 'email', 'recipient.email') end,
      'contact_name', public.jsonb_first(p, 'name', 'recipientName', 'recipient.name', 'fromName'),
      'subject', public.jsonb_first(p, 'subject', 'message.subject'),
      'sequence_name', public.jsonb_first(p, 'sequenceName', 'sequence_name', 'sequence.name', 'sequence.title'),
      'stage', public.jsonb_first(p, 'stage', 'stageNumber', 'sequenceStage', 'sequence.stage', 'stepNumber'),
      'extra', jsonb_strip_nulls(jsonb_build_object(
        'event', v_event,
        'message_id', public.jsonb_first(p, 'messageId', 'message_id', 'message.id', '_id'),
        'rfc822_id', public.jsonb_first(p, 'rfc822Id', 'rfc822_id', 'rfc822MessageId', 'messageIdHeader'),
        'thread_id', public.jsonb_first(p, 'threadId', 'thread_id'),
        'sequence_id', public.jsonb_first(p, 'sequenceId', 'sequence_id', 'sequence.id')))
    );
  else
    f := jsonb_build_object('skip_reason', 'unknown source ' || coalesce(p_source, '?'));
  end if;

  return jsonb_strip_nulls(f);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. The resolver takes a named opportunity first, and finds a row by any leg.
-- ---------------------------------------------------------------------------

create or replace function public.resolve_activity_event(p_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  ev            public.activity_events%rowtype;
  f             jsonb;
  rules         jsonb := '{}'::jsonb;
  v_member      uuid;
  v_contact     uuid;
  v_account     uuid;
  v_client      uuid;
  v_client_hint uuid;
  v_client_name text;
  v_opp         uuid;
  v_opp_contact uuid;
  v_row         uuid;
  v_type        text;
  v_at          timestamptz;
  v_subject     text;
  v_clean       text;
  v_key         text;
  v_contact_sf  text;
  v_window      interval;
  v_candidates  uuid[];
  v_n           integer;
  v_meta        jsonb;
  v_attached    text;
  v_reason      text;
begin
  select * into ev from public.activity_events where id = p_id for update skip locked;
  if not found then return 'missing'; end if;

  f := public.activity_event_facts(ev.source, ev.payload);

  if f ->> 'skip_reason' is not null then
    update public.activity_events
       set status = 'skipped', resolved_at = now(), attempts = attempts + 1,
           resolution = jsonb_build_object('reason', f ->> 'skip_reason')
     where id = p_id;
    return 'skipped';
  end if;

  if coalesce((f ->> 'terminal')::boolean, true) = false then
    update public.activity_events set status = 'waiting', attempts = attempts + 1 where id = p_id;
    return 'waiting';
  end if;

  v_type := f ->> 'kind';
  v_at := coalesce((f ->> 'occurred_at')::timestamptz, ev.received_at);
  v_subject := f ->> 'subject';
  v_clean := public.activity_subject_clean(v_subject);
  v_key := public.activity_subject_key(v_subject);

  /* --- who did it --------------------------------------------------------- */
  if f ->> 'user_external_id' is not null then
    v_member := public.member_from_identity(ev.source || '_user', f ->> 'user_external_id');
    if v_member is not null then rules := rules || '{"member":"vendor_user_id"}'; end if;
  end if;
  if v_member is null and f ->> 'user_email' is not null then
    v_member := public.member_from_identity('email', f ->> 'user_email');
    if v_member is not null then
      rules := rules || '{"member":"email"}';
      if f ->> 'user_external_id' is not null then
        insert into public.member_identities (kind, value, member_id, source)
        values (ev.source || '_user', lower(trim(f ->> 'user_external_id')), v_member, 'learned')
        on conflict do nothing;
      end if;
    end if;
  end if;
  if v_member is null and ev.member_id is not null then
    v_member := ev.member_id;
    rules := rules || '{"member":"route"}';
  end if;

  /* --- the opportunity the tool itself named ------------------------------- */
  if f ->> 'sf_opportunity_id' is not null then
    select o.id, o.contact_id into v_opp, v_opp_contact
      from public.opportunities o
     where o.salesforce_opportunity_id in (f ->> 'sf_opportunity_id', left(f ->> 'sf_opportunity_id', 15))
       and not coalesce(o.is_duplicate, false)
     limit 1;
    if v_opp is not null then rules := rules || '{"opportunity":"salesforce_record"}'; end if;
  end if;

  /* --- the client the list or sequence was for ----------------------------- */
  v_client_name := public.client_from_text(coalesce(f ->> 'list_name', f ->> 'sequence_name'), null);
  if v_client_name is not null then
    select id into v_client_hint from public.org_clients
     where lower(name) = lower(v_client_name)
     order by (status = 'Current') desc nulls last, created_at desc limit 1;
    if v_client_hint is null then
      select oc.id into v_client_hint
        from public.client_roster cr
        join public.org_clients oc on oc.salesforce_client_id = cr.salesforce_client_id
       where lower(cr.name) = lower(v_client_name) limit 1;
    end if;
    if v_client_hint is not null then rules := rules || '{"client_hint":"list_name"}'; end if;
  end if;

  /* --- the contact ---------------------------------------------------------- */
  if f ->> 'sf_contact_id' is not null then
    select id into v_contact from public.crm_contacts
     where salesforce_contact_id in (f ->> 'sf_contact_id', left(f ->> 'sf_contact_id', 15)) limit 1;
    if v_contact is not null then rules := rules || '{"contact":"salesforce_id"}'; end if;
  end if;

  if v_contact is null and f ->> 'other_email' is not null then
    select array_agg(id) into v_candidates from (
      select id from public.crm_contacts
       where lower(email) = lower(f ->> 'other_email')
       order by updated_at desc limit 5) q;
    v_n := coalesce(array_length(v_candidates, 1), 0);
    if v_n = 1 then
      v_contact := v_candidates[1];
      rules := rules || '{"contact":"email"}';
    elsif v_n > 1 then
      select o.contact_id into v_contact
        from public.opportunities o
       where o.contact_id = any(v_candidates) and not coalesce(o.is_duplicate, false)
       order by (v_opp is not null and o.id = v_opp) desc,
                (v_client_hint is not null and o.client_id = v_client_hint) desc,
                (v_member is not null and o.owner_member_id = v_member) desc,
                (o.stage not like 'Closed%') desc, o.updated_at desc nulls last
       limit 1;
      if v_contact is not null then rules := rules || '{"contact":"email+opportunity"}'; end if;
    end if;
  end if;

  if v_contact is null and f ->> 'other_phone' is not null then
    select array_agg(id) into v_candidates from (
      select id from public.crm_contacts
       where public.phone_last10(phone) = f ->> 'other_phone'
       order by updated_at desc limit 50) q;
    v_n := coalesce(array_length(v_candidates, 1), 0);
    if v_n = 1 then
      v_contact := v_candidates[1];
      rules := rules || '{"contact":"phone"}';
    elsif v_n > 1 then
      select o.contact_id into v_contact
        from public.opportunities o
       where o.contact_id = any(v_candidates) and not coalesce(o.is_duplicate, false)
         and ((v_opp is not null and o.id = v_opp)
              or (v_client_hint is not null and o.client_id = v_client_hint)
              or (v_member is not null and o.owner_member_id = v_member))
       order by (v_opp is not null and o.id = v_opp) desc,
                (v_client_hint is not null and o.client_id = v_client_hint) desc,
                (o.stage not like 'Closed%') desc, o.updated_at desc nulls last
       limit 1;
      if v_contact is not null then
        rules := rules || '{"contact":"phone+opportunity"}';
      else
        v_reason := format('%s contacts share this number', v_n);
      end if;
    end if;
  end if;

  /* The tool named the opportunity; its contact is the contact. */
  if v_contact is null and v_opp_contact is not null then
    v_contact := v_opp_contact;
    rules := rules || '{"contact":"salesforce_record"}';
    v_reason := null;
  end if;

  if v_contact is null then
    update public.activity_events
       set status = 'needs_review', attempts = attempts + 1, member_id = v_member,
           resolution = jsonb_strip_nulls(jsonb_build_object(
             'reason', coalesce(v_reason, 'no contact matches'),
             'member_id', v_member, 'client_id', v_client_hint,
             'candidates', to_jsonb(v_candidates), 'rules', rules, 'facts', f))
     where id = p_id;
    return 'needs_review';
  end if;

  select account_id, salesforce_contact_id into v_account, v_contact_sf
    from public.crm_contacts where id = v_contact;

  /* --- the opportunity, when the tool did not name one ---------------------- */
  if v_opp is null then
    select array_agg(id order by rank) into v_candidates from (
      select o.id,
             row_number() over (order by
               (v_client_hint is not null and o.client_id = v_client_hint) desc,
               (v_member is not null and o.owner_member_id = v_member) desc,
               (o.stage not like 'Closed%') desc,
               o.updated_at desc nulls last) as rank
        from public.opportunities o
       where o.contact_id = v_contact and not coalesce(o.is_duplicate, false)
    ) q;
    v_n := coalesce(array_length(v_candidates, 1), 0);

    if v_n = 0 then
      v_reason := 'contact has no opportunity';
    elsif v_n = 1 then
      v_opp := v_candidates[1];
      rules := rules || '{"opportunity":"only"}';
    else
      select o.id,
             case when v_client_hint is not null and o.client_id = v_client_hint then 'client'
                  when v_member is not null and o.owner_member_id = v_member then 'owner'
                  when o.stage not like 'Closed%'
                       and (select count(*) from public.opportunities x
                             where x.contact_id = v_contact and not coalesce(x.is_duplicate, false)
                               and x.stage not like 'Closed%') = 1 then 'only_open'
                  end
        into v_opp, v_reason
        from public.opportunities o where o.id = v_candidates[1];
      if v_reason is null then
        v_opp := null;
        v_reason := format('%s opportunities for this contact', v_n);
      else
        rules := rules || jsonb_build_object('opportunity', v_reason);
        v_reason := null;
      end if;
    end if;
  end if;

  if v_opp is null then
    update public.activity_events
       set status = 'needs_review', attempts = attempts + 1, member_id = v_member,
           resolution = jsonb_strip_nulls(jsonb_build_object(
             'reason', v_reason, 'member_id', v_member, 'contact_id', v_contact,
             'client_id', v_client_hint, 'candidates', to_jsonb(v_candidates),
             'rules', rules, 'facts', f))
     where id = p_id;
    return 'needs_review';
  end if;

  /* --- the row -------------------------------------------------------------- */
  v_meta := jsonb_strip_nulls(jsonb_build_object(
    'source', ev.source,
    'event_id', ev.id,
    'occurred_at_vendor', f ->> 'occurred_at',
    'call_duration_secs', f ->> 'duration_secs',
    'recording_url', f ->> 'recording_url',
    'list_name', f ->> 'list_name',
    'sequence_name', f ->> 'sequence_name',
    'stage', f ->> 'stage',
    'contact_name', f ->> 'contact_name',
    'other_phone', f ->> 'other_phone_raw',
    'other_email', f ->> 'other_email',
    'subject_raw', v_subject
  )) || coalesce(f -> 'extra', '{}'::jsonb);

  /* By the vendor's id -- the event's own, or any leg of it. */
  select id into v_row from public.opp_activities
   where external_source = ev.source
     and (external_id = ev.external_id
          or (ev.payload ? 'leg_ids' and external_id in (select jsonb_array_elements_text(ev.payload -> 'leg_ids'))))
   order by (external_id = ev.external_id) desc, (salesforce_activity_id is not null) desc
   limit 1;
  if v_row is not null then
    v_attached := 'external_key';
  else
    v_window := case when v_type = 'email' then interval '60 minutes' else interval '15 minutes' end;
    /* Two equality lookups rather than one OR: each walks its own partial
       index; the OR made the planner scan the whole date range. */
    select a.id into v_row
      from (
        select x.id from public.opp_activities x
         where x.external_source is null and x.activity_type = v_type and x.opportunity_id = v_opp
        union all
        select x.id from public.opp_activities x
         where v_contact_sf is not null and x.external_source is null and x.activity_type = v_type
           and x.metadata ->> 'who_id' = v_contact_sf and x.opportunity_id <> v_opp
      ) q
      join public.opp_activities a on a.id = q.id
     where (v_member is null or a.created_by is null or a.created_by = v_member)
       and coalesce((a.metadata ->> 'created_date')::timestamptz, a.occurred_at)
           between v_at - v_window and v_at + v_window + interval '10 minutes'
       and (v_type <> 'email' or v_key is null or public.activity_subject_key(a.subject) = v_key)
     order by (a.opportunity_id = v_opp) desc,
              abs(extract(epoch from coalesce((a.metadata ->> 'created_date')::timestamptz, a.occurred_at) - v_at))
     limit 1;
    if v_row is not null then v_attached := 'fingerprint'; end if;
  end if;

  if v_row is not null then
    update public.opp_activities a
       set external_source = ev.source,
           external_id     = ev.external_id,
           occurred_at     = v_at,
           subject         = coalesce(case when v_type = 'email' then nullif(v_clean, '') end, v_subject, a.subject),
           direction       = coalesce(f ->> 'direction', a.direction),
           outcome         = coalesce(f ->> 'outcome', a.outcome),
           body            = coalesce(f ->> 'body', a.body),
           created_by      = coalesce(a.created_by, v_member),
           metadata        = a.metadata || v_meta
     where a.id = v_row;
  else
    insert into public.opp_activities (
      opportunity_id, activity_type, subject, body, direction, outcome,
      occurred_at, created_by, metadata, external_source, external_id)
    values (
      v_opp, v_type,
      coalesce(case when v_type = 'email' then nullif(v_clean, '') end, v_subject),
      f ->> 'body', f ->> 'direction', f ->> 'outcome',
      v_at, v_member, v_meta, ev.source, ev.external_id)
    returning id into v_row;
    v_attached := 'new';
  end if;

  select a.opportunity_id, o.client_id into v_opp, v_client
    from public.opp_activities a join public.opportunities o on o.id = a.opportunity_id
   where a.id = v_row;

  update public.activity_events
     set status = 'resolved', resolved_at = now(), attempts = attempts + 1,
         member_id = v_member, opp_activity_id = v_row,
         resolution = jsonb_strip_nulls(jsonb_build_object(
           'member_id', v_member, 'contact_id', v_contact, 'account_id', v_account,
           'client_id', v_client, 'opportunity_id', v_opp, 'row', v_attached,
           'rules', rules, 'facts', f))
   where id = p_id;
  return 'resolved';

exception when others then
  update public.activity_events
     set status = 'failed', attempts = attempts + 1,
         resolution = jsonb_build_object('error', sqlerrm, 'state', sqlstate, 'rules', rules)
   where id = p_id;
  return 'failed';
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. What already arrived is re-keyed the same way and re-resolved.
-- ---------------------------------------------------------------------------

do $$
declare
  leg record;
  v_canon public.activity_events%rowtype;
  v_canon_row uuid;
  v_leg_row uuid;
begin
  for leg in
    select u.*
      from public.activity_events u
     where u.source = 'dialpad'
       and nullif(u.payload ->> 'entry_point_call_id', '') is not null
       and u.external_id <> u.payload ->> 'entry_point_call_id'
     order by u.received_at
  loop
    select * into v_canon from public.activity_events
     where source = 'dialpad' and external_id = leg.payload ->> 'entry_point_call_id';

    select id into v_leg_row from public.opp_activities
     where external_source = 'dialpad' and external_id = leg.external_id;

    if v_canon.id is null then
      /* No team leg received: the person's event simply takes the canonical id. */
      update public.activity_events
         set external_id = leg.payload ->> 'entry_point_call_id',
             payload = leg.payload || jsonb_build_object('leg_ids', jsonb_build_array(leg.external_id, leg.payload ->> 'entry_point_call_id'))
       where id = leg.id;
      if v_leg_row is not null then
        update public.opp_activities set external_id = leg.payload ->> 'entry_point_call_id' where id = v_leg_row;
      end if;
    else
      /* Both legs here: fold the person's into the team's. */
      select id into v_canon_row from public.opp_activities
       where external_source = 'dialpad' and external_id = v_canon.external_id;

      update public.activity_events
         set payload = (v_canon.payload || jsonb_strip_nulls(leg.payload))
                       || case when leg.payload -> 'target' ->> 'type' = 'user'
                               then jsonb_build_object('target', leg.payload -> 'target') else '{}'::jsonb end
                       || jsonb_build_object('leg_ids', jsonb_build_array(v_canon.external_id, leg.external_id)),
             member_id = coalesce(v_canon.member_id, leg.member_id),
             status = case when v_canon.status = 'skipped' then 'skipped' else 'pending' end,
             attempts = 0
       where id = v_canon.id;

      if v_leg_row is not null and v_canon_row is not null and v_leg_row <> v_canon_row then
        /* Two rows for one call: keep the team's (Salesforce will key on it),
           credit it to the person, drop the other. */
        update public.opp_activities c
           set created_by = coalesce(c.created_by, l.created_by),
               body = coalesce(c.body, l.body),
               metadata = c.metadata || l.metadata
          from public.opp_activities l
         where c.id = v_canon_row and l.id = v_leg_row;
        update public.activity_events set opp_activity_id = v_canon_row where opp_activity_id = v_leg_row;
        delete from public.opp_activities where id = v_leg_row;
      elsif v_leg_row is not null and v_canon_row is null then
        update public.opp_activities set external_id = v_canon.external_id where id = v_leg_row;
      end if;

      delete from public.activity_events where id = leg.id;
    end if;
  end loop;

  /* Everything Dialpad sent goes past the resolver again with the new facts. */
  update public.activity_events
     set status = 'pending', attempts = 0
   where source = 'dialpad' and status in ('resolved', 'needs_review', 'failed');
end $$;
