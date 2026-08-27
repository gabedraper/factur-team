/*
 * The functions the talent screens call: reporting, duplicate detection and
 * merging, the readiness score, and the five entry points the public careers
 * page and hiring-manager portal reach as `anon`.
 *
 * Split from the tables so that a change to one of these is a change to one
 * file -- these get edited far more often than the schema does.
 */

-- ---------------------------------------------------------------------------
-- Reporting
-- ---------------------------------------------------------------------------

/*
 * Stage-to-stage conversion for one job, read off the history rather than the
 * current board -- somebody who reached Interview and was then rejected still
 * converted into Interview, and a count of who is standing there now says
 * otherwise.
 */
create or replace function public.tal_job_funnel(p_job_id uuid)
returns table (
  stage_id uuid, stage_name text, stage_kind text, stage_position int,
  reached int, still_there int, median_days numeric
)
language sql stable security definer set search_path to 'public', 'pg_catalog'
as $function$
  with allowed as (select public.tal_can_view() as ok)
  select
    st.id, st.name, st.kind, st.position,
    (select count(distinct h.candidate_id)::int
       from public.tal_candidate_stage_history h
      where h.job_id = p_job_id and h.to_stage_id = st.id),
    (select count(*)::int from public.tal_candidates c
      where c.job_id = p_job_id and c.stage_id = st.id and c.status = 'active'),
    (select percentile_cont(0.5) within group (order by extract(epoch from d.left_at - d.entered_at) / 86400)
       from (
         select h.changed_at as entered_at,
                lead(h.changed_at) over (partition by h.candidate_id order by h.changed_at) as left_at
           from public.tal_candidate_stage_history h
          where h.job_id = p_job_id and h.to_stage_id = st.id
       ) d
      where d.left_at is not null)
  from public.tal_workflow_stages st
  join public.tal_jobs j on j.workflow_id = st.workflow_id
  cross join allowed
  where j.id = p_job_id and allowed.ok
  order by st.position;
$function$;

/*
 * Recruiter activity over a window -- Loxo's activity KPI report. Counts only
 * the activity types marked as progression, so the number means work done
 * rather than rows written.
 */
create or replace function public.tal_activity_report(p_from date, p_to date)
returns table (
  member_id uuid, member_name text,
  calls int, emails int, meetings int, notes int,
  submissions int, placements int, total int
)
language sql stable security definer set search_path to 'public', 'pg_catalog'
as $function$
  with allowed as (select public.tal_can_view() as ok),
  acts as (
    select a.created_by, t.category
      from public.tal_activities a
      join public.tal_activity_types t on t.id = a.activity_type_id
     where a.occurred_at >= p_from and a.occurred_at < (p_to + 1)
       and t.counts_as_progression
  )
  select
    m.id, m.full_name,
    count(acts.category) filter (where acts.category = 'call')::int,
    count(acts.category) filter (where acts.category = 'email')::int,
    count(acts.category) filter (where acts.category = 'meeting')::int,
    count(acts.category) filter (where acts.category = 'note')::int,
    (select count(*)::int from public.tal_submissions s
      where s.created_by = m.id and s.created_at >= p_from and s.created_at < (p_to + 1)),
    (select count(*)::int from public.tal_placements pl
      where pl.created_by = m.id and pl.created_at >= p_from and pl.created_at < (p_to + 1)),
    count(acts.category)::int
  from public.org_members m
  left join acts on acts.created_by = m.id
  cross join allowed
  where allowed.ok and m.active
  group by m.id, m.full_name
  having count(acts.category) > 0
      or exists (select 1 from public.tal_submissions s where s.created_by = m.id)
      or exists (select 1 from public.tal_candidates c where c.owner_member_id = m.id)
  order by count(acts.category) desc, m.full_name;
$function$;

-- ---------------------------------------------------------------------------
-- Duplicates
-- ---------------------------------------------------------------------------

/*
 * Candidate databases fill up with the same person three times. Email is an
 * exact match; the name-plus-employer case is a suggestion, because "John Smith
 * at Acme" is genuinely two people often enough that this must never merge on
 * its own.
 */
