/*
 * Market intelligence: how big is a client's market, and how much of it do we
 * already hold?
 *
 * Three layers, and they only mean anything stacked in this order:
 *
 *   1. naics_industries / naics_establishments -- the outside world's count of
 *      how many companies exist, by industry and state. Straight from the
 *      Census County Business Patterns release. This is the denominator, and
 *      the only number in here that nobody at Factur can argue with.
 *
 *   2. market_naics / crm_industry_naics -- the two translation tables. Clients
 *      describe their market in their own words ("Off-Road Equipment") and our
 *      prospect records carry a LinkedIn-style label ("Machinery"). Neither is
 *      NAICS. Both have to be mapped by hand before any ratio is honest, and
 *      those maps are data, not code, so a salesperson can fix one without a
 *      deploy.
 *
 *   3. client_market_coverage -- the answer, precomputed per client. Never
 *      compute this live. The join behind it touches half a million prospect
 *      rows and the visibility map on that table goes stale between vacuums,
 *      which is exactly how the scoreboard earned its statement timeouts.
 *
 * A caution that belongs in the schema and not just in the deck: our side of
 * the ratio is an UPPER BOUND. crm_accounts.industry has 172 possible values
 * for the whole economy, so "Machinery" covers a dozen NAICS codes at once and
 * we cannot yet say which one a given company sits in. coverage_precision
 * records how loose that is per row. Enriching crm_accounts with a real NAICS
 * code is what turns the upper bound into a number, and until that lands every
 * surface showing this data has to say so.
 */

-- 1. The outside world -----------------------------------------------------

create table if not exists public.naics_industries (
  code text primary key,                -- trimmed: '333', '3331', '333120'
  level smallint not null,              -- 2..6, the digit count
  parent_code text,
  title text not null
);

create index if not exists naics_industries_level_idx on public.naics_industries(level);
create index if not exists naics_industries_parent_idx on public.naics_industries(parent_code);

create table if not exists public.naics_establishments (
  fipstate text not null,               -- '39'; '00' is the national roll-up
  state_code text,                      -- 'OH'; null for the national row
  naics text not null references public.naics_industries(code) on delete cascade,
  vintage smallint not null,            -- CBP reference year

  establishments integer not null,
  employees bigint,
  annual_payroll bigint,                -- thousands of dollars, as published

  -- Establishment counts by headcount band. Census suppresses employment and
  -- payroll in small cells but publishes these counts everywhere, which is why
  -- the size filter on a TAM leans on them rather than on `employees`.
  n1_4 integer, n5_9 integer, n10_19 integer, n20_49 integer,
  n50_99 integer, n100_249 integer, n250_499 integer,
  n500_999 integer, n1000 integer,

  primary key (fipstate, naics, vintage)
);

create index if not exists naics_establishments_naics_idx
  on public.naics_establishments(naics, vintage);

/*
 * Sector trend lines -- Fed industrial production and Census new orders,
 * keyed to the NAICS code they describe so a client's market chart is a
 * lookup, not a hand-picked series per client.
 */
create table if not exists public.naics_indicators (
  series_id text not null,              -- 'IPG3364S'
  naics text not null references public.naics_industries(code) on delete cascade,
  metric text not null,                 -- 'industrial_production' | 'new_orders'
  source text not null,                 -- 'FRED'
  period date not null,
  value numeric not null,
  primary key (series_id, period)
);

create index if not exists naics_indicators_naics_idx
  on public.naics_indicators(naics, metric, period);

comment on table public.naics_indicators is
  'Monthly sector activity. Index values are relative to the series base year, not counts.';

-- 2. The two translation tables --------------------------------------------

/*
 * Clients say "Oil & Gas", "Oil And Gas" and "Oil and gas" and mean one thing.
 * market_terms folds the 540 free-text values in client_attributes onto a
 * canonical market; market_naics says what that market is in NAICS.
 */
create table if not exists public.market_terms (
  term text primary key,                -- lower(trim(client_attributes.value))
  market text not null
);

create index if not exists market_terms_market_idx on public.market_terms(market);

create table if not exists public.market_naics (
  market text not null,
  naics text not null references public.naics_industries(code) on delete cascade,
  primary key (market, naics)
);

/*
 * The same job on our own side of the ratio: what does a prospect record's
 * industry label mean in NAICS. `spans` is how many 4-digit codes the label
 * touches in total -- a label that spans 30 codes tells you very little about
 * any one company carrying it, and that is the number coverage_precision is
 * built from.
 */
create table if not exists public.crm_industry_naics (
  industry text not null,               -- lower(trim(crm_accounts.industry))
  naics text not null references public.naics_industries(code) on delete cascade,
  primary key (industry, naics)
);

-- 3. The answer -------------------------------------------------------------

create table if not exists public.client_market_coverage (
  salesforce_client_id text not null,
  market text not null,
  vintage smallint not null,

  -- The market, per Census
  tam_establishments integer not null,
  tam_in_size_band integer,             -- establishments matching the size filter
  tam_employees bigint,

  -- Our side
  db_accounts integer not null,         -- prospect records whose label lands here
  db_with_domain integer not null,
  contacted integer not null default 0, -- accounts this client has been given as leads

  coverage_pct numeric,                 -- db_accounts / tam_establishments
  coverage_precision numeric,           -- 0..1; 1 = labels are exact, low = loose

  computed_at timestamptz not null default now(),
  primary key (salesforce_client_id, market, vintage)
);

create index if not exists client_market_coverage_client_idx
  on public.client_market_coverage(salesforce_client_id);

-- Access --------------------------------------------------------------------

/*
 * All five reference tables are public knowledge or hand-built maps: every
 * Factur user reads them, nobody writes them through the API. The loaders run
 * with the service role and bypass RLS, same as the sf_*_raw staging tables.
 *
 * client_market_coverage is about a specific client, so it follows the same
 * rule every other client-scoped table does.
 */
alter table public.naics_industries enable row level security;
alter table public.naics_establishments enable row level security;
alter table public.naics_indicators enable row level security;
alter table public.market_terms enable row level security;
alter table public.market_naics enable row level security;
alter table public.crm_industry_naics enable row level security;
alter table public.client_market_coverage enable row level security;

create policy naics_industries_read on public.naics_industries
  for select to authenticated using (public.is_factur_user());

create policy naics_establishments_read on public.naics_establishments
  for select to authenticated using (public.is_factur_user());

create policy naics_indicators_read on public.naics_indicators
  for select to authenticated using (public.is_factur_user());

create policy market_terms_read on public.market_terms
  for select to authenticated using (public.is_factur_user());

create policy market_naics_read on public.market_naics
  for select to authenticated using (public.is_factur_user());

create policy crm_industry_naics_read on public.crm_industry_naics
  for select to authenticated using (public.is_factur_user());

/*
 * The maps are the one thing here a human is expected to correct, so anyone
 * who can manage the org can edit them in place.
 */
create policy market_terms_write on public.market_terms
  for all to authenticated
  using (public.is_factur_user() and public.has_permission('org.manage'))
  with check (public.is_factur_user() and public.has_permission('org.manage'));

create policy market_naics_write on public.market_naics
  for all to authenticated
  using (public.is_factur_user() and public.has_permission('org.manage'))
  with check (public.is_factur_user() and public.has_permission('org.manage'));

create policy crm_industry_naics_write on public.crm_industry_naics
  for all to authenticated
  using (public.is_factur_user() and public.has_permission('org.manage'))
  with check (public.is_factur_user() and public.has_permission('org.manage'));

create policy client_market_coverage_read on public.client_market_coverage
  for select to authenticated using (public.is_factur_user());
