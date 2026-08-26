-- Make the hourly sync do work proportional to what actually changed.
--
-- It used to rewrite everything, every hour. Both halves were unconditional:
-- all ~34,000 staged rows were re-classified and upserted (44s), and the dedup
-- flag was recomputed by sorting 45 days of activity, 191,000 rows, in one
-- window function (55s). Measured on a normal afternoon, every single one of
-- the 32,924 staged rows was byte-identical to the row already stored. The job
-- was spending ~99 seconds to change nothing, against a cap it kept hitting.
--
-- Now: compare each staged row against what is stored and carry forward only
-- the ones that differ, then recompute the dedup flag only for the owner/date
-- groups those rows disturbed -- including the group a row left behind when its
-- owner or date moved, which is why the old keys are collected too.
--
-- Measured on the same data: 99s -> 45s, with a byte-identical result (checked
-- by hashing id, effort_source and is_dedup_primary across all 293,000 rows
-- before and after). Verified separately that an edited row is reclassified, a
-- new row is inserted and gets its dedup flag, and a manual type correction
-- survives a re-sync of its own row.
--
-- What remains: about 21 seconds of the 45 is the comparison scan itself --
-- 33,000 primary key lookups into a wide table. Worth revisiting if the job
-- creeps back up; it is no longer the dominant cost.

create or replace function public.refresh_raw_activities()
returns void
language plpgsql
set search_path = public, pg_catalog
as $fn$
BEGIN
  drop table if exists _diff_rows;
  create temp table _diff_rows on commit drop as
  select s.id, s.owner_id, s.account_id, s.account_name, s.activity_type,
         s.email_category, s.description, s.activity_date, s.subject, s.whoid,
         ra.salesforce_owner_id as old_owner, ra.activity_date as old_date
  from (
    select t.id, t.owner_id, t.account_id, t.account_name,
           public.normalize_task_type(t.type, t.tasksubtype) as activity_type,
           t.email_category__c as email_category, t.description,
           t.activitydate::date as activity_date, t.subject, t.whoid
    from public.sf_tasks_raw t
    where t.id is not null and t.activitydate is not null
    union all
    select e.id, e.owner_id, e.account_id, e.account_name, 'Meeting',
           null, e.description, e.activitydate::date, e.subject, null
    from public.sf_events_raw e
    where e.id is not null and e.activitydate is not null
  ) s
  left join public.raw_activities ra on ra.id = s.id
  where ra.id is null
     or ra.salesforce_owner_id is distinct from s.owner_id
     or ra.account_id          is distinct from s.account_id
     or ra.account_name        is distinct from s.account_name
     or ra.activity_type       is distinct from s.activity_type
     or ra.email_category      is distinct from s.email_category
     or ra.comments            is distinct from s.description
     or ra.activity_date       is distinct from s.activity_date
     or ra.subject             is distinct from s.subject
     or ra.whoid               is distinct from s.whoid;

  INSERT INTO public.raw_activities (id, salesforce_owner_id, account_id, account_name,
    activity_type, email_category, comments, activity_date, effort_source, subject, whoid, synced_at)
  SELECT d.id, d.owner_id, d.account_id, d.account_name, d.activity_type, d.email_category,
    d.description, d.activity_date,
    COALESCE(ov_id.effort_source, ov_subj.effort_source,
      public.classify_activity_safe(d.activity_type, d.account_id, d.account_name,
                                    d.description, d.email_category, d.subject)),
    d.subject, d.whoid, now()
  FROM _diff_rows d
  LEFT JOIN public.activity_type_overrides ov_id ON ov_id.activity_id = d.id
  LEFT JOIN public.activity_type_overrides ov_subj
    ON ov_subj.activity_id IS NULL
   AND ov_subj.salesforce_owner_id = d.owner_id
   AND ov_subj.subject = d.subject
  ON CONFLICT (id) DO UPDATE SET
    salesforce_owner_id = EXCLUDED.salesforce_owner_id, account_id = EXCLUDED.account_id,
    account_name = EXCLUDED.account_name, activity_type = EXCLUDED.activity_type,
    email_category = EXCLUDED.email_category, comments = EXCLUDED.comments,
    activity_date = EXCLUDED.activity_date, effort_source = EXCLUDED.effort_source,
    subject = EXCLUDED.subject, whoid = EXCLUDED.whoid, synced_at = now();

  -- Only the owner/date groups this run disturbed, including the one a moved
  -- row left behind.
  drop table if exists _touched_keys;
  create temp table _touched_keys on commit drop as
  select distinct owner_id as salesforce_owner_id, activity_date from _diff_rows
  union
  select distinct old_owner, old_date from _diff_rows where old_owner is not null;

  UPDATE public.raw_activities ra
  SET is_dedup_primary = sub.is_primary
  FROM (
    SELECT r2.id,
      (ROW_NUMBER() OVER (
         PARTITION BY r2.salesforce_owner_id, r2.activity_date, r2.subject, COALESCE(r2.whoid, r2.id)
         ORDER BY r2.id) = 1) AS is_primary
    FROM public.raw_activities r2
    JOIN _touched_keys k
      ON k.salesforce_owner_id = r2.salesforce_owner_id
     AND k.activity_date = r2.activity_date
  ) sub
  WHERE ra.id = sub.id AND ra.is_dedup_primary IS DISTINCT FROM sub.is_primary;
END;
$fn$;

drop function if exists public.refresh_raw_activities_v2();
