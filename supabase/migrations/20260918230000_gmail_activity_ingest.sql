/*
 * Every Factur mailbox, both directions, bodies kept.
 *
 * Mixmax was going to be the email source and turned out to need a personal
 * rule per person, with no reply event and a token in a pasted URL. The
 * mailbox itself has everything a person sent or received, whether it went
 * through Mixmax or not, with ids that never change. The Google service
 * account and its domain-wide delegation already read a short list of
 * mailboxes for billing; this reads all of them.
 *
 * gmail_mailboxes is the list and each one's Gmail history cursor.
 * email_messages is the mail, once per Message-ID whichever mailboxes it
 * reached, text body included: the point is to see what was said to a
 * prospect and later to mine it. email_message_copies says which mailbox
 * holds which copy under which Gmail id. From there the email is an
 * activity_events row like a call, and the resolver puts it on the pursuit.
 *
 * Who may read it: the people who may read the activity feed, and anyone
 * their own mail. The bodies are the most sensitive thing this app now holds
 * and the permission is deliberately the same narrow one.
 */

-- ---------------------------------------------------------------------------
-- 1. A lease any scheduled route can hold, so a slow run never stacks.
-- ---------------------------------------------------------------------------

create table if not exists public.job_leases (
  job        text primary key,
  claimed_at timestamptz,
  claimed_by text
);

alter table public.job_leases enable row level security;

create or replace function public.claim_job_lease(p_job text, p_by text default 'cron', p_stale_after interval default interval '15 minutes')
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  got boolean;
begin
  insert into public.job_leases (job) values (p_job) on conflict (job) do nothing;
  update public.job_leases
     set claimed_at = now(), claimed_by = p_by
   where job = p_job
     and (claimed_at is null or claimed_at < now() - p_stale_after)
  returning true into got;
  return coalesce(got, false);
end;
$function$;

create or replace function public.release_job_lease(p_job text)
returns void
language sql
security definer
set search_path to 'public'
as $function$
  update public.job_leases set claimed_at = null, claimed_by = null where job = p_job;
$function$;

revoke all on function public.claim_job_lease(text, text, interval) from public, anon;
revoke all on function public.release_job_lease(text) from public, anon;
grant execute on function public.claim_job_lease(text, text, interval) to service_role;
grant execute on function public.release_job_lease(text) to service_role;

-- ---------------------------------------------------------------------------
-- 2. The mailboxes, the mail, and which mailbox holds which copy.
-- ---------------------------------------------------------------------------

create table if not exists public.gmail_mailboxes (
  email              text primary key,
  member_id          uuid references public.org_members(id) on delete set null,
  enabled            boolean not null default true,
  /* Gmail's history cursor: the next run asks only for what changed after it. */
  history_id         text,
  backfilled_through timestamptz,
  last_synced_at     timestamptz,
  last_run_messages  integer,
  last_error         text,
  created_at         timestamptz not null default now()
);

comment on table public.gmail_mailboxes is
  'Every mailbox the activity ingest reads, with its Gmail history cursor. Disable a row to stop reading that mailbox.';

/* Every active member's mailbox is listed; only one is switched on to begin
   with, so the first real run can be checked before the other sixty-six
   follow. Enabling the rest is one update. */
insert into public.gmail_mailboxes (email, member_id, enabled)
select lower(m.email), m.id, lower(m.email) = 'gabe@bethefactur.com'
  from public.org_members m
 where m.active
   and (lower(m.email) like '%@facturmfg.com' or lower(m.email) like '%@bethefactur.com')
on conflict (email) do nothing;

create table if not exists public.email_messages (
  id               uuid primary key default gen_random_uuid(),
  /* The sender's Message-ID header: the same in every mailbox's copy. */
  rfc822_id        text not null unique,
  subject          text,
  snippet          text,
  body_text        text,
  from_email       text,
  from_name        text,
  to_emails        text[] not null default '{}',
  cc_emails        text[] not null default '{}',
  /* Everyone on it who is not us. */
  external_emails  text[] not null default '{}',
  direction        text not null check (direction in ('inbound', 'outbound', 'internal')),
  /* Whose activity it is: the sender when ours, else the first internal recipient. */
  member_email     text,
  occurred_at      timestamptz not null,
  in_reply_to      text,
  attachment_names text[] not null default '{}',
  labels           text[] not null default '{}',
  first_mailbox    text,
  created_at       timestamptz not null default now()
);

