-- Three unrelated corrections that all fell out of the same afternoon.

-- 1. Correcting an activity type is no longer limited to the person whose
-- activity it is. Managers need it for their team, and admins need it for
-- everyone -- a rep who has left cannot fix their own record, and the person
-- most likely to spot a misclassification is the manager reading the board.
--
-- The check runs on the real signed-in identity, deliberately. An admin
-- previewing someone else's view still acts as themselves, and the override
-- records who actually made it.
create or replace function public.can_edit_activities_of(p_owner_sf_id text)
returns boolean
language sql stable security definer
set search_path = public, pg_catalog
as $fn$
  with caller as (
    select r.id, r.salesforce_owner_id
    from public.reps r
    where r.auth_user_id = auth.uid()
       or lower(r.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    limit 1
  ), owner_rep as (
    select r.id, r.manager_rep_id, r.manager_salesforce_id
    from public.reps r
    where r.salesforce_owner_id = p_owner_sf_id
    limit 1
  )
  select public.is_factur_user() and (
    -- your own
    exists (select 1 from caller c join owner_rep o on o.id = c.id)
    -- their manager, by either of the two links the board already trusts
    or exists (
      select 1 from caller c, owner_rep o
      where o.manager_rep_id = c.id
         or o.manager_salesforce_id = c.salesforce_owner_id
    )
    -- an admin
    or exists (
      select 1
      from public.org_members m
      join public.org_assignments a on a.member_id = m.id
      join public.org_role_permissions p on p.role_id = a.role_id
      where p.permission_key = 'org.manage'
        and (m.auth_user_id = auth.uid()
             or lower(m.email) = lower(coalesce(auth.jwt() ->> 'email', '')))
    )
  );
$fn$;

grant execute on function public.can_edit_activities_of(text) to authenticated;


-- 2. The deals board counted opportunities that were never won.
--
-- refresh_deal_activities mirrors the six filters of the "Deals by Month"
-- report, but the report also restricts to won business and this did not --
-- nothing on our side records the opportunity's stage, because the Salesforce
-- sync does not pull StageName at all. Prospecting Lead Status is synced and
-- says the same thing in the sales team's own words: 'Customer' means the deal
-- became a client. Every one of the 190 genuine deals carries it; the three
-- that did not were a Closed Lost, a still-open pipeline row, and a DQ.
create or replace function public.refresh_deal_activities()
returns void
language plpgsql
set search_path = public, pg_catalog
as $fn$
BEGIN
  TRUNCATE public.deal_activities;

  INSERT INTO public.deal_activities (id, salesforce_owner_id, account_id, account_name, client_name, deal_type, event_date, synced_at)
  SELECT
    o.id,
    o.ownerid,
    o.accountid,
    o.account_name,
    o.client__r_name,
    'New Client Deal',
    o.client_start_date__c::date,
    now()
  FROM public.sf_opportunities_raw o
  WHERE o.client_start_date__c IS NOT NULL
    AND o.client_start_date__c::date >= '2025-01-01'
    AND o.ownerid IS NOT NULL
    AND o.prospecting_lead_status__c = 'Customer'
    AND (o.client__r_name IS NULL OR o.client__r_name != 'Factur Contract Renewals')
    AND (o.name IS NULL OR o.name NOT LIKE '%payback%')
    AND o.rg_monthly_revenue__c IS NOT NULL
    AND (o.service__c IS NULL OR (o.service__c NOT LIKE '%RG%' AND o.service__c NOT LIKE '%Outside%'));

  -- New Customer PO: Order.PO_Count__c = '1st' is Salesforce's own first-purchase-order
  -- flag (no dedup needed on our side), credited via the Order's Account_Manager__c
  -- text field. Exact match first, then prefix match to absorb suffix variants
  -- (e.g. "Eli Garcia" vs rep display_name "Eli Garcia II").
  INSERT INTO public.deal_activities (id, salesforce_owner_id, account_id, account_name, client_name, deal_type, event_date, synced_at)
  SELECT
    o.id,
    COALESCE(
      (SELECT r.salesforce_owner_id FROM public.reps r WHERE r.display_name = o.account_manager__c LIMIT 1),
      (SELECT r.salesforce_owner_id FROM public.reps r WHERE r.display_name ILIKE o.account_manager__c || '%' LIMIT 1)
    ),
    o.accountid,
    o.account_name,
    o.client__r_name,
    'New Customer PO',
    o.effectivedate::date,
    now()
  FROM public.sf_orders_raw o
  WHERE o.po_count__c = '1st'
    AND o.accountid IS NOT NULL
    AND o.account_manager__c IS NOT NULL
    AND COALESCE(
      (SELECT r.salesforce_owner_id FROM public.reps r WHERE r.display_name = o.account_manager__c LIMIT 1),
      (SELECT r.salesforce_owner_id FROM public.reps r WHERE r.display_name ILIKE o.account_manager__c || '%' LIMIT 1)
    ) IS NOT NULL;

  INSERT INTO public.deal_activities (id, salesforce_owner_id, account_id, account_name, client_name, deal_type, event_date, synced_at)
  SELECT
    o.id,
    COALESCE(
      o.renewal_credit_owner__c,
      (SELECT r.salesforce_owner_id FROM public.reps r WHERE r.display_name = o.renewal_credit_owner_text__c LIMIT 1)
    ),
    o.accountid,
    o.account_name,
    o.client__r_name,
    CASE o.renewal_outcome__c
      WHEN 'Renewed' THEN 'Renewed Client'
      WHEN 'Churned at Renewal' THEN 'Lost Client'
      WHEN 'Early Termination' THEN 'Early Terminated Client'
    END,
    o.renewal_outcome_date__c::date,
    now()
  FROM public.sf_opportunities_raw o
  WHERE o.renewal_outcome__c IN ('Renewed', 'Churned at Renewal', 'Early Termination')
    AND o.renewal_outcome_date__c IS NOT NULL
    AND o.renewal_outcome_date__c::date >= '2025-01-01'
    AND COALESCE(
      o.renewal_credit_owner__c,
      (SELECT r.salesforce_owner_id FROM public.reps r WHERE r.display_name = o.renewal_credit_owner_text__c LIMIT 1)
    ) IS NOT NULL;

  -- Original salesperson credit: matched via Prospecting_Lead_Status__c = 'Customer'
  -- (the sales team's own signal for "this became a client"), not Client_Start_Date__c.
  -- Skipped when the original salesperson is the same rep as the direct renewal credit
  -- owner above -- otherwise that one person gets counted twice for one renewal event,
  -- instead of the intended "two different teams, two different reps" split credit.
  INSERT INTO public.deal_activities (id, salesforce_owner_id, account_id, account_name, client_name, deal_type, event_date, synced_at)
  SELECT
    o.id || '-orig-sale',
    sale.ownerid,
    o.accountid,
    o.account_name,
    o.client__r_name,
    CASE o.renewal_outcome__c
      WHEN 'Renewed' THEN 'Renewed Client'
      WHEN 'Churned at Renewal' THEN 'Lost Client'
      WHEN 'Early Termination' THEN 'Early Terminated Client'
    END,
    o.renewal_outcome_date__c::date,
    now()
  FROM public.sf_opportunities_raw o
  JOIN LATERAL (
    SELECT s.ownerid
    FROM public.sf_opportunities_raw s
    WHERE s.accountid = o.accountid
      AND s.client__r_name = 'Factur Outsourced Prospecting'
      AND s.prospecting_lead_status__c = 'Customer'
      AND s.ownerid IS NOT NULL
    ORDER BY s.client_start_date__c::date ASC NULLS LAST
    LIMIT 1
  ) sale ON true
  WHERE o.renewal_outcome__c IN ('Renewed', 'Churned at Renewal', 'Early Termination')
    AND o.renewal_outcome_date__c IS NOT NULL
    AND o.renewal_outcome_date__c::date >= '2025-01-01'
    AND sale.ownerid IS DISTINCT FROM COALESCE(
      o.renewal_credit_owner__c,
      (SELECT r.salesforce_owner_id FROM public.reps r WHERE r.display_name = o.renewal_credit_owner_text__c LIMIT 1)
    );
END;
$fn$;


-- 3. The hourly maintenance job had two minutes to finish and was taking about
-- 113 seconds, so it failed roughly once a day. The cap is armed per top-level
-- statement before the function starts, so raising it inside nightly_maintenance
-- would do nothing -- it has to be set on the job's own session, ahead of the
-- call.
--
-- Worth knowing when reading cron.job_run_details for this job: while a run is
-- in flight its return_message shows the SET's tag and its end_time is not set
-- yet, so a mid-run glance looks exactly like "the SET ran and the maintenance
-- did not". It isn't. A completed run reports "1 row".
--
-- This buys headroom, it does not make the job cheaper. The work still grows
-- with activity volume and still wants reducing.
do $do$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where command ilike '%nightly_maintenance%' limit 1;
  if v_jobid is not null then
    perform cron.alter_job(
      v_jobid,
      command => 'SET statement_timeout = ''10min''; SELECT public.nightly_maintenance();');
  end if;
end $do$;


-- set_activity_type defers its authorisation to can_edit_activities_of. The rep
-- lookup stays, but only for attribution now -- an admin acting on someone
-- else's record still gets recorded as the person who changed it.
create or replace function public.set_activity_type(
  p_activity_id text,
  p_effort_source text,
  p_apply_to_subject boolean default false)
returns jsonb
language plpgsql security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_owner text;
  v_subject text;
  v_caller_rep uuid;
  v_email text;
  v_computed text;
begin
  select ra.salesforce_owner_id, ra.subject,
         public.classify_activity_safe(ra.activity_type, ra.account_id, ra.account_name,
                                       ra.comments, ra.email_category, ra.subject)
    into v_owner, v_subject, v_computed
  from public.raw_activities ra
  where ra.id = p_activity_id;

  if v_owner is null then
    raise exception 'That activity no longer exists.' using errcode = 'P0002';
  end if;

  if not public.can_edit_activities_of(v_owner) then
    raise exception 'You can only change your own activities, or your team''s.'
      using errcode = '42501';
  end if;

  v_email := auth.jwt() ->> 'email';
  select r.id into v_caller_rep from public.reps r where r.auth_user_id = auth.uid();
  if v_caller_rep is null and v_email is not null then
    select r.id into v_caller_rep from public.reps r where lower(r.email) = lower(v_email);
  end if;

  if p_effort_source is not null
     and not exists (select 1 from public.effort_weights w where w.effort_source = p_effort_source) then
    raise exception 'Unknown activity type.' using errcode = '22023';
  end if;

  if p_apply_to_subject and v_subject is not null then
    delete from public.activity_type_overrides
      where salesforce_owner_id = v_owner
        and ((subject = v_subject) or (activity_id in (
              select ra.id from public.raw_activities ra
              where ra.salesforce_owner_id = v_owner and ra.subject = v_subject)));
  else
    delete from public.activity_type_overrides where activity_id = p_activity_id;
  end if;

  if p_effort_source is not null then
    insert into public.activity_type_overrides (
      salesforce_owner_id, activity_id, subject, effort_source,
      original_effort_source, set_by_rep_id, set_by_email)
    values (
      v_owner,
      case when p_apply_to_subject and v_subject is not null then null else p_activity_id end,
      case when p_apply_to_subject and v_subject is not null then v_subject else null end,
      p_effort_source,
      v_computed,
      v_caller_rep, v_email);
  end if;

  if p_apply_to_subject and v_subject is not null then
    update public.raw_activities ra
    set effort_source = coalesce(
      p_effort_source,
      public.classify_activity_safe(ra.activity_type, ra.account_id, ra.account_name,
                                    ra.comments, ra.email_category, ra.subject))
    where ra.salesforce_owner_id = v_owner
      and ra.subject = v_subject;
  else
    update public.raw_activities ra
    set effort_source = coalesce(
      p_effort_source,
      public.classify_activity_safe(ra.activity_type, ra.account_id, ra.account_name,
                                    ra.comments, ra.email_category, ra.subject))
    where ra.id = p_activity_id;
  end if;

  return jsonb_build_object('ok', true);
end $fn$;

revoke all on function public.set_activity_type(text, text, boolean) from public;
grant execute on function public.set_activity_type(text, text, boolean) to authenticated;
