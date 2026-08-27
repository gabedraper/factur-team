/*
 * The money end: placements, how the fee is split, and the business-development
 * pipeline that wins the job in the first place.
 *
 * Loxo keeps deals in the same system as jobs because the BD conversation and
 * the search that follows it are the same relationship. A Deal here is a job
 * order being won; when it closes it becomes a Job.
 */

-- ---------------------------------------------------------------------------
-- Placements
-- ---------------------------------------------------------------------------

/*
 * A placement is the fact of a hire, kept apart from the candidate row that
 * produced it. It outlives the pipeline: guarantee periods, fall-offs and
 * invoices all belong to a hire, not to a card on a board.
 */
create table if not exists public.tal_placements (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.tal_jobs(id) on delete restrict,
  candidate_id uuid references public.tal_candidates(id) on delete set null,
  person_id uuid not null references public.tal_people(id) on delete restrict,
  company_id uuid references public.tal_companies(id) on delete set null,
  title text,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'completed', 'fell_off', 'cancelled')),
  started_on date,
  ended_on date,
  /* A fall-off inside the guarantee is usually not billable; the date is the test. */
  guarantee_days int not null default 90,
  guarantee_ends_on date generated always as (
    case when started_on is not null then started_on + guarantee_days else null end
  ) stored,
  salary numeric(12,2),
  salary_currency text not null default 'USD',
  fee_type text not null default 'percentage' check (fee_type in ('percentage', 'flat', 'hourly_markup')),
  fee_percent numeric(5,2),
  fee_amount numeric(12,2),
  bill_rate numeric(10,2),
  pay_rate numeric(10,2),
  invoice_status text not null default 'not_invoiced'
    check (invoice_status in ('not_invoiced', 'invoiced', 'paid', 'written_off')),
  invoiced_on date,
  paid_on date,
  notes text,
  fell_off_on date,
  fell_off_reason text,
  created_by uuid references public.org_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tal_placements_job_idx on public.tal_placements (job_id);
create index if not exists tal_placements_person_idx on public.tal_placements (person_id);
create index if not exists tal_placements_started_idx on public.tal_placements (started_on desc);

/*
 * Who gets credit. Percentages are not forced to total 100 in the database --
 * splits get entered a piece at a time and a constraint that fires halfway
 * through is worse than a screen that says the total is 80%.
 */
create table if not exists public.tal_placement_splits (
  id uuid primary key default gen_random_uuid(),
  placement_id uuid not null references public.tal_placements(id) on delete cascade,
  member_id uuid not null references public.org_members(id) on delete cascade,
  role text not null default 'recruiter'
    check (role in ('sourcer', 'recruiter', 'account_manager', 'business_development', 'coordinator')),
  percent numeric(5,2) not null default 0 check (percent >= 0 and percent <= 100),
  created_at timestamptz not null default now(),
  unique (placement_id, member_id, role)
);

-- ---------------------------------------------------------------------------
-- Deals: the business-development pipeline
-- ---------------------------------------------------------------------------

create table if not exists public.tal_deals (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company_id uuid references public.tal_companies(id) on delete set null,
  contact_person_id uuid references public.tal_people(id) on delete set null,
  owner_member_id uuid references public.org_members(id) on delete set null,
  stage text not null default 'new'
    check (stage in ('new', 'qualifying', 'proposal', 'negotiation', 'won', 'lost')),
  status text not null default 'open' check (status in ('open', 'won', 'lost')),
  value numeric(12,2),
  probability int check (probability between 0 and 100),
  expected_close_on date,
  closed_at timestamptz,
  lost_reason text,
  source text,
  notes text,
  /* Set when a won deal turns into a search, so the two are not retyped. */
  job_id uuid references public.tal_jobs(id) on delete set null,
  created_by uuid references public.org_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_activity_at timestamptz
);
create index if not exists tal_deals_stage_idx on public.tal_deals (stage) where status = 'open';
create index if not exists tal_deals_company_idx on public.tal_deals (company_id);
create index if not exists tal_deals_owner_idx on public.tal_deals (owner_member_id);

/* Deals join the one timeline like everything else. */
alter table public.tal_activities
  add column if not exists deal_id uuid references public.tal_deals(id) on delete cascade;
create index if not exists tal_activities_deal_idx on public.tal_activities (deal_id, occurred_at desc);

alter table public.tal_tasks
  add column if not exists deal_id uuid references public.tal_deals(id) on delete cascade;

-- ---------------------------------------------------------------------------
-- Triggers and RLS
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['tal_placements', 'tal_deals'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format(
      'create trigger %I before update on public.%I
       for each row execute function public.tal_touch_updated_at()', t || '_touch', t);
  end loop;

  foreach t in array array['tal_placements', 'tal_placement_splits', 'tal_deals'] loop
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
