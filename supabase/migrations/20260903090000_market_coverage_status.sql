/*
 * Coverage has to be allowed to say "I don't know".
 *
 * The first run of rebuild_client_market_coverage() produced a rail-market
 * coverage of 200% and a heavy-truck coverage of 409%. Neither is a rounding
 * problem. Census counts 220 establishments in NAICS 3365; we hold 440 records
 * labelled "railroad manufacture". An establishment is a physical site and a
 * company can have several, so in a market we genuinely understood, our count
 * should sit BELOW the Census count, never above it.
 *
 * Two things drive it, and both are real:
 *
 *   - The vendor's labels are not NAICS and do not respect its boundaries.
 *     "Railroad manufacture" gets stuck on operators, maintenance shops and
 *     parts distributors, not just the rolling-stock plants NAICS 3365 counts.
 *
 *   - crm_accounts has a country on 373 of 507,688 rows, so nothing can be
 *     restricted to the United States, while the Census denominator is US-only
 *     by construction.
 *
 * At sector scale these wash out -- 203,266 manufacturing-labelled records
 * against 284,452 US manufacturing establishments is 71%, entirely believable.
 * They only bite when a market is narrow, because the adjusted estimate spreads
 * a broad label across its NAICS codes in proportion to how many
 * establishments each holds, and that assumption fails exactly where the label
 * is wrong.
 *
 * So the ratio is published only where it survives two tests: we cannot claim
 * more companies than the Census counts establishments, and the labels
 * involved must be at least a quarter inside the market. Everywhere else
 * coverage_pct is null and coverage_status says which test it failed. A blank
 * with a reason is worth more to a salesperson than 409%.
 *
 * Both tests stop mattering once crm_accounts carries its own NAICS code and
 * country. This is the measurement telling us what the enrichment run is for.
 */

alter table public.client_market_coverage
  add column if not exists coverage_status text;

comment on column public.client_market_coverage.coverage_status is
  'ok | implausible | low_precision | no_records -- why coverage_pct is or is not set';

create or replace function public.rebuild_client_market_coverage(p_vintage smallint default 2023)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  with est as (
    -- '00' is the national roll-up. Size bands are never suppressed; employment is.
    select naics,
           establishments,
           coalesce(n20_49, 0) + coalesce(n50_99, 0) + coalesce(n100_249, 0)
             + coalesce(n250_499, 0) + coalesce(n500_999, 0) + coalesce(n1000, 0) as estab_20plus,
           employees
    from naics_establishments
    where fipstate = '00' and vintage = p_vintage
  ),
  market_tam as (
    select mn.market,
           sum(e.establishments)::integer as tam,
           sum(e.estab_20plus)::integer   as tam_20plus,
           sum(e.employees)::bigint       as emp
    from market_naics mn
    join est e on e.naics = mn.naics
    group by 1
  ),
  label_mass as (
    select cin.industry, sum(e.establishments)::numeric as mass
    from crm_industry_naics cin
    join est e on e.naics = cin.naics
    group by 1
  ),
  /*
   * Hierarchical overlap: a label may be broader than the market (Machinery vs
   * construction machinery) or narrower (Semiconductors vs Electronics), so the
   * shared ground is measured at the deeper of the two codes.
   */
  overlap as (
    select cin.industry,
           mn.market,
           sum(e.establishments)::numeric as mass
    from crm_industry_naics cin
    join market_naics mn
      on mn.naics like cin.naics || '%'
      or cin.naics like mn.naics || '%'
    join est e
      on e.naics = case when length(mn.naics) >= length(cin.naics)
                        then mn.naics else cin.naics end
    group by 1, 2
  ),
  acct as (
    select lower(trim(industry)) as industry,
           count(*)::numeric      as n,
           count(domain)::numeric as n_domain
    from crm_accounts
    where industry is not null
    group by 1
  ),
  client_markets as (
    select distinct ca.salesforce_client_id, mt.market
    from client_attributes ca
    join market_terms mt on mt.term = lower(trim(ca.value))
    where ca.kind = 'market'
  ),
  ours as (
    select cm.salesforce_client_id,
           cm.market,
           sum(a.n)::integer                        as db_accounts,
           sum(a.n_domain)::integer                 as db_with_domain,
           sum(a.n * (o.mass / nullif(lm.mass, 0))) as db_adjusted
    from client_markets cm
    join overlap o     on o.market = cm.market
    join label_mass lm on lm.industry = o.industry
    join acct a        on a.industry = o.industry
    group by 1, 2
  ),
  /*
   * Leads already sent to this client that land in the market. Only the 37% of
   * leads whose Salesforce account resolves to a prospect record can be placed
   * at all, so this is a floor, not a total.
   */
  touched as (
    select l.client__c as salesforce_client_id,
           o.market,
           count(distinct l.accountid)::integer as contacted
    from sf_opp_leads_raw l
    join crm_accounts a on a.salesforce_account_id = l.accountid
    join overlap o      on o.industry = lower(trim(a.industry))
    where l.accountid is not null and a.industry is not null
    group by 1, 2
  ),
  scored as (
    select cm.salesforce_client_id,
           cm.market,
           mt.tam,
           mt.tam_20plus,
           mt.emp,
           coalesce(o.db_accounts, 0)   as db_accounts,
           coalesce(o.db_with_domain, 0) as db_with_domain,
           coalesce(o.db_adjusted, 0)   as db_adjusted,
           coalesce(tc.contacted, 0)    as contacted,
           case when coalesce(o.db_accounts, 0) > 0
                then coalesce(o.db_adjusted, 0) / o.db_accounts end as precision
    from client_markets cm
    join market_tam mt on mt.market = cm.market
    left join ours o     on o.salesforce_client_id = cm.salesforce_client_id and o.market = cm.market
    left join touched tc on tc.salesforce_client_id = cm.salesforce_client_id and tc.market = cm.market
  ),
  judged as (
    select s.*,
           case
             when s.db_accounts = 0            then 'no_records'
             when s.db_adjusted > s.tam        then 'implausible'
             when s.precision < 0.25           then 'low_precision'
             else 'ok'
           end as status
    from scored s
  )
  insert into client_market_coverage as t (
    salesforce_client_id, market, vintage,
    tam_establishments, tam_in_size_band, tam_employees,
    db_accounts, db_with_domain, db_accounts_adjusted, contacted,
    coverage_pct, coverage_precision, coverage_status, computed_at
  )
  select j.salesforce_client_id,
         j.market,
         p_vintage,
         j.tam,
         j.tam_20plus,
         j.emp,
         j.db_accounts,
         j.db_with_domain,
         round(j.db_adjusted, 1),
         j.contacted,
         case when j.status = 'ok' and j.tam > 0
              then round(100 * j.db_adjusted / j.tam, 2) end,
         round(j.precision, 3),
         j.status,
         now()
  from judged j
  on conflict (salesforce_client_id, market, vintage) do update set
    tam_establishments   = excluded.tam_establishments,
    tam_in_size_band     = excluded.tam_in_size_band,
    tam_employees        = excluded.tam_employees,
    db_accounts          = excluded.db_accounts,
    db_with_domain       = excluded.db_with_domain,
    db_accounts_adjusted = excluded.db_accounts_adjusted,
    contacted            = excluded.contacted,
    coverage_pct         = excluded.coverage_pct,
    coverage_precision   = excluded.coverage_precision,
    coverage_status      = excluded.coverage_status,
    computed_at          = excluded.computed_at;

  get diagnostics n = row_count;
  return n;
end;
$$;