comment on table public.email_messages is
  'Mail with somebody outside the company on it, from every Factur mailbox, text body included. One row per Message-ID.';

create index if not exists email_messages_occurred_idx on public.email_messages (occurred_at desc);
create index if not exists email_messages_member_idx on public.email_messages (member_email, occurred_at desc);
create index if not exists email_messages_from_idx on public.email_messages (from_email);
create index if not exists email_messages_externals_idx on public.email_messages using gin (external_emails);

create table if not exists public.email_message_copies (
  rfc822_id  text not null references public.email_messages(rfc822_id) on delete cascade,
  mailbox    text not null,
  gmail_id   text not null,
  thread_id  text,
  created_at timestamptz not null default now(),
  primary key (mailbox, gmail_id)
);

create index if not exists email_message_copies_rfc_idx on public.email_message_copies (rfc822_id);

alter table public.gmail_mailboxes enable row level security;
alter table public.email_messages enable row level security;
alter table public.email_message_copies enable row level security;

drop policy if exists gmail_mailboxes_read on public.gmail_mailboxes;
create policy gmail_mailboxes_read on public.gmail_mailboxes
  for select to authenticated
  using (public.is_factur_user() and public.has_permission('org.manage'));

drop policy if exists email_messages_read on public.email_messages;
create policy email_messages_read on public.email_messages
  for select to authenticated
  using (
    public.is_factur_user()
    and (
      public.has_permission('org.manage')
      or public.has_permission('clients.activity_feed')
      or member_email in (select lower(email) from public.org_members where auth_user_id = auth.uid())
      or exists (
        select 1 from public.email_message_copies c
         where c.rfc822_id = email_messages.rfc822_id
           and c.mailbox in (select lower(email) from public.org_members where auth_user_id = auth.uid())
      )
    )
  );

drop policy if exists email_message_copies_read on public.email_message_copies;
create policy email_message_copies_read on public.email_message_copies
  for select to authenticated
  using (
    public.is_factur_user()
    and (
      public.has_permission('org.manage')
      or public.has_permission('clients.activity_feed')
      or mailbox in (select lower(email) from public.org_members where auth_user_id = auth.uid())
    )
  );
/* Writes are the ingest route's, on the service key. */

