/*
 * Every client Factur has ever had, what kind of business they are, and what
 * we produced for them month by month.
 *
 * Three tables, because the three have different owners and different refresh
 * rhythms:
 *
 *   client_roster           facts Salesforce already knows. Overwritten wholesale
 *                           on every sync; nothing here is ours to edit.
 *   client_profile          what the client's own website says about them.
 *                           Derived once, expensive, and stable for years --
 *                           a machine shop does not stop being a machine shop.
 *   client_monthly_results  counts of what we delivered, by month of the
 *                           engagement. Recomputed from Salesforce opportunities.
 *
 * Kept apart from the sf_*_raw tables on purpose. Coupler drops and recreates
 * those on every run, taking indexes, RLS and any dependent view with them.
 * These are ours and they survive.
 */

-- ---------------------------------------------------------------------------
-- The roster
-- ---------------------------------------------------------------------------

create table if not exists public.client_roster (
  salesforce_client_id text primary key,
  name text not null,
  website text,
  -- Active / Onboarding / Inactive / Hold / Financial Pause.
  status text,
  /*
   * Service__c is a multipicklist, so a client can be two things at once
   * ('LG;Precision Marketing'). Split for filtering, and keep the raw string
   * so nobody has to guess how it was split.
   */
  services text[] not null default '{}',
  services_raw text,
  /*
   * The service whose results we report against. A client on both LG and
   * Precision Marketing is judged on leads; the marketing is support work.
   */
  primary_service text,
  /*
   * Month one of the engagement. Client_Since__c rather than Contract_Start__c:
   * contracts get backdated and renewed mid-flight, and Client_Since is the
   * better populated of the two.
   */
  client_since date,
  client_end date,
  -- Whole months from client_since to client_end, or to today if still running.
  months_elapsed int,
  -- The team's own classification. 22 values, curated by hand, worth trusting.
  type_of_work text,
  salesforce_account_id text,
  employees int,
  annual_revenue numeric,
  industry text,
  synced_at timestamptz not null default now()
);

create index if not exists client_roster_status_idx on public.client_roster (status);
create index if not exists client_roster_since_idx on public.client_roster (client_since);
create index if not exists client_roster_work_idx on public.client_roster (type_of_work);

comment on table public.client_roster is
  'One row per Salesforce Clients__c record, active or long gone.';

-- ---------------------------------------------------------------------------
-- What the website says
-- ---------------------------------------------------------------------------

/*
 * Salesforce knows what type of work a client does for 883 of 987 of them, and
 * their headcount for about two thirds. It does not know what they can actually
 * make -- the processes, the tolerances, the certifications. That only exists
 * on their website, and it is the thing that makes one cohort comparable to
 * another.
 *
 * So this table has two jobs: fill the gaps Salesforce left, and add the
 * capability detail Salesforce never had. Where Salesforce has an answer it
 * wins; see client_cohorts below.
 */
create table if not exists public.client_profile (
  salesforce_client_id text primary key
    references public.client_roster (salesforce_client_id) on delete cascade,
  -- The URL actually read, which may differ from the one on file (redirects).
  website_used text,
  -- Only consulted when client_roster.type_of_work is null.
  business_type text,
  capabilities text[] not null default '{}',
  materials text[] not null default '{}',
  certifications text[] not null default '{}',
  markets_served text[] not null default '{}',
  -- micro (<10) / small (10-49) / mid (50-249) / large (250+).
  size_band text check (size_band in ('micro', 'small', 'mid', 'large')),
  employees_est int,
  summary text,
  confidence text check (confidence in ('high', 'medium', 'low')),
  model text,
  /*
   * A dead domain is a result, not a failure. Recording why we got nothing
   * stops the next run retrying 200 parked domains forever.
   */
  error text,
  enriched_at timestamptz not null default now()
);

comment on table public.client_profile is
  'Business type, capabilities and size read from the client''s own website.';

-- ---------------------------------------------------------------------------
-- Results, by month of the engagement
-- ---------------------------------------------------------------------------

/*
 * month_index 1 is the client's first month, whenever that fell. That is the
 * whole point: it puts a client who started in 2021 next to one who started
 * last spring and asks what each looked like at the same age.
 *
 * Every service produces leads, so leads is never null; appointments, quotes
 * and POs are only meaningful for the services that sell them. A zero here
 * means we counted and found none, not that the metric does not apply -- use
 * client_roster.primary_service to decide which column to read.
 */
create table if not exists public.client_monthly_results (
  salesforce_client_id text not null
    references public.client_roster (salesforce_client_id) on delete cascade,
  month_index int not null check (month_index >= 1),
  month_start date not null,
  leads int not null default 0,
  appointments int not null default 0,
  quotes int not null default 0,
  pos int not null default 0,
  quote_amount numeric not null default 0,
  po_amount numeric not null default 0,
  computed_at timestamptz not null default now(),
  primary key (salesforce_client_id, month_index)
);

create index if not exists client_monthly_results_month_idx
  on public.client_monthly_results (month_index);

comment on table public.client_monthly_results is
  'Opportunities counted into the month of the engagement they landed in.';

-- ---------------------------------------------------------------------------
-- The read model
-- ---------------------------------------------------------------------------

/*
 * One row per client with the cohort dimensions already resolved, so a chart
 * never has to know that type_of_work comes from two places.
 */
create or replace view public.client_cohorts as
  select
    r.salesforce_client_id,
    r.name,
    r.website,
    r.status,
    r.services,
    r.primary_service,
    r.client_since,
    r.client_end,
    r.months_elapsed,
    -- The team's label first; the website only answers when they did not.
    coalesce(r.type_of_work, p.business_type) as business_type,
    (r.type_of_work is null and p.business_type is not null) as business_type_inferred,
    p.capabilities,
    p.materials,
    p.certifications,
    p.markets_served,
    coalesce(r.employees, p.employees_est) as employees,
    coalesce(
      case
        when r.employees is null then null
        when r.employees < 10 then 'micro'
        when r.employees < 50 then 'small'
        when r.employees < 250 then 'mid'
        else 'large'
      end,
      p.size_band
    ) as size_band,
    (r.employees is null and p.size_band is not null) as size_inferred,
    r.annual_revenue,
    r.industry,
    p.summary,
    p.confidence as profile_confidence
  from public.client_roster r
  left join public.client_profile p using (salesforce_client_id);

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

alter table public.client_roster enable row level security;
alter table public.client_profile enable row level security;
alter table public.client_monthly_results enable row level security;

/*
 * Read-only to the application. Everything in here is derived from Salesforce
 * or from a public website, so there is nothing a Factur user should not see,
 * and nothing any of them should be writing by hand -- the loaders use the
 * service role.
 */
drop policy if exists client_roster_read on public.client_roster;
create policy client_roster_read on public.client_roster
  for select using (public.is_factur_user());

drop policy if exists client_profile_read on public.client_profile;
create policy client_profile_read on public.client_profile
  for select using (public.is_factur_user());

drop policy if exists client_monthly_results_read on public.client_monthly_results;
create policy client_monthly_results_read on public.client_monthly_results
  for select using (public.is_factur_user());

grant select on public.client_roster to authenticated;
grant select on public.client_profile to authenticated;
grant select on public.client_monthly_results to authenticated;
grant select on public.client_cohorts to authenticated;
