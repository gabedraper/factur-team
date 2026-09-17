/*
 * Activity straight from the tools that make it.
 *
 * Calls and emails reach the app through Salesforce today: Dialpad, Orum and
 * Mixmax each write a Task, the sync mirrors it, the transform turns it into an
 * opp_activities row. Each hop loses something. Orum's Task has no call id,
 * Mixmax's has no message id, a third of Dialpad's calls land without an
 * opportunity, and when a vendor's Salesforce connector stalls the timeline
 * simply goes quiet.
 *
 * This is the other path. Each vendor POSTs its event to the app
 * (app/api/ingest/*), the event lands here exactly as received, and a resolver
 * turns it into the one pipeline row it belongs to -- working out the member
 * from the vendor's user, the contact from the email or phone, the client from
 * the list or sequence name, and the opportunity from the contact.
 *
 * The same call still arrives from Salesforce a few minutes later, so both
 * paths have to recognise each other. opp_activities gains an external key --
 * the vendor's own id -- and the Salesforce transform learns to fill it from
 * the mirror (Dialpad__CallId__c, the Orum recording id) and to attach to an
 * existing direct row rather than insert beside it. Where no id exists (Orum
 * without a recording, every Mixmax email) a fingerprint stands in: same
 * opportunity, same kind, same person, within minutes, and for email the same
 * subject once the logging prefixes are stripped.
 *
 * Whichever path arrives first owns the row. The vendor's fields win on the
 * fields only the vendor knows: exact time, duration, recording, disposition.
 */

-- ---------------------------------------------------------------------------
-- 1. Where every event lands, as received.
-- ---------------------------------------------------------------------------

create table if not exists public.activity_events (
  id              uuid primary key default gen_random_uuid(),
  source          text not null check (source in ('dialpad', 'orum', 'mixmax', 'gmail')),
  /* The vendor's own id for the thing: a call id, a message id. Retries and
     out-of-order delivery collapse onto one row. */
  external_id     text not null,
  /* The vendor's word for what happened: hangup, call-disposition-added,
     message:sent. Kept so the feed can show it and the resolver can skip
     what is not an activity (an email being opened). */
  event_type      text,
  received_at     timestamptz not null default now(),
  payload         jsonb not null default '{}'::jsonb,
  /*
   * waiting      the call is still under way; Dialpad sends one event per
   *              state and only the last one has the duration
   * pending      ready for the resolver
   * resolved     written to (or attached to) an opp_activities row
   * needs_review the resolver could not decide -- no contact, no opportunity,
   *              two contacts on one phone number. Someone picks.
   * skipped      not an activity: a test event, an email being opened
   * failed       the resolver raised; the error is in resolution
   */
  status          text not null default 'pending'
                  check (status in ('waiting', 'pending', 'resolved', 'needs_review', 'skipped', 'failed')),
  attempts        integer not null default 0,
  resolved_at     timestamptz,
  /* What the resolver decided and why: ids, the rule behind each one, and
     for needs_review the candidates it could not choose between. */
  resolution      jsonb not null default '{}'::jsonb,
  member_id       uuid references public.org_members(id) on delete set null,
  opp_activity_id uuid references public.opp_activities(id) on delete set null,
  unique (source, external_id)
);

comment on table public.activity_events is
  'Every call and email event a vendor sent us, as received. The resolver turns each into an opp_activities row; the feed page shows what it decided.';

create index if not exists activity_events_pending_idx
  on public.activity_events (received_at)
  where status = 'pending';
create index if not exists activity_events_feed_idx
  on public.activity_events (received_at desc);
create index if not exists activity_events_status_idx
  on public.activity_events (status, received_at desc);
create index if not exists activity_events_member_idx
  on public.activity_events (member_id, received_at desc);

insert into public.org_permissions (key, name, description, category, position)
values (
  'clients.activity_feed',
  'See the activity feed',
  'Every call and email the tools reported, with what the app made of each. Includes prospect phone numbers and email addresses.',
  'Clients',
  9
)
on conflict (key) do nothing;

alter table public.activity_events enable row level security;

