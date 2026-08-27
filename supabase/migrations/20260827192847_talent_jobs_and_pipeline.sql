/*
 * Jobs, workflows and the pipeline.
 *
 * A Job is a search. A Workflow is the set of stages that search runs through,
 * and it is a record rather than an enum because the whole point of Loxo's
 * pipeline is that a retained executive search and a high-volume internal hire
 * do not share stages. Every job points at one workflow; changing a workflow's
 * stages changes every board using it.
 *
 * A Candidate is not a person -- it is a person *on* a job. The same person can
 * sit in three pipelines at different stages, which is why the stage lives here
 * and not on tal_people.
 */

-- ---------------------------------------------------------------------------
-- Workflows and stages
-- ---------------------------------------------------------------------------

create table if not exists public.tal_workflows (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  is_default boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
/* Exactly one default, so a new job never has to ask. */
create unique index if not exists tal_workflows_one_default
  on public.tal_workflows ((is_default)) where is_default;

/*
 * `kind` is the machine-readable meaning behind a stage whose name is free
 * text. Reporting needs to know that "Client Interview" and "Onsite" are both
 * interviews without anyone having to name them identically, and automations
 * need to know which stage means placed.
 */
create table if not exists public.tal_workflow_stages (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.tal_workflows(id) on delete cascade,
  name text not null,
  kind text not null default 'other'
    check (kind in ('sourced', 'contacted', 'responded', 'screening', 'submitted',
                    'interview', 'offer', 'placed', 'rejected', 'other')),
  position int not null default 0,
  color text not null default 'slate',
  /* A terminal stage takes the candidate out of the active count. */
  is_terminal boolean not null default false,
  /* Loxo's progression triggers: crossing this stage is a countable milestone. */
  counts_as_progression boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tal_workflow_stages_wf_idx on public.tal_workflow_stages (workflow_id, position);

-- ---------------------------------------------------------------------------
-- Jobs
-- ---------------------------------------------------------------------------

create table if not exists public.tal_jobs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  company_id uuid references public.tal_companies(id) on delete set null,
  workflow_id uuid references public.tal_workflows(id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'on_hold', 'filled', 'closed', 'cancelled')),
  /* How the work is sold. Internal hires carry no fee, which is why it is here. */
  job_kind text not null default 'internal'
    check (job_kind in ('internal', 'contingency', 'retained', 'container', 'contract', 'rpo')),
  employment_type text not null default 'full_time'
    check (employment_type in ('full_time', 'part_time', 'contract', 'contract_to_hire', 'temporary', 'internship')),
  /* Loxo's Confidential Jobs: hidden from everyone but the named team. */
  confidential boolean not null default false,
  description text,
  requirements text,
  internal_notes text,
  city text,
  state text,
  country text,
  remote text not null default 'onsite' check (remote in ('onsite', 'hybrid', 'remote')),
  salary_min numeric(12,2),
  salary_max numeric(12,2),
  salary_currency text not null default 'USD',
  salary_period text not null default 'year'
    check (salary_period in ('hour', 'day', 'week', 'month', 'year')),
  fee_type text check (fee_type in ('percentage', 'flat', 'hourly_markup')),
  fee_percent numeric(5,2),
  fee_flat numeric(12,2),
  openings int not null default 1 check (openings >= 0),
  owner_member_id uuid references public.org_members(id) on delete set null,
  hiring_manager_person_id uuid references public.tal_people(id) on delete set null,
  /* Careers page. Unpublished jobs are invisible to the public routes. */
  published boolean not null default false,
  published_at timestamptz,
  public_slug text unique,
  opened_on date,
  target_fill_on date,
  closed_at timestamptz,
  created_by uuid references public.org_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_activity_at timestamptz,
  search_tsv tsvector generated always as (
    to_tsvector('english',
      coalesce(title, '') || ' ' || coalesce(description, '') || ' ' ||
      coalesce(requirements, '') || ' ' || coalesce(city, '') || ' ' || coalesce(state, ''))
  ) stored
);
create index if not exists tal_jobs_status_idx on public.tal_jobs (status);
create index if not exists tal_jobs_company_idx on public.tal_jobs (company_id);
create index if not exists tal_jobs_owner_idx on public.tal_jobs (owner_member_id);
create index if not exists tal_jobs_search_idx on public.tal_jobs using gin (search_tsv);
create index if not exists tal_jobs_published_idx on public.tal_jobs (published) where published;