create or replace function public.tal_duplicate_people()
returns table (
  a_id uuid, a_name text, a_email text, a_created timestamptz,
  b_id uuid, b_name text, b_email text, b_created timestamptz,
  basis text, confidence text
)
language sql stable security definer set search_path to 'public', 'pg_catalog'
as $function$
  with allowed as (select public.tal_can_view() as ok),
  live as (select * from public.tal_people where merged_into_id is null),
  by_email as (
    select a.id as a_id, a.name as a_name, a.primary_email as a_email, a.created_at as a_created,
           b.id as b_id, b.name as b_name, b.primary_email as b_email, b.created_at as b_created,
           'Same email address' as basis, 'high' as confidence
      from live a join live b
        on a.primary_email = b.primary_email and a.id < b.id
     where a.primary_email is not null
  ),
  by_name as (
    select a.id, a.name, a.primary_email, a.created_at,
           b.id, b.name, b.primary_email, b.created_at,
           'Same name and employer', 'medium'
      from live a join live b
        on lower(a.name) = lower(b.name)
       and lower(coalesce(a.company_name, '')) = lower(coalesce(b.company_name, ''))
       and a.id < b.id
     where btrim(a.name) <> ''
       and (a.primary_email is null or b.primary_email is null
            or a.primary_email <> b.primary_email)
  ),
  by_linkedin as (
    select a.id, a.name, a.primary_email, a.created_at,
           b.id, b.name, b.primary_email, b.created_at,
           'Same LinkedIn profile', 'high'
      from live a join live b
        on lower(a.linkedin_url) = lower(b.linkedin_url) and a.id < b.id
     where coalesce(a.linkedin_url, '') <> ''
  )
  select d.* from (
    select * from by_email
    union all select * from by_linkedin
    union all select * from by_name
  ) d cross join allowed where allowed.ok
  limit 500;
$function$;

/*
 * Merge, keeping the older record as the survivor by default and moving
 * everything that points at the loser. The loser is kept with `merged_into_id`
 * set rather than deleted, so a bookmarked URL still lands somewhere sensible.
 */
create or replace function public.tal_merge_people(p_keep uuid, p_merge uuid)
returns uuid
language plpgsql security definer set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_keep public.tal_people;
  v_merge public.tal_people;
