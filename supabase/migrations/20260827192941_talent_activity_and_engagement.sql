/*
 * Everything that happens to a person: notes, calls, emails, meetings, tasks,
 * outreach campaigns, interviews, submissions and scorecards.
 *
 * One activity table serves all of it. Loxo calls these person events and shows
 * them as a single timeline, which is the right shape: the question a recruiter
 * asks is "what has happened with this person", not "show me the calls table".
 * The specialised tables below (interviews, submissions, scorecards) hold the
 * structure those things need and write an activity row so the timeline stays
 * complete.
 */

-- ---------------------------------------------------------------------------
-- Activity types
-- ---------------------------------------------------------------------------

/*
 * Loxo's Activity Types, including its progression triggers. `counts_as_
 * progression` is what turns a timeline into a KPI: a logged call counts
 * towards a recruiter's activity numbers, an automatic system note does not.
 */
create table if not exists public.tal_activity_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  category text not null default 'note'
    check (category in ('note', 'call', 'email', 'sms', 'meeting', 'stage', 'task', 'system', 'document')),
  counts_as_progression boolean not null default false,
  color text not null default 'slate',
  position int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.tal_activity_types (name, slug, category, counts_as_progression, color, position) values
  ('Note',              'note',           'note',     false, 'slate',   0),
  ('Intake Note',       'intake-note',    'note',     true,  'violet',  1),
  ('Call',              'call',           'call',     true,  'sky',     2),
  ('Call - connected',  'call-connected', 'call',     true,  'emerald', 3),
  ('Call - no answer',  'call-no-answer', 'call',     false, 'slate',   4),
  ('Email sent',        'email-out',      'email',    true,  'indigo',  5),
  ('Email received',    'email-in',       'email',    true,  'indigo',  6),
  ('Text message',      'sms',            'sms',      true,  'cyan',    7),
  ('Meeting',           'meeting',        'meeting',  true,  'amber',   8),
  ('Interview',         'interview',      'meeting',  true,  'amber',   9),
  ('Stage change',      'stage-change',   'stage',    false, 'slate',  10),
  ('Submission',        'submission',     'system',   true,  'violet', 11),
  ('Document added',    'document',       'document', false, 'slate',  12),
  ('System',            'system',         'system',   false, 'slate',  13)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- The activity timeline
-- ---------------------------------------------------------------------------

/*
 * Every foreign key is nullable because an activity attaches to whatever it is
 * about: a note on a company has no person, a stage change has all four. The
 * timeline on any record is a filter on this table.
 */