/* Deferred from the core file, which created documents before jobs existed. */
alter table public.tal_documents
  drop constraint if exists tal_documents_job_id_fkey;
alter table public.tal_documents
  add constraint tal_documents_job_id_fkey
  foreign key (job_id) references public.tal_jobs(id) on delete set null;

/*
 * Who else works this search. The owner is on the job; this is everybody else,
 * and it is what makes a confidential job visible to the right people.
 */
create table if not exists public.tal_job_team (
  job_id uuid not null references public.tal_jobs(id) on delete cascade,
  member_id uuid not null references public.org_members(id) on delete cascade,
  role text not null default 'recruiter'
    check (role in ('owner', 'recruiter', 'sourcer', 'coordinator', 'account_manager')),
  created_at timestamptz not null default now(),
  primary key (job_id, member_id, role)
);

/* Loxo's Target Companies: where the candidates for this search should come from. */
create table if not exists public.tal_job_target_companies (
  job_id uuid not null references public.tal_jobs(id) on delete cascade,
  company_id uuid not null references public.tal_companies(id) on delete cascade,
  status text not null default 'target' check (status in ('target', 'off_limits', 'sourced', 'exhausted')),
  note text,
  created_by uuid references public.org_members(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (job_id, company_id)
);

-- ---------------------------------------------------------------------------
-- Candidates: a person on a job
-- ---------------------------------------------------------------------------

create table if not exists public.tal_candidates (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.tal_jobs(id) on delete cascade,
  person_id uuid not null references public.tal_people(id) on delete cascade,
  stage_id uuid references public.tal_workflow_stages(id) on delete set null,
  status text not null default 'active'
    check (status in ('active', 'rejected', 'withdrawn', 'hired', 'on_hold')),
  source text not null default 'sourced'
    check (source in ('sourced', 'applied', 'referral', 'import', 'ai_match', 'inbound', 'agency', 'rehire')),
  source_detail text,
  rating int check (rating between 0 and 5),
  /* Free ordering inside a stage, so the board can be dragged into priority. */
  position numeric not null default 0,
  rejection_reason text,
  rejected_at timestamptz,
  stage_changed_at timestamptz not null default now(),
  owner_member_id uuid references public.org_members(id) on delete set null,
  added_by uuid references public.org_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_activity_at timestamptz,
  unique (job_id, person_id)
);
create index if not exists tal_candidates_job_stage_idx on public.tal_candidates (job_id, stage_id, position);
create index if not exists tal_candidates_person_idx on public.tal_candidates (person_id);
create index if not exists tal_candidates_status_idx on public.tal_candidates (status);
create index if not exists tal_candidates_stage_idx on public.tal_candidates (stage_id);

/*
 * Every move, kept forever. Time-in-stage and stage-to-stage conversion are the
 * two numbers a recruiting team actually runs on, and neither can be
 * reconstructed from a current-stage column.
 */
create table if not exists public.tal_candidate_stage_history (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.tal_candidates(id) on delete cascade,
  job_id uuid not null references public.tal_jobs(id) on delete cascade,
  person_id uuid not null references public.tal_people(id) on delete cascade,
  from_stage_id uuid references public.tal_workflow_stages(id) on delete set null,
  to_stage_id uuid references public.tal_workflow_stages(id) on delete set null,
  from_status text,
  to_status text,
  note text,
  changed_by uuid references public.org_members(id) on delete set null,
  changed_at timestamptz not null default now()
);
create index if not exists tal_stage_history_candidate_idx
  on public.tal_candidate_stage_history (candidate_id, changed_at desc);
create index if not exists tal_stage_history_job_idx
  on public.tal_candidate_stage_history (job_id, changed_at desc);

/*
 * Stage changes write their own history and stamp their own clock. Doing it in
 * the database rather than in the action means a change made by an import, an
 * automation or a person all leave the same trail.
 */
create or replace function public.tal_record_stage_change()
returns trigger language plpgsql set search_path to 'public', 'pg_catalog'
as $function$
begin
  if (new.stage_id is distinct from old.stage_id)
     or (new.status is distinct from old.status) then
    new.stage_changed_at = now();
    insert into public.tal_candidate_stage_history
      (candidate_id, job_id, person_id, from_stage_id, to_stage_id, from_status, to_status, changed_by)
    values
      (new.id, new.job_id, new.person_id, old.stage_id, new.stage_id, old.status, new.status,
       coalesce(public.tal_me(), new.owner_member_id));
  end if;
  return new;
end;
$function$;

drop trigger if exists tal_candidates_stage_change on public.tal_candidates;
create trigger tal_candidates_stage_change
  before update on public.tal_candidates
  for each row execute function public.tal_record_stage_change();

/* The first row of history is the one that says where they came in. */
create or replace function public.tal_record_stage_entry()
returns trigger language plpgsql set search_path to 'public', 'pg_catalog'
as $function$
begin
  insert into public.tal_candidate_stage_history
    (candidate_id, job_id, person_id, from_stage_id, to_stage_id, to_status, changed_by)
  values
    (new.id, new.job_id, new.person_id, null, new.stage_id, new.status,
     coalesce(new.added_by, public.tal_me()));
  return new;
end;
$function$;

drop trigger if exists tal_candidates_stage_entry on public.tal_candidates;
create trigger tal_candidates_stage_entry
  after insert on public.tal_candidates
  for each row execute function public.tal_record_stage_entry();

-- ---------------------------------------------------------------------------
-- Triggers and RLS
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'tal_workflows', 'tal_workflow_stages', 'tal_jobs', 'tal_candidates'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format(
      'create trigger %I before update on public.%I
       for each row execute function public.tal_touch_updated_at()', t || '_touch', t);
  end loop;

  foreach t in array array[
    'tal_workflows', 'tal_workflow_stages', 'tal_jobs', 'tal_job_team',
    'tal_job_target_companies', 'tal_candidates', 'tal_candidate_stage_history'
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

-- ---------------------------------------------------------------------------
-- Seed: the workflows a recruiting team starts with
-- ---------------------------------------------------------------------------

/*
 * Two workflows out of the box, both taken from how Loxo ships: a full agency
 * search, and a shorter one for hiring into your own company. Named stages are
 * a starting point -- Settings can rename, reorder and add to them.
 */
insert into public.tal_workflows (name, slug, description, is_default)
values ('Standard Search', 'standard-search',
        'The full agency pipeline, from sourcing through to placement.', true)
on conflict (slug) do nothing;

insert into public.tal_workflows (name, slug, description, is_default)
values ('Internal Hire', 'internal-hire',
        'A shorter pipeline for hiring into Factur itself.', false)
on conflict (slug) do nothing;

insert into public.tal_workflow_stages (workflow_id, name, kind, position, color, is_terminal)
select w.id, s.name, s.kind, s.position, s.color, s.is_terminal
from public.tal_workflows w
cross join (values
  ('Sourced',           'sourced',   0, 'slate',   false),
  ('Contacted',         'contacted', 1, 'sky',     false),
  ('Responded',         'responded', 2, 'cyan',    false),
  ('Qualifying',        'screening', 3, 'indigo',  false),
  ('Submitted',         'submitted', 4, 'violet',  false),
  ('Client Interview',  'interview', 5, 'amber',   false),
  ('Offer',             'offer',     6, 'orange',  false),
  ('Placed',            'placed',    7, 'emerald', true),
  ('Rejected',          'rejected',  8, 'rose',    true)
) as s(name, kind, position, color, is_terminal)
where w.slug = 'standard-search'
  and not exists (select 1 from public.tal_workflow_stages x where x.workflow_id = w.id);

insert into public.tal_workflow_stages (workflow_id, name, kind, position, color, is_terminal)
select w.id, s.name, s.kind, s.position, s.color, s.is_terminal
from public.tal_workflows w
cross join (values
  ('Applied',        'sourced',   0, 'slate',   false),
  ('Screening',      'screening', 1, 'sky',     false),
  ('Interview',      'interview', 2, 'indigo',  false),
  ('Final Interview','interview', 3, 'amber',   false),
  ('Offer',          'offer',     4, 'orange',  false),
  ('Hired',          'placed',    5, 'emerald', true),
  ('Rejected',       'rejected',  6, 'rose',    true)
) as s(name, kind, position, color, is_terminal)
where w.slug = 'internal-hire'
  and not exists (select 1 from public.tal_workflow_stages x where x.workflow_id = w.id);
