/*
 * A talent system, shaped after Loxo.
 *
 * The vocabulary is deliberately theirs -- People, Companies, Jobs, Candidates,
 * Placements -- because the point of the exercise is that somebody who has used
 * Loxo can sit down in front of this and already know where things are. Every
 * table is prefixed `tal_` so it reads as one system in a database that already
 * holds training, scoreboards and client health.
 *
 * The single most important idea borrowed from Loxo: there is one Person
 * record. A hiring manager, a candidate and a referral source are the same kind
 * of row, and what they are to you is a matter of context rather than of which
 * table they live in. Everything else hangs off that.
 *
 * This first file is the record-keeping half: who exists, where they worked,
 * what is attached to them, and how records get labelled.
 */

-- ---------------------------------------------------------------------------
-- Who may do what
-- ---------------------------------------------------------------------------

/*
 * Three capabilities, in the same shape as every other permission in the app,
 * so they appear in Settings -> Roles with no extra work.
 *
 * `talent.view` is read-only and is what a manager or a delivery lead wants.
 * `talent.recruit` is the working right. `talent.admin` covers the pieces that
 * change how the system behaves for everyone -- workflows, automations, the
 * careers page, integrations.
 */
insert into public.org_permissions (key, name, description, category, position)
values
  ('talent.view',    'View talent',        'See people, jobs and pipelines in the talent system.', 'Talent', 1),
  ('talent.recruit', 'Work talent',        'Add and edit people, jobs, candidates and placements; log activity; send outreach.', 'Talent', 2),
  ('talent.admin',   'Administer talent',  'Configure workflows, stages, automations, templates, the careers page and integrations.', 'Talent', 3)
on conflict (key) do update
  set name = excluded.name,
      description = excluded.description,
      category = excluded.category,
      position = excluded.position;

/*
 * Two helpers rather than repeating the permission list on forty policies.
 * They are STABLE and lean on has_permission(), which is already the app's one
 * answer to "may this person do X".
 */
create or replace function public.tal_can_view()
returns boolean language sql stable set search_path to 'public', 'pg_catalog'
as $function$
  select public.is_factur_user() and (
    public.has_permission('talent.view')
    or public.has_permission('talent.recruit')
    or public.has_permission('talent.admin')
    or public.has_permission('org.manage')
  );
$function$;

create or replace function public.tal_can_edit()
returns boolean language sql stable set search_path to 'public', 'pg_catalog'
as $function$
  select public.is_factur_user() and (
    public.has_permission('talent.recruit')
    or public.has_permission('talent.admin')
    or public.has_permission('org.manage')
  );
$function$;

create or replace function public.tal_can_admin()
returns boolean language sql stable set search_path to 'public', 'pg_catalog'
as $function$
  select public.is_factur_user() and (
    public.has_permission('talent.admin') or public.has_permission('org.manage')
  );
$function$;

/* Every tal_ table carries updated_at; one trigger function serves them all. */
create or replace function public.tal_touch_updated_at()
returns trigger language plpgsql set search_path to 'public', 'pg_catalog'
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

/*
 * The member row for whoever is calling, used as the default author on
 * anything created through the API. Returns null for the service client, which
 * is correct -- an import has no author.
 */
create or replace function public.tal_me()
returns uuid language sql stable set search_path to 'public', 'pg_catalog'
as $function$
  select id from public.org_members where auth_user_id = auth.uid() and active limit 1;
$function$;

-- ---------------------------------------------------------------------------
-- Companies
-- ---------------------------------------------------------------------------

/*
 * An employer, a prospect, or a company being sourced out of. Loxo makes no
 * distinction between the three at the record level and neither does this --
 * `kind` is a label on one row, not three tables, because the same company is
 * routinely all three at once.
 *
 * `org_client_id` is the join back to Factur's own client list. It is a link,
 * never a copy: the client list stays the source of truth for who Factur
 * serves.
 */
create table if not exists public.tal_companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  domain text,
  website text,
  linkedin_url text,
  description text,
  industry text,
  headcount_label text,
  city text,
  state text,
  country text,
  phone text,
  logo_url text,
  kind text not null default 'prospect'
    check (kind in ('client', 'prospect', 'target', 'vendor', 'internal')),
  status text not null default 'active'
    check (status in ('active', 'inactive', 'off_limits')),
  org_client_id uuid references public.org_clients(id) on delete set null,
  owner_member_id uuid references public.org_members(id) on delete set null,
  created_by uuid references public.org_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_activity_at timestamptz,
  search_tsv tsvector generated always as (
    to_tsvector('english',
      coalesce(name, '') || ' ' || coalesce(domain, '') || ' ' ||
      coalesce(industry, '') || ' ' || coalesce(city, '') || ' ' ||
      coalesce(state, '') || ' ' || coalesce(description, ''))
  ) stored
);