create table if not exists public.tal_activities (
  id uuid primary key default gen_random_uuid(),
  activity_type_id uuid references public.tal_activity_types(id) on delete set null,
  person_id uuid references public.tal_people(id) on delete cascade,
  company_id uuid references public.tal_companies(id) on delete cascade,
  job_id uuid references public.tal_jobs(id) on delete cascade,
  candidate_id uuid references public.tal_candidates(id) on delete cascade,
  subject text,
  body text,
  direction text check (direction in ('inbound', 'outbound')),
  outcome text,
  /* Set when the activity came from somewhere else, so a resync can dedupe. */
  external_source text,
  external_id text,
  metadata jsonb not null default '{}'::jsonb,
  pinned boolean not null default false,
  occurred_at timestamptz not null default now(),
  created_by uuid references public.org_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tal_activities_person_idx on public.tal_activities (person_id, occurred_at desc);
create index if not exists tal_activities_job_idx on public.tal_activities (job_id, occurred_at desc);
create index if not exists tal_activities_company_idx on public.tal_activities (company_id, occurred_at desc);
create index if not exists tal_activities_candidate_idx on public.tal_activities (candidate_id, occurred_at desc);
create index if not exists tal_activities_author_idx on public.tal_activities (created_by, occurred_at desc);
create unique index if not exists tal_activities_external_key
  on public.tal_activities (external_source, external_id)
  where external_source is not null and external_id is not null;

/*
 * Logging activity is what keeps `last_activity_at` honest on the four records
 * it could belong to. Done here so an import updates them too.
 */
create or replace function public.tal_bump_last_activity()
returns trigger language plpgsql set search_path to 'public', 'pg_catalog'
as $function$
begin
  if new.person_id is not null then
    update public.tal_people set last_activity_at = greatest(coalesce(last_activity_at, new.occurred_at), new.occurred_at)
    where id = new.person_id;
  end if;
  if new.company_id is not null then
    update public.tal_companies set last_activity_at = greatest(coalesce(last_activity_at, new.occurred_at), new.occurred_at)
    where id = new.company_id;
  end if;
  if new.job_id is not null then
    update public.tal_jobs set last_activity_at = greatest(coalesce(last_activity_at, new.occurred_at), new.occurred_at)
    where id = new.job_id;
  end if;
  if new.candidate_id is not null then
    update public.tal_candidates set last_activity_at = greatest(coalesce(last_activity_at, new.occurred_at), new.occurred_at)
    where id = new.candidate_id;
  end if;
  return null;
end;
$function$;

drop trigger if exists tal_activities_bump on public.tal_activities;
create trigger tal_activities_bump
  after insert on public.tal_activities
  for each row execute function public.tal_bump_last_activity();

-- ---------------------------------------------------------------------------
-- Note and email templates
-- ---------------------------------------------------------------------------

/* Loxo's Note Templates, including the intake form used on a new search. */
create table if not exists public.tal_note_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  scope text not null default 'person' check (scope in ('person', 'company', 'job', 'candidate')),
  body text not null default '',
  position int not null default 0,
  active boolean not null default true,
  created_by uuid references public.org_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tal_email_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  audience text not null default 'candidate' check (audience in ('candidate', 'client', 'internal')),
  subject text not null default '',
  body text not null default '',
  /* Placeholders the renderer understands, listed for the picker rather than parsed. */
  merge_fields text[] not null default '{}'::text[],
  active boolean not null default true,
  created_by uuid references public.org_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------------

create table if not exists public.tal_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  notes text,
  due_at timestamptz,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  assigned_member_id uuid references public.org_members(id) on delete set null,
  person_id uuid references public.tal_people(id) on delete cascade,
  company_id uuid references public.tal_companies(id) on delete cascade,
  job_id uuid references public.tal_jobs(id) on delete cascade,
  candidate_id uuid references public.tal_candidates(id) on delete cascade,
  done_at timestamptz,
  created_by uuid references public.org_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tal_tasks_assignee_idx on public.tal_tasks (assigned_member_id, due_at) where done_at is null;
create index if not exists tal_tasks_person_idx on public.tal_tasks (person_id);

-- ---------------------------------------------------------------------------
-- Outreach campaigns
-- ---------------------------------------------------------------------------

/*
 * Loxo's campaigns. Deliberately a separate engine from the app's existing
 * `sequences` tables: those are keyed on a client and drive collections and
 * NPS, whereas a campaign is enrolled per person and can branch by channel.
 * The two share vocabulary -- steps, position, delay, mode -- so that anyone
 * who has configured one recognises the other.
 *
 * `mode` follows the house convention: semi drafts for a human to send, full
 * sends unattended.
 */
create table if not exists public.tal_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  job_id uuid references public.tal_jobs(id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'completed', 'archived')),
  mode text not null default 'semi' check (mode in ('semi', 'full')),
  audience text not null default 'candidate' check (audience in ('candidate', 'client')),
  from_email text,
  owner_member_id uuid references public.org_members(id) on delete set null,
  /* Business hours only, so an automated touch never lands at 2am. */
  send_window_start time not null default '08:00',
  send_window_end time not null default '18:00',
  send_weekdays_only boolean not null default true,
  stop_on_reply boolean not null default true,
  created_by uuid references public.org_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tal_campaign_steps (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.tal_campaigns(id) on delete cascade,
  position int not null default 0,
  channel text not null default 'email'
    check (channel in ('email', 'sms', 'call', 'linkedin', 'task')),
  /* Days after the previous step, so reordering does not need every date redone. */
  delay_days int not null default 0 check (delay_days >= 0),
  subject text,
  body text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, position)
);

create table if not exists public.tal_campaign_members (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.tal_campaigns(id) on delete cascade,
  person_id uuid not null references public.tal_people(id) on delete cascade,
  candidate_id uuid references public.tal_candidates(id) on delete set null,
  status text not null default 'active'
    check (status in ('active', 'paused', 'completed', 'replied', 'bounced', 'unsubscribed', 'stopped')),
  current_position int not null default -1,
  next_due_at timestamptz,
  enrolled_by uuid references public.org_members(id) on delete set null,
  enrolled_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (campaign_id, person_id)
);
create index if not exists tal_campaign_members_due_idx
  on public.tal_campaign_members (next_due_at) where status = 'active';

