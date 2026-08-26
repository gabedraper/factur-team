-- Let people correct an activity's type when the classifier gets it wrong.
--
-- The classifier is a set of rules over the subject line and the attached
-- Salesforce account, and it is re-run on every row every hour. That means two
-- things for a manual correction: it has to live outside raw_activities, or the
-- next sync overwrites it, and it has to be able to outlive the record it was
-- made on -- a recurring meeting is a NEW Salesforce event every occurrence, so
-- correcting one occurrence would otherwise need redoing every fortnight.
--
-- Hence two shapes of override: one activity, or every activity of this rep
-- with this subject (past and future). The subject rule is scoped to one rep
-- because a correction may only be made by the person whose activity it is.

create table if not exists public.activity_type_overrides (
  id uuid primary key default gen_random_uuid(),
  salesforce_owner_id text not null,
  -- Exactly one of these: activity_id for a single record, subject for a rule.
  activity_id text,
  subject text,
  effort_source text not null references public.effort_weights(effort_source),
  -- What the classifier said before the correction, so the row can be reverted
  -- and so a later look can tell what was actually changed.
  original_effort_source text,
  set_by_rep_id uuid references public.reps(id),
  set_by_email text,
  created_at timestamptz not null default now(),
  constraint activity_type_overrides_one_target
    check ((activity_id is null) <> (subject is null))
);

create unique index if not exists activity_type_overrides_activity_key
  on public.activity_type_overrides (activity_id) where activity_id is not null;
create unique index if not exists activity_type_overrides_subject_key
  on public.activity_type_overrides (salesforce_owner_id, subject) where subject is not null;

alter table public.activity_type_overrides enable row level security;

-- Readable by staff so a correction is never invisible; only the definer
-- functions below write, which is where the "your own activities" rule lives.
drop policy if exists activity_type_overrides_select on public.activity_type_overrides;
create policy activity_type_overrides_select on public.activity_type_overrides
  for select using (public.is_factur_user());

comment on table public.activity_type_overrides is
  'Manual corrections to activity classification. Applied by refresh_raw_activities on every sync, so they survive re-classification.';


-- The activities screen. Everything for one rep in one period, including the
-- internal and no-effort rows the leaderboard blurb hides -- a misclassified
-- meeting is exactly the thing someone comes here to fix, so it has to be
-- visible. Only dedup primaries, so the counts line up with the board.
create or replace function public.get_rep_activities(
  p_rep_id uuid, p_start date, p_end date)
returns jsonb
language sql stable security definer
set search_path = public, pg_catalog
as $$
  select coalesce(jsonb_agg(t order by t.client_name nulls last, t.account_name nulls last,
                            t.effort_source, t.activity_date desc), '[]'::jsonb)
  from (
    select
      ra.id            as activity_id,
      ra.activity_date,
      ra.effort_source,
      ra.subject,
      ra.account_name,
      cl.name          as client_name,
      case
        when ra.activity_type = 'Meeting'
          then 'https://factur.lightning.force.com/lightning/r/Event/' || ra.id || '/view'
        else 'https://factur.lightning.force.com/lightning/r/Task/' || ra.id || '/view'
      end              as sf_link,
      coalesce(oa.original_effort_source, os.original_effort_source) as original_effort_source,
      (oa.id is not null or os.id is not null) as overridden,
      (os.id is not null)                      as overridden_by_subject,
      coalesce(oa.set_by_email, os.set_by_email) as set_by_email
    from public.raw_activities ra
    join public.reps r on r.salesforce_owner_id = ra.salesforce_owner_id
    left join lateral (
      select c.name from public.sf_clients_raw c
      where c.client_account__c = ra.account_id
      limit 1
    ) cl on true
    left join public.activity_type_overrides oa
      on oa.activity_id = ra.id
    left join public.activity_type_overrides os
      on os.subject = ra.subject
     and os.salesforce_owner_id = ra.salesforce_owner_id
     and os.activity_id is null
    where r.id = p_rep_id
      and ra.activity_date >= p_start
      and ra.activity_date <= p_end
      and ra.is_dedup_primary
      and public.is_factur_user()
  ) t;
$$;


-- Record a correction and apply it immediately, so the screen reflects it
-- without waiting for the hourly sync. p_effort_source null clears the
-- correction and puts the classifier's own answer back.
create or replace function public.set_activity_type(
  p_activity_id text,
  p_effort_source text,
  p_apply_to_subject boolean default false)
returns jsonb
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_owner text;
  v_subject text;
  v_caller_rep uuid;
  v_owner_rep uuid;
  v_email text;
  v_computed text;