drop policy if exists activity_events_read on public.activity_events;
create policy activity_events_read on public.activity_events
  for select to authenticated
  using (
    public.is_factur_user()
    and (
      public.has_permission('org.manage')
      or public.has_permission('clients.activity_feed')
      or member_id in (select id from public.org_members where auth_user_id = auth.uid())
    )
  );
/* No insert or update policy: the ingest routes and the resolver write on the service key. */

-- ---------------------------------------------------------------------------
-- 2. opp_activities remembers where a row came from.
-- ---------------------------------------------------------------------------

alter table public.opp_activities
  add column if not exists external_source text,
  add column if not exists external_id     text;

comment on column public.opp_activities.external_source is
  'Which tool reported this activity directly (dialpad, orum, mixmax, gmail). Null for rows that only ever came through Salesforce.';
comment on column public.opp_activities.external_id is
  'The tool''s own id for it, so the same call or email is written once however many times and by whichever path it arrives.';

create unique index if not exists opp_activities_external_key
  on public.opp_activities (external_source, external_id)
  where external_source is not null and external_id is not null;

/* A Salesforce row found by the contact it was logged against, for the
   fingerprint match when Salesforce put it on a different opportunity. */
create index if not exists opp_activities_who_occurred_idx
  on public.opp_activities ((metadata ->> 'who_id'), occurred_at)
  where salesforce_activity_id is not null;

/* Direct rows Salesforce has not caught up with yet: what the transform's
   fingerprint match scans. Small, and gets smaller as Salesforce arrives. */
create index if not exists opp_activities_unlinked_external_idx
  on public.opp_activities (opportunity_id, activity_type)
  where external_source is not null and salesforce_activity_id is null;

-- ---------------------------------------------------------------------------
-- 3. Who a vendor's user is.
-- ---------------------------------------------------------------------------

/*
 * org_members carries one email, and the tools do not all use it. Dialpad and
 * Orum identify a person by whichever Google login they signed in with, which
 * is facturmfg.com for most and bethefactur.com for some; Salesforce has a
 * third spelling for a few; Mixmax sends an opaque user id. One table of
 * (kind, value) -> member takes all of them, seeded from what the app already
 * knows and added to by hand or by the resolver when it learns one.
 */
create table if not exists public.member_identities (
  kind       text not null check (kind in ('email', 'salesforce_user', 'dialpad_user', 'orum_user', 'mixmax_user')),
  value      text not null,
  member_id  uuid not null references public.org_members(id) on delete cascade,
  /* seed: rebuilt from org_members, reps and the Salesforce users. learned: the
     resolver saw the vendor id beside a known email. manual: never touched. */
  source     text not null default 'seed' check (source in ('seed', 'learned', 'manual')),
  created_at timestamptz not null default now(),
  primary key (kind, value)
);

comment on table public.member_identities is
  'Every email address and vendor user id that means one of our people. The resolver looks the vendor''s user up here.';

create index if not exists member_identities_member_idx
  on public.member_identities (member_id);

alter table public.member_identities enable row level security;
drop policy if exists member_identities_read on public.member_identities;
create policy member_identities_read on public.member_identities
  for select to authenticated
  using (public.is_factur_user() and public.has_permission('org.manage'));

create or replace function public.refresh_member_identities()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n integer := 0;
  c integer;
begin
  insert into public.member_identities (kind, value, member_id, source)
  select 'email', lower(trim(m.email)), m.id, 'seed'
  from public.org_members m
  where nullif(trim(m.email), '') is not null
  on conflict (kind, value) do nothing;
  get diagnostics c = row_count; n := n + c;

  insert into public.member_identities (kind, value, member_id, source)
  select 'email', lower(trim(r.email)), m.id, 'seed'
  from public.org_members m
  join public.reps r on r.id = m.rep_id
  where nullif(trim(r.email), '') is not null
  on conflict (kind, value) do nothing;
  get diagnostics c = row_count; n := n + c;

  insert into public.member_identities (kind, value, member_id, source)
  select 'salesforce_user', m.salesforce_user_id, m.id, 'seed'
  from public.org_members m
  where nullif(m.salesforce_user_id, '') is not null
  on conflict (kind, value) do nothing;
  get diagnostics c = row_count; n := n + c;

  /* The Salesforce user list is a Coupler table: dropped and recreated on
     every load, and absent until the first one. Ids are compared on their
     15-character form because the two loaders disagree on 15 or 18. */
  if to_regclass('public.sf_users_raw') is not null then
    insert into public.member_identities (kind, value, member_id, source)
    select 'email', lower(trim(v.addr)), m.id, 'seed'
    from public.org_members m
    join public.sf_users_raw u on left(u.id, 15) = left(m.salesforce_user_id, 15)
    cross join lateral (values (u.email), (u.username)) as v(addr)
    where nullif(trim(v.addr), '') like '%@%'
      and lower(v.addr) not like '%.force.com'
    on conflict (kind, value) do nothing;
    get diagnostics c = row_count; n := n + c;
  end if;

  return n;
