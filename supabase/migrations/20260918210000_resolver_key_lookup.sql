/*
 * The resolver's lookup by vendor id walks the unique index, not the table.
 *
 * Applied an hour after the call-legs change and found the same way: the
 * lookup "this event's id, or any leg of it" was written as one OR against
 * a subquery, which the planner answered with a scan of every row in
 * opp_activities -- fifteen seconds an event, on a job that runs every
 * minute. The same question as two index probes takes under a millisecond.
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