begin
  if not public.tal_can_edit() then
    raise exception 'Forbidden: talent.recruit required';
  end if;
  if p_keep = p_merge then
    raise exception 'Cannot merge a person into themselves';
  end if;

  select * into v_keep from public.tal_people where id = p_keep;
  select * into v_merge from public.tal_people where id = p_merge;
  if v_keep.id is null or v_merge.id is null then
    raise exception 'Both people must exist';
  end if;

  -- Contact details are additive: the second record usually exists because
  -- somebody had a different email for them, and that is worth keeping.
  update public.tal_people set
    emails = (
      select coalesce(jsonb_agg(distinct e), '[]'::jsonb)
        from jsonb_array_elements(v_keep.emails || v_merge.emails) e),
    phones = (
      select coalesce(jsonb_agg(distinct e), '[]'::jsonb)
        from jsonb_array_elements(v_keep.phones || v_merge.phones) e),
    skills = (select array(select distinct unnest(v_keep.skills || v_merge.skills))),
    person_types = (select array(select distinct unnest(v_keep.person_types || v_merge.person_types))),
    title = coalesce(v_keep.title, v_merge.title),
    company_id = coalesce(v_keep.company_id, v_merge.company_id),
    company_name = coalesce(v_keep.company_name, v_merge.company_name),
    linkedin_url = coalesce(v_keep.linkedin_url, v_merge.linkedin_url),
    city = coalesce(v_keep.city, v_merge.city),
    state = coalesce(v_keep.state, v_merge.state),
    country = coalesce(v_keep.country, v_merge.country),
    summary = coalesce(v_keep.summary, v_merge.summary),
    resume_text = coalesce(v_keep.resume_text, v_merge.resume_text),
    do_not_contact = v_keep.do_not_contact or v_merge.do_not_contact,
    last_activity_at = greatest(v_keep.last_activity_at, v_merge.last_activity_at)
  where id = p_keep;

  update public.tal_activities set person_id = p_keep where person_id = p_merge;
  update public.tal_person_jobs set person_id = p_keep where person_id = p_merge;
  update public.tal_person_educations set person_id = p_keep where person_id = p_merge;
  update public.tal_documents set person_id = p_keep where person_id = p_merge;
  update public.tal_tasks set person_id = p_keep where person_id = p_merge;
  update public.tal_interviews set person_id = p_keep where person_id = p_merge;
  update public.tal_placements set person_id = p_keep where person_id = p_merge;
  update public.tal_deals set contact_person_id = p_keep where contact_person_id = p_merge;
  update public.tal_jobs set hiring_manager_person_id = p_keep where hiring_manager_person_id = p_merge;
  update public.tal_tag_links l set entity_id = p_keep
    where l.entity_type = 'person' and l.entity_id = p_merge
      and not exists (select 1 from public.tal_tag_links k
                       where k.entity_type = 'person' and k.entity_id = p_keep
                         and k.tag_id = l.tag_id);
  delete from public.tal_tag_links where entity_type = 'person' and entity_id = p_merge;

  -- A pipeline the survivor is already in wins; the duplicate's copy goes.
  update public.tal_candidates c set person_id = p_keep
   where c.person_id = p_merge
     and not exists (select 1 from public.tal_candidates k
                      where k.job_id = c.job_id and k.person_id = p_keep);
  delete from public.tal_candidates where person_id = p_merge;

  update public.tal_people set merged_into_id = p_keep, updated_at = now() where id = p_merge;
  return p_keep;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Readiness score
-- ---------------------------------------------------------------------------

/*
 * Loxo's Readiness Score in the only form that can be computed honestly here:
 * how complete and how warm the record is. It is not a prediction about the
 * person -- it is a measure of whether we could act on them today.
 */
create or replace function public.tal_readiness_score(p_person_id uuid)
returns int
language sql stable security definer set search_path to 'public', 'pg_catalog'
as $function$
  select least(100, greatest(0,
      (case when p.primary_email is not null then 20 else 0 end)
    + (case when p.primary_phone is not null then 15 else 0 end)
    + (case when coalesce(p.title, '') <> '' then 10 else 0 end)
    + (case when coalesce(p.linkedin_url, '') <> '' then 5 else 0 end)
    + (case when array_length(p.skills, 1) >= 3 then 10 else 0 end)
    + (case when exists (select 1 from public.tal_documents d
                          where d.person_id = p.id and d.kind = 'resume') then 20 else 0 end)
    + (case when exists (select 1 from public.tal_person_jobs j where j.person_id = p.id) then 5 else 0 end)
    + (case when p.last_activity_at > now() - interval '90 days' then 15
            when p.last_activity_at > now() - interval '365 days' then 7
            else 0 end)
    - (case when p.do_not_contact then 100 else 0 end)
  ))::int
  from public.tal_people p where p.id = p_person_id;
$function$;

/* Recompute for everyone; cheap enough to run from a settings button or nightly. */
create or replace function public.tal_refresh_readiness()
returns int language plpgsql security definer set search_path to 'public', 'pg_catalog'
as $function$
declare n int;
begin
  if not public.tal_can_edit() then
    raise exception 'Forbidden: talent.recruit required';
  end if;
  update public.tal_people p
     set readiness_score = public.tal_readiness_score(p.id)
   where p.merged_into_id is null;
  get diagnostics n = row_count;
  return n;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Public: the careers page and the apply form
-- ---------------------------------------------------------------------------

/*
 * The published jobs, readable by anyone. A separate function rather than a
 * policy on tal_jobs, because a policy generous enough to serve the public page
 * is a policy that leaks confidential searches the first time somebody gets a
 * WHERE clause wrong.
 */