end;
$function$;

revoke all on function public.refresh_member_identities() from public, anon;
grant execute on function public.refresh_member_identities() to service_role;

select public.refresh_member_identities();

/* The member behind a vendor's user. Email falls back to org_members itself,
   so a person added after the last refresh is still found. */
create or replace function public.member_from_identity(p_kind text, p_value text)
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
    (select member_id from public.member_identities
      where kind = p_kind and value = lower(trim(p_value)) limit 1),
    case when p_kind = 'email' then
      (select id from public.org_members where lower(email) = lower(trim(p_value)) limit 1)
    end
  )
  where nullif(trim(coalesce(p_value, '')), '') is not null;
$function$;

revoke all on function public.member_from_identity(text, text) from public, anon;
grant execute on function public.member_from_identity(text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Finding the contact.
-- ---------------------------------------------------------------------------

/* The last ten digits, however the number was written. */
create or replace function public.phone_last10(p text)
returns text
language sql
immutable
as $function$
  select nullif(right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 10), '');
$function$;

/* Email is near-unique across 550,000 contacts; phone is not -- 474,000 phones
   collapse to 206,000 numbers because company mains are shared. Both need an
   index the resolver can probe; neither had one. */
create index if not exists crm_contacts_email_lower_idx
  on public.crm_contacts (lower(email))
  where email is not null;
create index if not exists crm_contacts_phone10_idx
  on public.crm_contacts (public.phone_last10(phone))
  where phone is not null;

-- ---------------------------------------------------------------------------
-- 5. Reading a vendor's payload.
-- ---------------------------------------------------------------------------

/* The first of several keys that is present and non-empty. A key may be a
   dotted path ("target.email"). Vendors rename fields between versions and
   Orum's are not documented, so every field is read through a list of the
   names it might have. */
create or replace function public.jsonb_first(p jsonb, variadic p_keys text[])
returns text
language plpgsql
immutable
as $function$
declare
  k text;
  v jsonb;