create unique index if not exists tal_companies_domain_key
  on public.tal_companies (lower(domain)) where domain is not null and domain <> '';
create index if not exists tal_companies_name_idx on public.tal_companies (lower(name));
create index if not exists tal_companies_search_idx on public.tal_companies using gin (search_tsv);
create index if not exists tal_companies_owner_idx on public.tal_companies (owner_member_id);

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------

/*
 * One row per human. `person_types` says what they are to us and is an array
 * on purpose: a hiring manager who is also open to a move is both, and forcing
 * a choice there is exactly the modelling mistake that makes recruiting
 * databases go stale.
 *
 * Emails and phones are jsonb arrays of {value, type, primary} rather than
 * columns, because people have three of each and the second one is the one
 * that works. The first entry is promoted to a generated column so the lists
 * and the unique-ish lookups have something flat to index.
 */
create table if not exists public.tal_people (
  id uuid primary key default gen_random_uuid(),
  first_name text,
  last_name text,
  name text generated always as (
    btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))
  ) stored,
  title text,
  company_id uuid references public.tal_companies(id) on delete set null,
  company_name text,
  emails jsonb not null default '[]'::jsonb,
  phones jsonb not null default '[]'::jsonb,
  primary_email text generated always as (
    lower(nullif(btrim(coalesce(emails -> 0 ->> 'value', '')), ''))
  ) stored,
  primary_phone text generated always as (
    nullif(btrim(coalesce(phones -> 0 ->> 'value', '')), '')
  ) stored,
  linkedin_url text,
  github_url text,
  personal_website text,
  city text,
  state text,
  country text,
  person_types text[] not null default array['candidate']::text[],
  skills text[] not null default '{}'::text[],
  summary text,
  resume_text text,
  seniority text,
  years_experience numeric(4,1),
  current_salary numeric(12,2),
  salary_expectation numeric(12,2),
  compensation_notes text,
  /*
   * Loxo's Readiness Score in spirit: how complete and how warm this record is.
   * Kept as a plain integer written by the app rather than a generated column,
   * because the ingredients (recency of contact, resume on file, reachability)
   * live in three other tables.
   */
  readiness_score int check (readiness_score between 0 and 100),
  source text not null default 'manual',
  source_detail text,
  do_not_contact boolean not null default false,
  unsubscribed_at timestamptz,
  owner_member_id uuid references public.org_members(id) on delete set null,
  created_by uuid references public.org_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_activity_at timestamptz,
  merged_into_id uuid references public.tal_people(id) on delete set null,
  search_tsv tsvector generated always as (
    to_tsvector('english',
      coalesce(first_name, '') || ' ' || coalesce(last_name, '') || ' ' ||
      coalesce(title, '') || ' ' || coalesce(company_name, '') || ' ' ||
      coalesce(city, '') || ' ' || coalesce(state, '') || ' ' ||
      coalesce(summary, '') || ' ' || coalesce(resume_text, ''))
  ) stored
);

create index if not exists tal_people_name_idx on public.tal_people (lower(name));
create index if not exists tal_people_email_idx on public.tal_people (primary_email);
create index if not exists tal_people_company_idx on public.tal_people (company_id);
create index if not exists tal_people_owner_idx on public.tal_people (owner_member_id);
create index if not exists tal_people_search_idx on public.tal_people using gin (search_tsv);
create index if not exists tal_people_skills_idx on public.tal_people using gin (skills);
create index if not exists tal_people_types_idx on public.tal_people using gin (person_types);
create index if not exists tal_people_activity_idx on public.tal_people (last_activity_at desc nulls last);
/* Merged records are kept, not deleted, so old links still resolve. */
create index if not exists tal_people_merged_idx on public.tal_people (merged_into_id) where merged_into_id is not null;

-- ---------------------------------------------------------------------------
-- Work history and education
-- ---------------------------------------------------------------------------