create table if not exists public.tal_campaign_sends (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.tal_campaign_members(id) on delete cascade,
  step_id uuid references public.tal_campaign_steps(id) on delete set null,
  channel text not null default 'email',
  to_address text,
  subject text,
  body text,
  status text not null default 'queued'
    check (status in ('queued', 'drafted', 'sent', 'failed', 'skipped')),
  error text,
  sent_at timestamptz,
  opened_at timestamptz,
  clicked_at timestamptz,
  replied_at timestamptz,
  sent_by uuid references public.org_members(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists tal_campaign_sends_member_idx on public.tal_campaign_sends (member_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Interviews and meetings
-- ---------------------------------------------------------------------------

create table if not exists public.tal_interviews (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid references public.tal_candidates(id) on delete cascade,
  job_id uuid references public.tal_jobs(id) on delete cascade,
  person_id uuid not null references public.tal_people(id) on delete cascade,
  kind text not null default 'interview'
    check (kind in ('phone_screen', 'interview', 'client_interview', 'final_interview', 'meeting', 'debrief')),
  title text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  timezone text not null default 'America/New_York',
  location text,
  video_url text,
  /* Everyone on the invite, including people with no record here. */
  attendees jsonb not null default '[]'::jsonb,
  organizer_member_id uuid references public.org_members(id) on delete set null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'completed', 'cancelled', 'no_show', 'rescheduled')),
  notes text,
  external_source text,
  external_event_id text,
  created_by uuid references public.org_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tal_interviews_starts_idx on public.tal_interviews (starts_at);
create index if not exists tal_interviews_candidate_idx on public.tal_interviews (candidate_id);

-- ---------------------------------------------------------------------------
-- Submissions: sharing a candidate with the hiring manager
-- ---------------------------------------------------------------------------

/*
 * Loxo's submittal summary plus its share link in one record. The token is what
 * makes the public page work without an account, which is how a hiring manager
 * at a client company is ever going to look at this.
 */
create table if not exists public.tal_submissions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.tal_jobs(id) on delete cascade,
  candidate_id uuid not null references public.tal_candidates(id) on delete cascade,
  person_id uuid not null references public.tal_people(id) on delete cascade,
  headline text,
  summary text,
  /* Which parts of the profile the recipient may see. */
  include jsonb not null default '{"resume":true,"contact":false,"compensation":false,"work_history":true}'::jsonb,
  status text not null default 'draft'
    check (status in ('draft', 'shared', 'viewed', 'feedback', 'advanced', 'declined')),
  share_token text unique,
  shared_with jsonb not null default '[]'::jsonb,
  shared_at timestamptz,
  expires_at timestamptz,
  first_viewed_at timestamptz,
  view_count int not null default 0,
  client_decision text check (client_decision in ('interview', 'interested', 'hold', 'declined')),
  client_feedback text,
  client_responded_at timestamptz,
  created_by uuid references public.org_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tal_submissions_job_idx on public.tal_submissions (job_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Scorecards
-- ---------------------------------------------------------------------------

create table if not exists public.tal_scorecard_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  /* [{key, label, description, weight}] -- the questions this scorecard asks. */
  criteria jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_by uuid references public.org_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tal_scorecards (
  id uuid primary key default gen_random_uuid(),
  template_id uuid references public.tal_scorecard_templates(id) on delete set null,
  candidate_id uuid not null references public.tal_candidates(id) on delete cascade,
  job_id uuid not null references public.tal_jobs(id) on delete cascade,
  person_id uuid not null references public.tal_people(id) on delete cascade,
  interview_id uuid references public.tal_interviews(id) on delete set null,
  interviewer_member_id uuid references public.org_members(id) on delete set null,
  /* Someone outside the app -- a client interviewer -- who filled this in. */
  interviewer_name text,
  overall_rating int check (overall_rating between 1 and 5),
  recommendation text check (recommendation in ('strong_yes', 'yes', 'neutral', 'no', 'strong_no')),
  /* {criterion_key: {rating, comment}} */
  ratings jsonb not null default '{}'::jsonb,
  strengths text,
  concerns text,
  notes text,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tal_scorecards_candidate_idx on public.tal_scorecards (candidate_id);

-- ---------------------------------------------------------------------------
-- Stage automations
-- ---------------------------------------------------------------------------

/*
 * Loxo's Stage Automations: moving a candidate into a stage does something.
 * Stored as a rule with a jsonb payload rather than as code, so Settings can
 * add one. Nothing here fires until the runner exists -- `active` defaults to
 * false for exactly that reason.
 */
create table if not exists public.tal_stage_automations (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.tal_workflows(id) on delete cascade,
  stage_id uuid not null references public.tal_workflow_stages(id) on delete cascade,
  trigger text not null default 'enter' check (trigger in ('enter', 'exit')),
  action text not null
    check (action in ('send_email', 'enrol_campaign', 'create_task', 'notify_member',
                      'request_scorecard', 'schedule_interview', 'draft_submission')),
  config jsonb not null default '{}'::jsonb,
  active boolean not null default false,
  created_by uuid references public.org_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tal_stage_automations_stage_idx on public.tal_stage_automations (stage_id, trigger);

-- ---------------------------------------------------------------------------
-- Triggers and RLS
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'tal_activities', 'tal_note_templates', 'tal_email_templates', 'tal_tasks',
    'tal_campaigns', 'tal_campaign_steps', 'tal_interviews', 'tal_submissions',
    'tal_scorecard_templates', 'tal_scorecards', 'tal_stage_automations'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format(
      'create trigger %I before update on public.%I
       for each row execute function public.tal_touch_updated_at()', t || '_touch', t);
  end loop;

  foreach t in array array[
    'tal_activity_types', 'tal_activities', 'tal_note_templates', 'tal_email_templates',
    'tal_tasks', 'tal_campaigns', 'tal_campaign_steps', 'tal_campaign_members',
    'tal_campaign_sends', 'tal_interviews', 'tal_submissions',
    'tal_scorecard_templates', 'tal_scorecards', 'tal_stage_automations'
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