begin
  if p is null then return null; end if;
  foreach k in array p_keys loop
    v := p #> string_to_array(k, '.');
    if v is null or v = 'null'::jsonb then continue; end if;
    if jsonb_typeof(v) = 'string' then
      if nullif(trim(v #>> '{}'), '') is not null then return trim(v #>> '{}'); end if;
    elsif jsonb_typeof(v) in ('number', 'boolean') then
      return v #>> '{}';
    end if;
  end loop;
  return null;
end;
$function$;

/* A timestamp however the vendor wrote it: ISO text, epoch seconds, epoch
   milliseconds. Null rather than an error when it is none of those. */
create or replace function public.parse_vendor_time(p text)
returns timestamptz
language plpgsql
stable
as $function$
declare
  n numeric;
begin
  if nullif(trim(coalesce(p, '')), '') is null then return null; end if;
  if p ~ '^\d+(\.\d+)?$' then
    n := p::numeric;
    if n > 1e11 then return to_timestamp(n / 1000.0); end if;
    return to_timestamp(n);
  end if;
  begin
    return p::timestamptz;
  exception when others then
    return null;
  end;
end;
$function$;

/*
 * The subject as the prospect saw it. Mixmax logs "Sent (Reply) [AD Sept LTFU
 * 2026 (#3)]: Re: Factur + Gbs Corp | worth revisiting?"; the webhook and the
 * mailbox say "Re: Factur + Gbs Corp | worth revisiting?". The fingerprint
 * that matches the two has to see the same string, and so should the
 * timeline. Direction, sequence and stage are kept in columns instead.
 */
create or replace function public.activity_subject_clean(p text)
returns text
language sql
immutable
as $function$
  select nullif(btrim(regexp_replace(regexp_replace(regexp_replace(
    coalesce(p, ''),
    -- the logging prefix: "Sent (Reply) [Seq (#3)]: ", "Received: ", "Replied: "
    '^\s*(sent|received|replied)(\s*\([^)]*\))?(\s*\[[^\]]*\])?\s*:\s*', '', 'gi'),
    -- however many Re:/FW:/Fwd: are stacked in front
    '^(\s*(re|fw|fwd|aw|tr)\s*:\s*)+', '', 'gi'),
    '\s+', ' ', 'g')), '');
$function$;

/* What two subjects are compared on: the cleaned subject, case folded. */
create or replace function public.activity_subject_key(p text)
returns text
language sql
immutable
as $function$
  select lower(public.activity_subject_clean(p));
$function$;

/*
 * One shape for every vendor. Everything below reads facts, not payloads, so
 * a vendor renaming a field is a one-line change here and nowhere else.
 *
 * Returned keys: kind (call|email), direction, occurred_at, user_email,
 * user_external_id, other_phone, other_email, contact_name, sf_contact_id,
 * subject, outcome, duration_secs, recording_url, list_name, sequence_name,
 * stage, body, terminal, skip_reason, extra (a jsonb of the rest worth keeping).
 */
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
begin
  if p_source = 'dialpad' then
    v_state := p ->> 'state';
    v_dir := case when lower(coalesce(p ->> 'direction', '')) = 'inbound' then 'inbound' else 'outbound' end;
    v_secs := case when (p ->> 'duration') ~ '^\d+(\.\d+)?$' then round((p ->> 'duration')::numeric / 1000) end;
    f := jsonb_build_object(
      'kind', 'call',
      'direction', v_dir,
      'terminal', v_state in ('hangup', 'missed', 'voicemail'),
      'occurred_at', public.parse_vendor_time(coalesce(p ->> 'date_started', p ->> 'date_rang', p ->> 'event_timestamp')),
      'user_email', public.jsonb_first(p, 'target.email'),
      'user_external_id', public.jsonb_first(p, 'target.id'),
      'other_phone', public.phone_last10(p ->> 'external_number'),
      'other_phone_raw', p ->> 'external_number',
      'other_email', public.jsonb_first(p, 'contact.email'),
      'contact_name', public.jsonb_first(p, 'contact.name'),
      'duration_secs', v_secs,
      'outcome', case
        when v_state = 'voicemail' then 'Voicemail'
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
        'master_call_id', p ->> 'master_call_id',
        'internal_number', p ->> 'internal_number',
        'date_connected', public.parse_vendor_time(p ->> 'date_connected'),
        'date_ended', public.parse_vendor_time(p ->> 'date_ended'),
        'was_recorded', p ->> 'was_recorded',
        'recap_outcome', p ->> 'recap_outcome',
        'is_transferred', p ->> 'is_transferred'))
    );

  elsif p_source = 'orum' then
    /* Orum wraps the call in an envelope: { event, payload, test }. */
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
-- 6. The resolver.
-- ---------------------------------------------------------------------------