create table if not exists public.tal_person_jobs (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.tal_people(id) on delete cascade,
  company_id uuid references public.tal_companies(id) on delete set null,
  company_name text,
  title text,
  description text,
  location text,
  started_on date,
  ended_on date,
  is_current boolean not null default false,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tal_person_jobs_person_idx on public.tal_person_jobs (person_id, position);
create index if not exists tal_person_jobs_company_idx on public.tal_person_jobs (company_id);

create table if not exists public.tal_person_educations (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.tal_people(id) on delete cascade,
  school text,
  degree text,
  field_of_study text,
  started_on date,
  ended_on date,
  description text,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tal_person_educations_person_idx on public.tal_person_educations (person_id, position);

-- ---------------------------------------------------------------------------
-- Documents
-- ---------------------------------------------------------------------------

/*
 * Files live in Supabase Storage; this table is the index. `storage_path` is
 * the only link, so a row without a matching object is a broken attachment
 * rather than a silently empty one.
 */
create table if not exists public.tal_documents (
  id uuid primary key default gen_random_uuid(),
  person_id uuid references public.tal_people(id) on delete cascade,
  company_id uuid references public.tal_companies(id) on delete cascade,
  job_id uuid,
  name text not null,
  kind text not null default 'other'
    check (kind in ('resume', 'cover_letter', 'portfolio', 'contract', 'reference', 'other')),
  storage_path text,
  external_url text,
  mime_type text,
  size_bytes bigint,
  is_primary boolean not null default false,
  extracted_text text,
  uploaded_by uuid references public.org_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tal_documents_person_idx on public.tal_documents (person_id, created_at desc);
create index if not exists tal_documents_job_idx on public.tal_documents (job_id);
/* At most one primary resume per person, enforced rather than hoped for. */
create unique index if not exists tal_documents_one_primary_resume
  on public.tal_documents (person_id) where is_primary and kind = 'resume';

-- ---------------------------------------------------------------------------
-- Tags
-- ---------------------------------------------------------------------------

/*
 * Colour-coded tags as their own records, the way Loxo does them, rather than
 * a text[] on each table. Renaming a tag then renames it everywhere, and the
 * colour has somewhere to live.
 */
create table if not exists public.tal_tags (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  color text not null default 'slate',
  scope text not null default 'all' check (scope in ('all', 'person', 'company', 'job')),
  created_by uuid references public.org_members(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists tal_tags_label_key on public.tal_tags (lower(label), scope);

create table if not exists public.tal_tag_links (
  tag_id uuid not null references public.tal_tags(id) on delete cascade,
  entity_type text not null check (entity_type in ('person', 'company', 'job')),
  entity_id uuid not null,
  created_by uuid references public.org_members(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (tag_id, entity_type, entity_id)
);
create index if not exists tal_tag_links_entity_idx on public.tal_tag_links (entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- Dynamic (custom) fields
-- ---------------------------------------------------------------------------

/*
 * Loxo's Dynamic Fields. Definitions and values are split so that adding a
 * field is a settings change rather than a migration, which is the whole point
 * of having them.
 */
create table if not exists public.tal_dynamic_fields (
  id uuid primary key default gen_random_uuid(),
  entity text not null check (entity in ('person', 'company', 'job', 'candidate', 'placement')),
  key text not null,
  label text not null,
  field_type text not null default 'text'
    check (field_type in ('text', 'textarea', 'number', 'date', 'select', 'multiselect', 'boolean', 'url', 'email', 'phone', 'currency')),
  options jsonb not null default '[]'::jsonb,
  help_text text,
  required boolean not null default false,
  position int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists tal_dynamic_fields_key on public.tal_dynamic_fields (entity, key);

create table if not exists public.tal_dynamic_values (
  field_id uuid not null references public.tal_dynamic_fields(id) on delete cascade,
  entity_id uuid not null,
  value jsonb,
  updated_by uuid references public.org_members(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (field_id, entity_id)
);
create index if not exists tal_dynamic_values_entity_idx on public.tal_dynamic_values (entity_id);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'tal_companies', 'tal_people', 'tal_person_jobs', 'tal_person_educations',
    'tal_documents', 'tal_dynamic_fields'
  ] loop
    execute format(
      'drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format(
      'create trigger %I before update on public.%I
       for each row execute function public.tal_touch_updated_at()', t || '_touch', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

/*
 * Reading is gated on the talent permissions rather than on ownership. A
 * recruiting database whose rows are private to whoever typed them in is the
 * failure mode this whole system exists to avoid -- the value is that everyone
 * can see the candidate was already spoken to in March.
 */
do $$
declare t text;
begin
  foreach t in array array[
    'tal_companies', 'tal_people', 'tal_person_jobs', 'tal_person_educations',
    'tal_documents', 'tal_tags', 'tal_tag_links', 'tal_dynamic_fields', 'tal_dynamic_values'
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