create or replace function public.tal_public_jobs()
returns table (
  public_slug text, title text, company_name text, city text, state text,
  country text, remote text, employment_type text, salary_min numeric,
  salary_max numeric, salary_currency text, salary_period text,
  description text, requirements text, published_at timestamptz
)
language sql stable security definer set search_path to 'public', 'pg_catalog'
as $function$
  select j.public_slug, j.title, c.name, j.city, j.state, j.country, j.remote,
         j.employment_type, j.salary_min, j.salary_max, j.salary_currency,
         j.salary_period, j.description, j.requirements, j.published_at
    from public.tal_jobs j
    left join public.tal_companies c on c.id = j.company_id
   where j.published
     and not j.confidential
     and j.status = 'active'
     and j.public_slug is not null
     and (select careers_page_enabled from public.tal_settings where id)
   order by j.published_at desc nulls last;
$function$;

create or replace function public.tal_public_job(p_slug text)
returns table (
  public_slug text, title text, company_name text, city text, state text,
  country text, remote text, employment_type text, salary_min numeric,
  salary_max numeric, salary_currency text, salary_period text,
  description text, requirements text, published_at timestamptz
)
language sql stable security definer set search_path to 'public', 'pg_catalog'
as $function$
  select * from public.tal_public_jobs() where public_slug = p_slug;
$function$;

/*
 * An application from the public form. It writes only to tal_applications --
 * unreviewed input never reaches People or a pipeline. The job is looked up by
 * slug through the same published test the listing uses, so an application
 * cannot be posted against a confidential or closed search.
 */
create or replace function public.tal_submit_application(
  p_slug text, p_first_name text, p_last_name text, p_email text,
  p_phone text default null, p_linkedin_url text default null,
  p_location text default null, p_cover_note text default null,
  p_resume_path text default null, p_resume_name text default null,
  p_source text default 'careers'
)
returns uuid
language plpgsql security definer set search_path to 'public', 'pg_catalog'
as $function$
declare v_job uuid; v_id uuid;
begin
  select j.id into v_job
    from public.tal_jobs j
   where j.public_slug = p_slug and j.published and not j.confidential
     and j.status = 'active'
     and (select careers_page_enabled from public.tal_settings where id);
  if v_job is null then
    raise exception 'That role is not open for applications';
  end if;
  if coalesce(btrim(p_email), '') = '' or p_email not like '%@%' then
    raise exception 'A valid email address is required';
  end if;

  insert into public.tal_applications
    (job_id, first_name, last_name, email, phone, linkedin_url, location,
     cover_note, resume_path, resume_name, source)
  values
    (v_job, btrim(p_first_name), btrim(p_last_name), lower(btrim(p_email)),
     p_phone, p_linkedin_url, p_location, p_cover_note, p_resume_path,
     p_resume_name, p_source)
  returning id into v_id;
  return v_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Public: the hiring-manager portal
-- ---------------------------------------------------------------------------

/*
 * What a portal token can see. The `include` flags on each submission decide
 * how much of the person is shown -- contact details are off by default,
 * because handing a client a candidate's mobile number is how an agency stops
 * being needed.
 */