-- ---------------------------------------------------------------------------
-- 3. The resolver reads mail.
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
    /* Orum wraps the call: { event, payload: { v1: {...} }, test, timestamp }.
       The v1 keys, seen 2026-09-18: repEmail, repName, prospectName,
       prospectPhoneNumber, prospectFID (the Salesforce record the list row
       came from -- an opportunity), disposition, calledAt, callDuration in
       seconds, recordingLink, listName, listFID, note, callDirection,
       reasonEnded, entryID, prospectID. Older names are still read. */
    v_event := p ->> 'event';
    if p ? 'payload' and jsonb_typeof(p -> 'payload') = 'object' then p := p -> 'payload'; end if;
    if p ? 'v1' and jsonb_typeof(p -> 'v1') = 'object' then p := p -> 'v1'; end if;
    v_sf := public.jsonb_first(p, 'prospectFID', 'salesforce_id', 'salesforceId', 'sfdc_id', 'crm_id', 'crmId', 'Salesforce Id', 'SFDC ID');
    v_txt := public.jsonb_first(p, 'callDirection', 'direction', 'call_direction', 'call_type', 'callType', 'type');
    v_dir := case
      when lower(coalesce(v_txt, '')) like '%inbound%' then 'inbound'
      when lower(coalesce(public.jsonb_first(p, 'inbound', 'is_inbound', 'isInbound'), '')) = 'true' then 'inbound'
      else 'outbound' end;
    v_txt := public.jsonb_first(p, 'callDuration', 'call_duration', 'duration', 'duration_seconds', 'call_duration_seconds', 'talk_time', 'talkTime');
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
        'calledAt', 'datetime', 'date_time', 'call_datetime', 'callDatetime', 'started_at', 'startedAt', 'call_start',
        'start_time', 'timestamp', 'created_at', 'createdAt', 'date')),
      'user_email', public.jsonb_first(p, 'repEmail', 'user_email', 'userEmail', 'user.email', 'rep_email', 'caller_email',
                                          'agent_email', 'owner_email', 'user'),
      'user_external_id', public.jsonb_first(p, 'repID', 'repId', 'user_id', 'userId', 'user.id'),
      'other_phone', public.phone_last10(public.jsonb_first(p, 'prospectPhoneNumber', 'prospect_phone', 'prospectPhone',
                                          'phone_number', 'phoneNumber', 'phone', 'prospect.phone', 'dialed_number', 'to')),
      'other_phone_raw', public.jsonb_first(p, 'prospectPhoneNumber', 'prospect_phone', 'prospectPhone', 'phone_number',
                                          'phoneNumber', 'phone', 'prospect.phone', 'dialed_number', 'to'),
      'other_email', public.jsonb_first(p, 'prospectEmail', 'prospect_email', 'prospect.email', 'email'),
      'contact_name', public.jsonb_first(p, 'prospectName', 'prospect_name', 'prospect.name', 'name',
                                          'contact_name', 'full_name'),
      'sf_opportunity_id', case when left(v_sf, 3) = '006' then v_sf end,
      'sf_contact_id', case when left(v_sf, 3) = '003' then v_sf
                            else public.jsonb_first(p, 'salesforce_contact_id', 'salesforceContactId', 'sfdc_contact_id',
                                                       'sf_contact_id', 'contact_id', 'contactId', 'Salesforce Contact Id',
                                                       'Contact Id', 'Contact ID') end,
      'outcome', public.jsonb_first(p, 'disposition', 'disposition_name', 'dispositionName', 'call_disposition',
                                       'outcome', 'result'),
      'duration_secs', v_secs,
      'recording_url', public.jsonb_first(p, 'recordingLink', 'recording_url', 'recordingUrl', 'recording',
                                             'call_recording', 'recording.url', 'recording_link'),
      'list_name', public.jsonb_first(p, 'listName', 'list_name', 'list', 'list.name', 'call_list'),
      'body', public.jsonb_first(p, 'note', 'notes', 'call_notes', 'comments'),
      'extra', jsonb_strip_nulls(jsonb_build_object(
        'event', v_event,
        'call_id', public.jsonb_first(p, 'entryID', 'entryId', 'call_id', 'callId', 'id', 'call.id'),
        'prospect_id', public.jsonb_first(p, 'prospectID', 'prospectId'),
        'list_id', public.jsonb_first(p, 'listID', 'listId'),
        'list_salesforce_id', public.jsonb_first(p, 'listFID'),
        'rep_name', public.jsonb_first(p, 'repName'),
        'reason_ended', public.jsonb_first(p, 'reasonEnded'),
        'dial_mode', coalesce(public.jsonb_first(p, 'dialer_mode', 'dial_mode', 'dialMode', 'mode', 'dialer', 'call_mode', 'session_type'),
                              substring(coalesce(public.jsonb_first(p, 'note', 'notes'), '') from '\((power|parallel|inbound)\)')),
        'objections', public.jsonb_first(p, 'objections', 'objection'),
        'recording_type', public.jsonb_first(p, 'recordingType', 'recording_type'),
        'transcript', public.jsonb_first(p, 'transcript', 'call_transcript', 'transcription'),
        'salesforce_record', v_sf))
    );
    f := f || jsonb_build_object('subject',
      format('[Orum] call %s - %s', coalesce(ltrim(f ->> 'other_phone_raw', '+'), '?'), coalesce(f ->> 'outcome', 'Unknown')));

  elsif p_source = 'gmail' then
    /* Landed by lib/ingest/gmail-activity.ts from the mailbox itself. The
       person is the sender when the sender is ours, else the first internal
       recipient; the other party is the sender when inbound, else the first
       outside recipient. Internal mail and Gmail's promotions, social and
       forum categories never get this far. */
    v_dir := p ->> 'direction';
    f := jsonb_build_object(
      'kind', 'email',
      'direction', case when v_dir in ('inbound', 'outbound') then v_dir end,
      'terminal', true,
      'skip_reason', case when v_dir = 'internal' then 'internal mail: nobody outside the company on it' end,
      'occurred_at', public.parse_vendor_time(p ->> 'date'),
      'user_email', public.jsonb_first(p, 'member_email', 'mailbox'),
      'other_email', case when v_dir = 'inbound' then p ->> 'from_email' else p #>> '{external_emails,0}' end,
      'contact_name', case when v_dir = 'inbound' then p ->> 'from_name' end,
      'subject', p ->> 'subject',
      'body', p ->> 'snippet',
      'extra', jsonb_strip_nulls(jsonb_build_object(
        'rfc822_id', p ->> 'rfc822_id',
        'gmail_id', p ->> 'gmail_id',
        'thread_id', p ->> 'thread_id',
        'mailbox', p ->> 'mailbox',
        'in_reply_to', p ->> 'in_reply_to',
        'has_attachments', p ->> 'has_attachments',
        'external_emails', p -> 'external_emails'))
    );

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
  v_legs        text[];
  v_cold        boolean := false;
  v_body        text;
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
    if v_opp is not null then
      rules := rules || '{"opportunity":"salesforce_record"}';
    else
      /* Named, but not here: a cold-call-list opportunity stays in
         Salesforce on purpose (a list row is not a pursuit yet). Say so,
         and the nightly retry brings the call in the day it is promoted. */
      select ("StageName" = 'Prospecting: Cold Call List') into v_cold
        from public."sky_Opportunity" where "Id" = f ->> 'sf_opportunity_id' limit 1;
      v_cold := coalesce(v_cold, false);
    end if;
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

  if v_contact is null and ev.source = 'gmail' then
    /* Mail with somebody who is not a contact -- a vendor, a newsletter, a
       recruiter -- is not a review item. The email itself is still stored. */
    update public.activity_events
       set status = 'skipped', resolved_at = now(), attempts = attempts + 1, member_id = v_member,
           resolution = jsonb_strip_nulls(jsonb_build_object(
             'reason', case when f ->> 'direction' = 'inbound' then 'sender is not a contact' else 'recipient is not a contact' end,
             'member_id', v_member, 'rules', rules, 'facts', f))
     where id = p_id;
    return 'skipped';
  end if;

  if v_contact is null then
    update public.activity_events
       set status = 'needs_review', attempts = attempts + 1, member_id = v_member,
           resolution = jsonb_strip_nulls(jsonb_build_object(
             'reason', case when v_cold then 'cold call list: not a pursuit in the app yet'
                            else coalesce(v_reason, 'no contact matches') end,
             'cold_list', case when v_cold then true end,
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
             'reason', case when v_cold then 'cold call list: not a pursuit in the app yet' else v_reason end,
             'cold_list', case when v_cold then true end,
             'member_id', v_member, 'contact_id', v_contact,
             'client_id', v_client_hint, 'candidates', to_jsonb(v_candidates),
             'rules', rules, 'facts', f))
     where id = p_id;
    return 'needs_review';
  end if;

  /* --- the row -------------------------------------------------------------- */
  /* The body: the vendor's notes or recap, or for mail the stored text. The
     timeline row carries the first part; the full text stays in
     email_messages. */
  v_body := f ->> 'body';
  if ev.source = 'gmail' then
    select coalesce(nullif(left(body_text, 4000), ''), v_body) into v_body
      from public.email_messages where rfc822_id = ev.external_id;
  end if;

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

  /* By the vendor's id -- the event's own first, then any leg of it. Two
     lookups, each a probe of the unique index; an OR against a subquery
     made the planner scan the table. */
  select id into v_row from public.opp_activities
   where external_source = ev.source and external_id = ev.external_id;
  if v_row is null and ev.payload ? 'leg_ids' then
    select array_agg(x) into v_legs from jsonb_array_elements_text(ev.payload -> 'leg_ids') x;
    select id into v_row from public.opp_activities
     where external_source = ev.source and external_id = any(v_legs)
     order by (salesforce_activity_id is not null) desc
     limit 1;
  end if;
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
           body            = coalesce(v_body, a.body),
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
      v_body, f ->> 'direction', f ->> 'outcome',
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
-- 4. Every two minutes.
-- ---------------------------------------------------------------------------

select cron.schedule(
  'gmail-activity-ingest',
  '*/2 * * * *',
  $cron$
  select net.http_post(
    url := 'https://team.facturmfg.com/api/ingest/gmail',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-gaib-secret', (select value from public.gaib_secrets where name = 'deliver')
    ),
    body := '{}'::jsonb
  );
  $cron$
);
