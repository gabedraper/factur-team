/*
 * rebuild_client_market_coverage() -- the third layer, precomputed.
 *
 * Answers, for every client and every market they sell into: how many
 * companies exist, how many we hold, and how many we have actually put in
 * front of them.
 *
 * The hard part is that the two sides of the ratio are described at different
 * levels of NAICS. A market can be one six-digit code (333120, construction
 * machinery); a prospect's label is never finer than a four-digit group and is
 * usually broader ("Machinery" is all of 333). Equality joins between them
 * find nothing, so the overlap here is hierarchical: one code covers another
 * when it is a prefix of it, and the shared mass is whichever code is deeper.
 * That is only safe because sync-market-taxonomy.mjs guarantees no code inside
 * a single list contains another -- otherwise the same establishments would be
 * summed twice.
 *
 * Out of that falls the number that makes this honest. If the label "Machinery"
 * spans 21,668 establishments and only 2,805 of them are inside the client's
 * market, then a prospect carrying that label has roughly a 13% chance of
 * actually being a buyer. db_accounts is the upper bound -- every record that
 * COULD be in the market. db_accounts_adjusted weights each label by that
 * share, and is the better estimate. The truth is between them, and the gap
 * closes only when crm_accounts carries a real NAICS code of its own.
 *
 * Establishment counts are used throughout rather than employment, because
 * Census suppresses employment in small cells and a suppressed cell would
 * quietly drop out of a sum.
 */
alter table public.client_market_coverage
  add column if not exists db_accounts_adjusted numeric;

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
  -- How much of the economy a prospect label covers in total.
  label_mass as (
    select cin.industry, sum(e.establishments)::numeric as mass
    from crm_industry_naics cin
    join est e on e.naics = cin.naics
    group by 1
  ),
  /*
   * How much of that sits inside a given market. The join is deliberately
   * two-directional: a label may be broader than the market (Machinery vs
   * construction machinery) or narrower (Semiconductors vs Electronics).
   * Either way the shared ground is measured at the deeper of the two codes.
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
           count(*)::numeric        as n,
           count(domain)::numeric   as n_domain
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
           sum(a.n)::integer                                        as db_accounts,
           sum(a.n_domain)::integer                                 as db_with_domain,
           sum(a.n * (o.mass / nullif(lm.mass, 0)))                 as db_adjusted
    from client_markets cm
    join overlap o     on o.market = cm.market
    join label_mass lm on lm.industry = o.industry
    join acct a        on a.industry = o.industry
    group by 1, 2
  ),
  /*
   * Leads already sent to this client that land in the market. Only the 37% of
   * leads whose Salesforce account resolves to a prospect record can be placed
   * at all, so this undercounts -- it is a floor, not a total.
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
  )
  insert into client_market_coverage as t (
    salesforce_client_id, market, vintage,
    tam_establishments, tam_in_size_band, tam_employees,
    db_accounts, db_with_domain, db_accounts_adjusted, contacted,
    coverage_pct, coverage_precision, computed_at
  )
  select cm.salesforce_client_id,
         cm.market,
         p_vintage,
         mt.tam,
         mt.tam_20plus,
         mt.emp,
         coalesce(o.db_accounts, 0),
         coalesce(o.db_with_domain, 0),
         round(coalesce(o.db_adjusted, 0), 1),
         coalesce(tc.contacted, 0),
         case when mt.tam > 0
              then round(100 * coalesce(o.db_adjusted, 0) / mt.tam, 2) end,
         case when coalesce(o.db_accounts, 0) > 0
              then round(coalesce(o.db_adjusted, 0) / o.db_accounts, 3) end,
         now()
  from client_markets cm
  join market_tam mt on mt.market = cm.market
  left join ours o   on o.salesforce_client_id = cm.salesforce_client_id and o.market = cm.market
  left join touched tc on tc.salesforce_client_id = cm.salesforce_client_id and tc.market = cm.market
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
    computed_at          = excluded.computed_at;

  get diagnostics n = row_count;
  return n;
end;
$$;

comment on function public.rebuild_client_market_coverage(smallint) is
  'Repopulates client_market_coverage from the Census release and the two NAICS maps. Safe to re-run.';