create or replace function public.tal_portal_view(p_token text)
returns jsonb
language plpgsql security definer set search_path to 'public', 'pg_catalog'
as $function$
declare v_link public.tal_portal_links; v_out jsonb;
begin
  select * into v_link from public.tal_portal_links
   where token = p_token and revoked_at is null
     and (expires_at is null or expires_at > now());
  if v_link.id is null then
    return null;
  end if;

  update public.tal_portal_links
     set last_seen_at = now(), view_count = view_count + 1
   where id = v_link.id;

  select jsonb_build_object(
    'recipient_name', v_link.recipient_name,
    'can_leave_feedback', v_link.can_leave_feedback,
    'job', (select jsonb_build_object(
              'title', j.title, 'city', j.city, 'state', j.state,
              'remote', j.remote, 'description', j.description,
              'company', co.name)
              from public.tal_jobs j
              left join public.tal_companies co on co.id = j.company_id
             where j.id = v_link.job_id),
    'submissions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id,
               'headline', s.headline,
               'summary', s.summary,
               'status', s.status,
               'decision', s.client_decision,
               'feedback', s.client_feedback,
               'shared_at', s.shared_at,
               'person', jsonb_build_object(
                 'name', p.name,
                 'title', p.title,
                 'company', p.company_name,
                 'location', concat_ws(', ', p.city, p.state),
                 'summary', p.summary,
                 'email', case when v_link.can_see_contact and (s.include ->> 'contact')::boolean
                               then p.primary_email else null end,
                 'phone', case when v_link.can_see_contact and (s.include ->> 'contact')::boolean
                               then p.primary_phone else null end,
                 'work_history', case when (s.include ->> 'work_history')::boolean then (
                     select jsonb_agg(jsonb_build_object(
                              'title', wj.title, 'company', wj.company_name,
                              'started_on', wj.started_on, 'ended_on', wj.ended_on)
                            order by wj.position)
                       from public.tal_person_jobs wj where wj.person_id = p.id)
                   else null end
               ))
             order by s.shared_at desc nulls last)
        from public.tal_submissions s
        join public.tal_people p on p.id = s.person_id
       where s.job_id = v_link.job_id
         and s.status in ('shared', 'viewed', 'feedback', 'advanced', 'declined')
    ), '[]'::jsonb)
  ) into v_out;

  update public.tal_submissions
     set status = case when status = 'shared' then 'viewed' else status end,
         first_viewed_at = coalesce(first_viewed_at, now()),
         view_count = view_count + 1
   where job_id = v_link.job_id and status = 'shared';

  return v_out;
end;
$function$;

create or replace function public.tal_portal_feedback(
  p_token text, p_submission_id uuid, p_decision text, p_feedback text
)
returns boolean
language plpgsql security definer set search_path to 'public', 'pg_catalog'
as $function$
declare v_link public.tal_portal_links;
begin
  select * into v_link from public.tal_portal_links
   where token = p_token and revoked_at is null and can_leave_feedback
     and (expires_at is null or expires_at > now());
  if v_link.id is null then
    return false;
  end if;
  if p_decision is not null
     and p_decision not in ('interview', 'interested', 'hold', 'declined') then
    raise exception 'Unknown decision';
  end if;

  update public.tal_submissions
     set client_decision = coalesce(p_decision, client_decision),
         client_feedback = coalesce(nullif(btrim(p_feedback), ''), client_feedback),
         client_responded_at = now(),
         status = case when p_decision = 'declined' then 'declined'
                       when p_decision is not null then 'advanced'
                       else 'feedback' end
   where id = p_submission_id and job_id = v_link.job_id;
  return found;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Grants and RLS
-- ---------------------------------------------------------------------------

/*
 * The public routes reach the database as `anon`. Only these five functions are
 * granted -- everything else stays behind the policies above.
 */
revoke all on function public.tal_public_jobs() from public;
revoke all on function public.tal_public_job(text) from public;
revoke all on function public.tal_submit_application(text, text, text, text, text, text, text, text, text, text, text) from public;
revoke all on function public.tal_portal_view(text) from public;
revoke all on function public.tal_portal_feedback(text, uuid, text, text) from public;

grant execute on function public.tal_public_jobs() to anon, authenticated;
grant execute on function public.tal_public_job(text) to anon, authenticated;
grant execute on function public.tal_submit_application(text, text, text, text, text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.tal_portal_view(text) to anon, authenticated;
grant execute on function public.tal_portal_feedback(text, uuid, text, text) to anon, authenticated;

grant execute on function public.tal_job_funnel(uuid) to authenticated;
grant execute on function public.tal_activity_report(date, date) to authenticated;
grant execute on function public.tal_duplicate_people() to authenticated;
grant execute on function public.tal_merge_people(uuid, uuid) to authenticated;
grant execute on function public.tal_readiness_score(uuid) to authenticated;
grant execute on function public.tal_refresh_readiness() to authenticated;