begin
  if not public.is_factur_user() then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;

  select ra.salesforce_owner_id, ra.subject,
         public.classify_activity_safe(ra.activity_type, ra.account_id, ra.account_name,
                                       ra.comments, ra.email_category, ra.subject)
    into v_owner, v_subject, v_computed
  from public.raw_activities ra
  where ra.id = p_activity_id;

  if v_owner is null then
    raise exception 'That activity no longer exists.' using errcode = 'P0002';
  end if;

  v_email := auth.jwt() ->> 'email';

  select r.id into v_caller_rep from public.reps r where r.auth_user_id = auth.uid();
  if v_caller_rep is null and v_email is not null then
    select r.id into v_caller_rep from public.reps r where lower(r.email) = lower(v_email);
  end if;
  select r.id into v_owner_rep from public.reps r where r.salesforce_owner_id = v_owner;

  if v_caller_rep is null or v_owner_rep is null or v_caller_rep <> v_owner_rep then
    raise exception 'You can only change your own activities.' using errcode = '42501';
  end if;

  if p_effort_source is not null
     and not exists (select 1 from public.effort_weights w where w.effort_source = p_effort_source) then
    raise exception 'Unknown activity type.' using errcode = '22023';
  end if;

  -- A correction on a subject always replaces the per-activity ones underneath
  -- it, so the two kinds can never disagree about the same row.
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

  -- Apply now. Without an index on (salesforce_owner_id, subject) the subject
  -- form is a scan of raw_activities; that is a second or two on a click, and
  -- cheaper than another index for the hourly sync to maintain.
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
end $$;

revoke all on function public.set_activity_type(text, text, boolean) from public;
grant execute on function public.set_activity_type(text, text, boolean) to authenticated;
grant execute on function public.get_rep_activities(uuid, date, date) to authenticated;


-- Re-classification has to stop overwriting corrections. Folding the override
-- into the insert itself, rather than a fix-up pass afterwards, keeps this off
-- the hourly job's critical path -- it is two hash joins against a tiny table,
-- and COALESCE skips the classifier entirely for a row that is overridden.
create or replace function public.refresh_raw_activities()
returns void
language plpgsql
set search_path = public, pg_catalog
as $$
BEGIN
  INSERT INTO public.raw_activities (id, salesforce_owner_id, account_id, account_name, activity_type, email_category, comments, activity_date, effort_source, subject, whoid, synced_at)
  SELECT t.id, t.owner_id, t.account_id, t.account_name,
    public.normalize_task_type(t.type, t.tasksubtype),
    t.email_category__c, t.description, t.activitydate,
    COALESCE(
      ov_id.effort_source,
      ov_subj.effort_source,
      public.classify_activity_safe(public.normalize_task_type(t.type, t.tasksubtype), t.account_id, t.account_name, t.description, t.email_category__c, t.subject)),
    t.subject, t.whoid, now()
  FROM public.sf_tasks_raw t
  LEFT JOIN public.activity_type_overrides ov_id
    ON ov_id.activity_id = t.id
  LEFT JOIN public.activity_type_overrides ov_subj
    ON ov_subj.activity_id IS NULL
   AND ov_subj.salesforce_owner_id = t.owner_id
   AND ov_subj.subject = t.subject
  WHERE t.id IS NOT NULL AND t.activitydate IS NOT NULL
  ON CONFLICT (id) DO UPDATE SET
    salesforce_owner_id = EXCLUDED.salesforce_owner_id, account_id = EXCLUDED.account_id,
    account_name = EXCLUDED.account_name, activity_type = EXCLUDED.activity_type,
    email_category = EXCLUDED.email_category, comments = EXCLUDED.comments,
    activity_date = EXCLUDED.activity_date, effort_source = EXCLUDED.effort_source,
    subject = EXCLUDED.subject, whoid = EXCLUDED.whoid, synced_at = now();

  INSERT INTO public.raw_activities (id, salesforce_owner_id, account_id, account_name, activity_type, email_category, comments, activity_date, effort_source, subject, whoid, synced_at)
  SELECT e.id, e.owner_id, e.account_id, e.account_name, 'Meeting', NULL, e.description, e.activitydate,
    COALESCE(
      ov_id.effort_source,
      ov_subj.effort_source,
      public.classify_activity_safe('Meeting', e.account_id, e.account_name, e.description, NULL, e.subject)),
    e.subject, NULL, now()
  FROM public.sf_events_raw e
  LEFT JOIN public.activity_type_overrides ov_id
    ON ov_id.activity_id = e.id
  LEFT JOIN public.activity_type_overrides ov_subj
    ON ov_subj.activity_id IS NULL
   AND ov_subj.salesforce_owner_id = e.owner_id
   AND ov_subj.subject = e.subject
  WHERE e.id IS NOT NULL AND e.activitydate IS NOT NULL
  ON CONFLICT (id) DO UPDATE SET
    salesforce_owner_id = EXCLUDED.salesforce_owner_id, account_id = EXCLUDED.account_id,
    account_name = EXCLUDED.account_name, activity_type = EXCLUDED.activity_type,
    comments = EXCLUDED.comments, activity_date = EXCLUDED.activity_date,
    effort_source = EXCLUDED.effort_source, subject = EXCLUDED.subject, synced_at = now();

  -- Recompute the dedup flag over the recent rolling window this sync touches;
  -- duplicates only ever land within the same owner/date/subject group.
  UPDATE public.raw_activities ra
  SET is_dedup_primary = sub.is_primary
  FROM (
    SELECT id,
      (ROW_NUMBER() OVER (
         PARTITION BY salesforce_owner_id, activity_date, subject, COALESCE(whoid, id)
         ORDER BY id) = 1) AS is_primary
    FROM public.raw_activities
    WHERE activity_date >= (CURRENT_DATE - INTERVAL '45 days')
  ) sub
  WHERE ra.id = sub.id AND ra.is_dedup_primary IS DISTINCT FROM sub.is_primary;
END;
$$;
