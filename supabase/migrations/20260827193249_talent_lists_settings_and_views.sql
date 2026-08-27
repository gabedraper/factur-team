/*
 * The rest of the system: lists, saved searches, settings, the integration
 * register, the public careers page and hiring-manager portal, and the views
 * and functions the screens read.
 */

-- ---------------------------------------------------------------------------
-- Lists and smart lists
-- ---------------------------------------------------------------------------

/*
 * A list is either a bag of records somebody put there, or a saved filter that
 * re-runs -- Loxo's Lists and Smart Lists. One table, because the difference to
 * the person using it is a checkbox, and a list frequently starts as one and
 * becomes the other.
 */
create table if not exists public.tal_lists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  entity text not null default 'person' check (entity in ('person', 'company', 'job')),
  is_smart boolean not null default false,
  /* The saved filter, in the same shape the list screen posts. */
  filter jsonb not null default '{}'::jsonb,
  owner_member_id uuid references public.org_members(id) on delete set null,
  shared boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tal_lists_owner_idx on public.tal_lists (owner_member_id);

create table if not exists public.tal_list_members (
  list_id uuid not null references public.tal_lists(id) on delete cascade,
  entity_id uuid not null,
  added_by uuid references public.org_members(id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (list_id, entity_id)
);

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------

/*
 * One row. Kept as a table rather than folded into app_settings because these
 * are talent-system choices with types, and a settings screen wants columns.
 */
create table if not exists public.tal_settings (
  id boolean primary key default true check (id),
  agency_name text not null default 'Factur',
  careers_page_enabled boolean not null default false,
  careers_page_heading text not null default 'Open roles',
  careers_page_intro text,
  careers_apply_email text,
  default_workflow_id uuid references public.tal_workflows(id) on delete set null,
  default_guarantee_days int not null default 90,
  /* Automatic outreach is off until somebody deliberately turns it on. */
  outreach_mode text not null default 'semi' check (outreach_mode in ('semi', 'full')),
  duplicate_check_on_add boolean not null default true,
  updated_by uuid references public.org_members(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.tal_settings (id) values (true) on conflict (id) do nothing;
update public.tal_settings
set default_workflow_id = (select id from public.tal_workflows where is_default limit 1)
where default_workflow_id is null;

-- ---------------------------------------------------------------------------
-- The integration register
-- ---------------------------------------------------------------------------

/*
 * Every outside service this system would like to use, listed whether or not it
 * is connected. This is what lets the screens be built ahead of the accounts:
 * a feature reads its row, finds `status = 'not_connected'`, and says so in
 * place of pretending. No secret is ever stored here -- credentials belong in
 * environment variables; `config` holds only the harmless parts, like which
 * mailbox to send from.
 */
create table if not exists public.tal_integrations (
  slug text primary key,
  name text not null,
  category text not null,
  /* What stops working without it, shown on the integrations screen. */
  powers text not null,
  status text not null default 'not_connected'
    check (status in ('not_connected', 'connected', 'error', 'disabled')),
  /* What a person has to go and get. Written here so the screen can say it. */
  requires text,
  config jsonb not null default '{}'::jsonb,
  last_error text,
  connected_at timestamptz,
  connected_by uuid references public.org_members(id) on delete set null,
  position int not null default 0,
  updated_at timestamptz not null default now()
);

insert into public.tal_integrations (slug, name, category, powers, requires, position) values
  ('gmail', 'Gmail', 'Email',
   'Two-way email sync on person and job timelines, sending from your own mailbox, and reply detection that stops a campaign.',
   'A Google Cloud OAuth client with Gmail scopes, plus domain-wide delegation if mail is to be sent as other people.', 1),
  ('google_calendar', 'Google Calendar', 'Scheduling',
   'Creating interviews as real calendar invitations, availability lookup, and keeping reschedules in step.',
   'The same Google Cloud project with the Calendar scope added.', 2),
  ('resend', 'Resend', 'Email',
   'Transactional sending for campaign steps and submission share links when they should come from the company rather than a person.',
   'Already connected for the rest of this app; needs a verified sending domain for talent mail.', 3),
  ('claude', 'Claude API', 'Intelligence',
   'Resume parsing into a structured profile, candidate-to-job match scoring with reasons, submission summaries, and note summarisation.',
   'An Anthropic API key on the server. Nothing about it is client-side.', 4),
  ('contact_enrichment', 'Contact enrichment', 'Sourcing',
   'Finding a verified work email or mobile number for a person you only have a name and employer for.',
   'A paid data provider. This is the piece Loxo sells as Loxo Connect and there is no free equivalent.', 5),
  ('people_search', 'People search', 'Sourcing',
   'Searching a market-wide index of people and companies from inside a job, rather than only your own database.',
   'A licensed people-data provider. Loxo Source is their own proprietary index and cannot be reproduced.', 6),
  ('telephony', 'Calling and SMS', 'Communication',
   'Click-to-call from a profile, call logging and recording, and text messages on the timeline.',
   'A Twilio account with a purchased number, and a decision about call-recording consent in each state you call.', 7),
  ('job_boards', 'Job board distribution', 'Advertising',
   'Pushing a published job out to Indeed, LinkedIn and the aggregators in one action.',
   'Accounts with each board, or a paid distribution service. Loxo Boost is a reseller relationship, not a feature.', 8),
  ('linkedin_extension', 'Browser extension', 'Sourcing',
   'Capturing a profile from a page you are looking at straight into People.',
   'The extension has to be installed in each person''s browser. Scraping LinkedIn breaches their terms; a manual capture of the page you are on is the defensible version.', 9),
  ('notetaker', 'Meeting notetaker', 'Intelligence',
   'A bot that joins an interview call, transcribes it, and files the notes against the candidate.',
   'A meeting-bot vendor such as Recall.ai, and recording consent from everyone on the call.', 10),
  ('background_check', 'Background checks', 'Compliance',
   'Ordering a check from a placement record and holding the result.',
   'An account with a screening provider, and FCRA-compliant disclosure and authorisation from the candidate.', 11),
  ('storage', 'Document storage', 'Core',
   'Holding resumes and attachments.',
   'A Supabase Storage bucket named talent-documents.', 12)
on conflict (slug) do update
  set name = excluded.name, category = excluded.category, powers = excluded.powers,
      requires = excluded.requires, position = excluded.position;

-- ---------------------------------------------------------------------------
-- AI match results
-- ---------------------------------------------------------------------------

/*
 * Where a scoring run puts its output, so a match survives the page reload and
 * so "we already dismissed this person for this job" is a fact rather than a
 * memory. Nothing writes here until the Claude integration is connected.
 */
create table if not exists public.tal_ai_matches (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.tal_jobs(id) on delete cascade,
  person_id uuid not null references public.tal_people(id) on delete cascade,
  score numeric(5,2) check (score between 0 and 100),
  reasons jsonb not null default '[]'::jsonb,
  concerns jsonb not null default '[]'::jsonb,
  model text,
  status text not null default 'suggested'
    check (status in ('suggested', 'added', 'dismissed')),
  decided_by uuid references public.org_members(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (job_id, person_id)
);
create index if not exists tal_ai_matches_job_idx on public.tal_ai_matches (job_id, score desc);

-- ---------------------------------------------------------------------------
-- Public routes: careers page and hiring-manager portal
-- ---------------------------------------------------------------------------

/*
 * An application arriving from the public careers page, before anyone has
 * looked at it. It is deliberately not a candidate row yet: unreviewed public
 * input should not be able to create records in the working database, and the
 * screen that turns one into a candidate is where a human decides.
 */
create table if not exists public.tal_applications (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.tal_jobs(id) on delete cascade,
  first_name text,
  last_name text,
  email text,
  phone text,
  linkedin_url text,
  location text,
  cover_note text,
  resume_path text,
  resume_name text,
  answers jsonb not null default '{}'::jsonb,
  status text not null default 'new'
    check (status in ('new', 'accepted', 'rejected', 'duplicate', 'spam')),
  person_id uuid references public.tal_people(id) on delete set null,
  candidate_id uuid references public.tal_candidates(id) on delete set null,
  reviewed_by uuid references public.org_members(id) on delete set null,
  reviewed_at timestamptz,
  source text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists tal_applications_job_idx on public.tal_applications (job_id, created_at desc);
create index if not exists tal_applications_new_idx on public.tal_applications (status) where status = 'new';

/*
 * A link handed to somebody with no account -- a hiring manager, an interviewer
 * at a client. The token is the credential, so it is scoped to one job and can
 * be expired. Deliberately narrow: it grants reading shared submissions and
 * leaving feedback, and nothing else.
 */
create table if not exists public.tal_portal_links (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  job_id uuid references public.tal_jobs(id) on delete cascade,
  company_id uuid references public.tal_companies(id) on delete cascade,
  person_id uuid references public.tal_people(id) on delete set null,
  recipient_name text,
  recipient_email text,
  can_leave_feedback boolean not null default true,
  can_see_contact boolean not null default false,
  expires_at timestamptz,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  view_count int not null default 0,
  created_by uuid references public.org_members(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Views the screens read
-- ---------------------------------------------------------------------------

/*
 * A job with the numbers the board header shows. security_invoker so the view
 * answers as the person asking, rather than becoming a way around the policies
 * on the tables underneath.
 */
create or replace view public.tal_job_summary
with (security_invoker = true) as
select
  j.id,
  j.title,
  j.status,
  j.job_kind,
  j.employment_type,
  j.confidential,
  j.remote,
  j.city,
  j.state,
  j.openings,
  j.published,
  j.public_slug,
  j.opened_on,
  j.target_fill_on,
  j.salary_min,
  j.salary_max,
  j.created_at,
  j.last_activity_at,
  j.workflow_id,
  j.company_id,
  c.name as company_name,
  j.owner_member_id,
  m.full_name as owner_name,
  count(cand.id) filter (where cand.status = 'active') as active_count,
  count(cand.id) as total_count,
  count(cand.id) filter (where st.kind = 'submitted') as submitted_count,
  count(cand.id) filter (where st.kind = 'interview') as interview_count,
  count(cand.id) filter (where cand.status = 'hired') as hired_count,
  max(cand.last_activity_at) as last_candidate_activity
from public.tal_jobs j
left join public.tal_companies c on c.id = j.company_id
left join public.org_members m on m.id = j.owner_member_id
left join public.tal_candidates cand on cand.job_id = j.id
left join public.tal_workflow_stages st on st.id = cand.stage_id
group by j.id, c.name, m.full_name;

/*
 * Loxo's Master Pipeline: every live candidate on every live search, one row
 * each. The point of it is the "days in stage" column -- a board per job hides
 * the person who has been sitting in Submitted for three weeks.
 */
create or replace view public.tal_master_pipeline
with (security_invoker = true) as
select
  cand.id as candidate_id,
  cand.job_id,
  j.title as job_title,
  j.confidential,
  co.name as company_name,
  cand.person_id,
  p.name as person_name,
  p.title as person_title,
  p.company_name as person_company,
  p.primary_email,
  p.primary_phone,
  cand.stage_id,
  st.name as stage_name,
  st.kind as stage_kind,
  st.position as stage_position,
  st.color as stage_color,
  cand.status,
  cand.rating,
  cand.source,
  cand.stage_changed_at,
  extract(day from now() - cand.stage_changed_at)::int as days_in_stage,
  cand.last_activity_at,
  extract(day from now() - coalesce(cand.last_activity_at, cand.created_at))::int as days_since_touch,
  cand.owner_member_id,
  m.full_name as owner_name,
  cand.created_at
from public.tal_candidates cand
join public.tal_jobs j on j.id = cand.job_id
left join public.tal_companies co on co.id = j.company_id
join public.tal_people p on p.id = cand.person_id
left join public.tal_workflow_stages st on st.id = cand.stage_id
left join public.org_members m on m.id = cand.owner_member_id;

/* A person as the list screen shows them, with the counts that make a row useful. */
create or replace view public.tal_person_summary
with (security_invoker = true) as
select
  p.id,
  p.name,
  p.first_name,
  p.last_name,
  p.title,
  p.company_id,
  coalesce(c.name, p.company_name) as company,
  p.primary_email,
  p.primary_phone,
  p.city,
  p.state,
  p.country,
  p.person_types,
  p.skills,
  p.readiness_score,
  p.do_not_contact,
  p.source,
  p.owner_member_id,
  m.full_name as owner_name,
  p.created_at,
  p.last_activity_at,
  p.linkedin_url,
  (select count(*) from public.tal_candidates x where x.person_id = p.id) as pipeline_count,
  (select count(*) from public.tal_candidates x where x.person_id = p.id and x.status = 'active') as active_pipeline_count,
  (select count(*) from public.tal_activities a where a.person_id = p.id) as activity_count,
  (select count(*) from public.tal_documents d where d.person_id = p.id and d.kind = 'resume') as resume_count
from public.tal_people p
left join public.tal_companies c on c.id = p.company_id
left join public.org_members m on m.id = p.owner_member_id
where p.merged_into_id is null;

do $$
declare t text;
begin
  foreach t in array array[
    'tal_lists', 'tal_list_members', 'tal_settings', 'tal_integrations',
    'tal_ai_matches', 'tal_applications', 'tal_portal_links'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format(
      'create policy %I on public.%I for select using (public.tal_can_view())', t || '_read', t);
    execute format(
      'create policy %I on public.%I for all using (public.tal_can_edit()) with check (public.tal_can_edit())',
      t || '_write', t);
  end loop;
end $$;

/* Settings and integrations are administrative; the read policy above still applies. */
drop policy if exists tal_settings_write on public.tal_settings;
create policy tal_settings_write on public.tal_settings
  for all using (public.tal_can_admin()) with check (public.tal_can_admin());
drop policy if exists tal_integrations_write on public.tal_integrations;
create policy tal_integrations_write on public.tal_integrations
  for all using (public.tal_can_admin()) with check (public.tal_can_admin());

drop trigger if exists tal_lists_touch on public.tal_lists;
create trigger tal_lists_touch before update on public.tal_lists
  for each row execute function public.tal_touch_updated_at();