/*
 * One event to one pipeline row.
 *
 * Member from the vendor's user; contact from a Salesforce id, then email, then
 * phone; client from the list or sequence name through client_aliases, else
 * from the opportunity; opportunity from the contact, preferring the one on
 * the hinted client, then the one this person owns, then the open one, then
 * the newest. Where a step has more than one answer and no preference settles
 * it, the event goes to needs_review with the candidates written down, rather
 * than guessing.
 *
 * Then the row: by the vendor id if Salesforce already brought it; by
 * fingerprint against a Salesforce row that has no vendor id; else new.
 */
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
      /* Seen the vendor's id beside a known email: remember it. */
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
     where left(salesforce_contact_id, 15) = left(f ->> 'sf_contact_id', 15) limit 1;
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
      /* The same address on more than one contact: the one with a pursuit wins. */
      select o.contact_id into v_contact
        from public.opportunities o
       where o.contact_id = any(v_candidates) and not coalesce(o.is_duplicate, false)
       order by (v_client_hint is not null and o.client_id = v_client_hint) desc,
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
      /* A shared number. Only a pursuit tells the contacts apart: the one on
         the hinted client, else the one this person owns. Anything weaker is
         a guess, and a guess here puts a call on a stranger's timeline. */
      select o.contact_id into v_contact
        from public.opportunities o
       where o.contact_id = any(v_candidates) and not coalesce(o.is_duplicate, false)
         and ((v_client_hint is not null and o.client_id = v_client_hint)
              or (v_member is not null and o.owner_member_id = v_member))
       order by (v_client_hint is not null and o.client_id = v_client_hint) desc,
                (o.stage not like 'Closed%') desc, o.updated_at desc nulls last
       limit 1;
      if v_contact is not null then
        rules := rules || '{"contact":"phone+opportunity"}';
      else
        v_reason := format('%s contacts share this number', v_n);
      end if;
    end if;
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

  /* --- the opportunity ------------------------------------------------------ */
  select array_agg(id order by rank) into v_candidates from (
    select o.id,
           row_number() over (order by
             (v_client_hint is not null and o.client_id = v_client_hint) desc,
             (v_member is not null and o.owner_member_id = v_member) desc,
             (o.stage not like 'Closed%') desc,
             o.updated_at desc nulls last) as rank,
           (v_client_hint is not null and o.client_id = v_client_hint) as on_client,
           (v_member is not null and o.owner_member_id = v_member) as owned,
           (o.stage not like 'Closed%') as open
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
    /* More than one pursuit of this contact: take the top one only when a
       real preference put it there. */
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

  /* Already here under the vendor's id (Salesforce got there first and the
     transform filled the key)? Then this is the richer copy of the same row. */
  select id into v_row from public.opp_activities
   where external_source = ev.source and external_id = ev.external_id;
  if v_row is not null then
    v_attached := 'external_key';
  else
    /* A Salesforce row for the same thing, with no vendor id to say so. The
       transform sets occurred_at to the Salesforce ActivityDate -- a date,
       so midnight -- and keeps CreatedDate in metadata; the latter is the
       clock to compare against. Salesforce does not always log against the
       opportunity the app would choose, so a row logged against the same
       contact (its WhoId) on any opportunity counts too. */
    v_window := case when v_type = 'email' then interval '60 minutes' else interval '15 minutes' end;
    select a.id into v_row
      from public.opp_activities a
     where a.activity_type = v_type
       and a.external_source is null
       and (a.opportunity_id = v_opp
            or (v_contact_sf is not null and a.metadata ->> 'who_id' = v_contact_sf))
       and a.occurred_at between v_at - interval '2 days' and v_at + interval '1 day'
       and (v_member is null or a.created_by is null or a.created_by = v_member)
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

  /* The opportunity the row is actually on: Salesforce's choice when the
     row was attached to one of its, else the resolver's. */
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

revoke all on function public.resolve_activity_event(uuid) from public, anon;
grant execute on function public.resolve_activity_event(uuid) to service_role;

/* The batch the cron runs. Failed events get five tries, then stay put. */
create or replace function public.resolve_activity_events(p_limit integer default 500)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r      record;
  s      text;
  tally  jsonb := '{}'::jsonb;
begin
  for r in
    select id from public.activity_events
     where status in ('pending', 'failed') and attempts < 5
     order by received_at
     limit p_limit
  loop
    s := public.resolve_activity_event(r.id);
    tally := tally || jsonb_build_object(s, coalesce((tally ->> s)::int, 0) + 1);
  end loop;
  return tally;
end;
$function$;

revoke all on function public.resolve_activity_events(integer) from public, anon;
grant execute on function public.resolve_activity_events(integer) to service_role;

/* Landing an event. Same (source, id) twice merges the payloads -- a Dialpad
   call is several events and the last carries the duration -- and puts the
   row back in front of the resolver only when the vendor says it is done. */
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
  v_member uuid;
begin
  if p_member_email is not null then
    v_member := public.member_from_identity('email', p_member_email);
  end if;

  return query
  insert into public.activity_events as e (source, external_id, event_type, payload, status, member_id)
  values (p_source, p_external_id, p_event_type, coalesce(p_payload, '{}'::jsonb),
          case when p_ready then 'pending' else 'waiting' end, v_member)
  on conflict (source, external_id) do update set
    payload    = e.payload || excluded.payload,
    event_type = coalesce(excluded.event_type, e.event_type),
    member_id  = coalesce(e.member_id, excluded.member_id),
    /* A resolved row stays resolved: a late retry of the same event changes
       nothing. A waiting one becomes pending once the vendor says done. */
    status     = case
                   when e.status in ('resolved', 'skipped') then e.status
                   when p_ready then 'pending'
                   else e.status end
  returning e.id, e.status, (e.xmax = 0);
end;
$function$;

revoke all on function public.land_activity_event(text, text, text, jsonb, boolean, text) from public, anon;
grant execute on function public.land_activity_event(text, text, text, jsonb, boolean, text) to service_role;


/* The feed page's header line: how the last week's events fared. */
create or replace function public.activity_feed_counts(p_since interval default interval '7 days')
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
  from (
    select status, count(*) as n
    from public.activity_events
    where received_at > now() - p_since
    group by status
  ) q;
$function$;

revoke all on function public.activity_feed_counts(interval) from public, anon;
grant execute on function public.activity_feed_counts(interval) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. The Salesforce transform learns about the direct path.
-- ---------------------------------------------------------------------------

/*
 * Same function as before with three additions.
 *
 * The mirror already carries Dialpad's call id and Orum's recording URL on the
 * Task; nothing read them. They become the row's external key, so the same
 * call arriving by webhook is one row however the two paths are ordered.
 *
 * Before inserting, an incoming Task is attached to a direct row that has no
 * Salesforce id yet: by external key, else by fingerprint (same opportunity,
 * kind and person, CreatedDate within minutes of the vendor's time, and for
 * email the same subject once the logging prefix is off).
 *
 * On conflict, a row the vendor reported keeps the vendor's subject, time,
 * outcome and body -- Salesforce's copies of those are the poorer ones -- and
 * metadata is merged rather than replaced, which used to erase anything that
 * was not Salesforce's.
 */
create or replace function public.sync_opp_activities_from_salesforce(
  p_since timestamptz default null
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  written integer;
begin
  create temp table _incoming on commit drop as
  with raw as (
    -- Tasks: calls, emails, to-dos.
    select
      t."Id"                                        as sf_id,
      o.id                                          as opportunity_id,
      lower(coalesce(nullif(t."TaskSubtype", ''), 'task'))            as activity_type,
      nullif(trim(t."Subject"), '')                 as subject,
      nullif(trim(t."Description"), '')             as body,
      lower(nullif(t."CallType", ''))               as direction,
      coalesce(nullif(t."CallDisposition", ''), nullif(t."Status", '')) as outcome,
      coalesce(nullif(t."ActivityDate", '')::timestamptz,
               nullif(t."CreatedDate", '')::timestamptz)              as occurred_at,
      nullif(t."CreatedDate", '')::timestamptz      as created_date,
      m.id                                          as created_by,
      jsonb_strip_nulls(jsonb_build_object(
        'source',            'salesforce_task',
        'salesforce_owner',  nullif(t."OwnerId", ''),
        'created_date',      nullif(t."CreatedDate", ''),
        'status',            nullif(t."Status", ''),
        'priority',          nullif(t."Priority", ''),
        'type',              nullif(t."Type", ''),
        'call_duration_secs', nullif(t."CallDurationInSeconds", ''),
        'who_id',            nullif(t."WhoId", ''),
        'email_type',        nullif(t."Email_Type__c", ''),
        'email_category',    nullif(t."Email_Category__c", ''),
        'sequence_name',     nullif(t."Sequence_Name__c", ''),
        'stage',             nullif(t."Sequence_Number__c", ''),
        'list_name',         nullif(t."Orum_List_Name__c", ''),
        'recording_url',     coalesce(nullif(t."Orum_Call_Recording__c", ''), nullif(t."Dialpad__Call_Recording_URL__c", ''))
      ))                                            as metadata,
      nullif(t."LastModifiedDate", '')::timestamptz  as last_modified,
      nullif(t."WhoId", '')                          as who_id,
      case
        when nullif(t."Dialpad__CallId__c", '') is not null then 'dialpad'
        when nullif(t."Orum_Call_Recording__c", '') is not null then 'orum'
      end                                           as ext_source,
      case
        when nullif(t."Dialpad__CallId__c", '') is not null then trim(t."Dialpad__CallId__c")
        when nullif(t."Orum_Call_Recording__c", '') is not null
          then nullif(regexp_replace(t."Orum_Call_Recording__c", '^.*/', ''), '')
      end                                           as ext_id
    from public."sky_Task" t
    join public.opportunities o on o.salesforce_opportunity_id = t."WhatId"
    left join public.org_members m on m.salesforce_user_id = nullif(t."OwnerId", '')
    where coalesce(nullif(t."IsDeleted", '')::boolean, false) = false
      and (p_since is null or nullif(t."LastModifiedDate", '')::timestamptz > p_since)

    union all

    -- Events: meetings. StartDateTime is the meeting itself, so it wins.
    select
      e."Id",
      o.id,
      'meeting',
      nullif(trim(e."Subject"), ''),
      nullif(trim(e."Description"), ''),
      null,
      null,
      coalesce(nullif(e."StartDateTime", '')::timestamptz,
               nullif(e."ActivityDate", '')::timestamptz,
               nullif(e."CreatedDate", '')::timestamptz),
      nullif(e."CreatedDate", '')::timestamptz,
      m.id,
      jsonb_strip_nulls(jsonb_build_object(
        'source',           'salesforce_event',
        'salesforce_owner', nullif(e."OwnerId", ''),
        'created_date',     nullif(e."CreatedDate", ''),
        'end_time',         nullif(e."EndDateTime", ''),
        'duration_minutes', nullif(e."DurationInMinutes", ''),
        'subtype',          nullif(e."EventSubtype", ''),
        'type',             nullif(e."Type", '')
      )),
      nullif(e."LastModifiedDate", '')::timestamptz,
      null,
      null,
      null
    from public."sky_Event" e
    join public.opportunities o on o.salesforce_opportunity_id = e."WhatId"
    left join public.org_members m on m.salesforce_user_id = nullif(e."OwnerId", '')
    where coalesce(nullif(e."IsDeleted", '')::boolean, false) = false
      and (p_since is null or nullif(e."LastModifiedDate", '')::timestamptz > p_since)
  ),
  latest as (
    select distinct on (sf_id) *
    from raw
    where occurred_at is not null   /* occurred_at is NOT NULL and has no sane default */
    order by sf_id, last_modified desc nulls last
  )
  select l.*,
         /* Salesforce sometimes holds the same call twice (4 Dialpad ids and
            14 Orum recordings so far). Only the first Task per vendor id may
            carry the key; the rest arrive as plain Salesforce rows. */
         row_number() over (partition by ext_source, ext_id order by created_date nulls last, sf_id) as key_rank
  from latest l;

  create index on _incoming (ext_source, ext_id) where ext_source is not null;

  /* Attach by vendor id: a direct row Salesforce had not reached yet. */
  update public.opp_activities a
     set salesforce_activity_id = i.sf_id,
         created_by = coalesce(a.created_by, i.created_by),
         metadata   = a.metadata || i.metadata
    from _incoming i
   where i.ext_source is not null and i.key_rank = 1
     and a.external_source = i.ext_source and a.external_id = i.ext_id
     and a.salesforce_activity_id is null
     and not exists (select 1 from public.opp_activities x where x.salesforce_activity_id = i.sf_id);

  /* Attach by fingerprint: a direct row with no Salesforce id, same pursuit,
     same kind, same person, logged within minutes of when it happened. */
  update public.opp_activities a
     set salesforce_activity_id = i.sf_id,
         created_by = coalesce(a.created_by, i.created_by),
         metadata   = a.metadata || i.metadata
    from (
      select distinct on (i.sf_id) i.sf_id, i.created_by, i.metadata, a.id as row_id
        from _incoming i
        join public.opp_activities a
          on a.activity_type = i.activity_type
         and a.external_source is not null
         and a.salesforce_activity_id is null
         and (a.opportunity_id = i.opportunity_id
              or (i.who_id is not null and exists (
                    select 1 from public.opportunities o
                    join public.crm_contacts c on c.id = o.contact_id
                   where o.id = a.opportunity_id and c.salesforce_contact_id = i.who_id)))
       where i.created_date is not null
         and not exists (select 1 from public.opp_activities x where x.salesforce_activity_id = i.sf_id)
         and (i.created_by is null or a.created_by is null or a.created_by = i.created_by)
         and i.created_date between a.occurred_at - interval '15 minutes'
                                and a.occurred_at + case when i.activity_type = 'email' then interval '70 minutes' else interval '25 minutes' end
         and (i.activity_type <> 'email'
              or public.activity_subject_key(i.subject) = public.activity_subject_key(a.subject))
       order by i.sf_id, (a.opportunity_id = i.opportunity_id) desc,
                abs(extract(epoch from i.created_date - a.occurred_at))
    ) i
   where a.id = i.row_id
     and a.salesforce_activity_id is null;

  with upserted as (
    insert into public.opp_activities (
      salesforce_activity_id, opportunity_id, activity_type,
      subject, body, direction, outcome, occurred_at, created_by, metadata,
      external_source, external_id
    )
    select i.sf_id, i.opportunity_id, i.activity_type,
           i.subject, i.body, i.direction, i.outcome,
           i.occurred_at, i.created_by, i.metadata,
           /* The key travels only where it will not collide with a row that
              already holds it under another Salesforce id. */
           case when i.key_rank = 1 and not exists (
                  select 1 from public.opp_activities x
                   where x.external_source = i.ext_source and x.external_id = i.ext_id
                     and x.salesforce_activity_id is distinct from i.sf_id)
                then i.ext_source end,
           case when i.key_rank = 1 and not exists (
                  select 1 from public.opp_activities x
                   where x.external_source = i.ext_source and x.external_id = i.ext_id
                     and x.salesforce_activity_id is distinct from i.sf_id)
                then i.ext_id end
    from _incoming i
    on conflict (salesforce_activity_id) where salesforce_activity_id is not null
    do update set
      activity_type = excluded.activity_type,
      subject       = case when opp_activities.external_source is not null
                           then opp_activities.subject else excluded.subject end,
      body          = coalesce(case when opp_activities.external_source is not null
                                    then opp_activities.body end, excluded.body, opp_activities.body),
      direction     = coalesce(excluded.direction, opp_activities.direction),
      outcome       = coalesce(case when opp_activities.external_source is not null
                                    then opp_activities.outcome end, excluded.outcome, opp_activities.outcome),
      occurred_at   = case when opp_activities.external_source is not null
                           then opp_activities.occurred_at else excluded.occurred_at end,
      created_by    = coalesce(excluded.created_by, opp_activities.created_by),
      metadata      = opp_activities.metadata || excluded.metadata,
      external_source = coalesce(opp_activities.external_source, excluded.external_source),
      external_id     = coalesce(opp_activities.external_id, excluded.external_id)
    returning 1
  )
  select count(*) into written from upserted;

  drop table if exists _incoming;
  return written;
end;
$function$;

comment on function public.sync_opp_activities_from_salesforce(timestamptz) is
  'Turns the sky_Task and sky_Event mirrors into opp_activities, attaching to rows the vendors reported directly where the two are the same activity. Pass p_since to process only rows Salesforce changed after that time.';

-- ---------------------------------------------------------------------------
-- 8. Runs every minute. The routes also resolve the event they just landed,
--    so this is for what they could not, and for retries.
-- ---------------------------------------------------------------------------

select cron.schedule(
  'resolve-activity-events',
  '* * * * *',
  $cron$
  select public.run_once(
    'resolve-activity-events',
    'select public.resolve_activity_events(500)'
  );
  $cron$
);

/* Identities are seeded from Salesforce users, which the Coupler load
   replaces; refresh after it, daily. */
select cron.schedule(
  'refresh-member-identities',
  '40 13 * * *',
  $cron$ select public.refresh_member_identities(); $cron$
);
