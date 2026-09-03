/*
 * The one number a client actually asks for: how big is my market, in total.
 *
 * It is not the sum of the per-market rows. A shop selling into both Off-Road
 * Equipment and Construction Equipment has 333120 sitting in each, and adding
 * the rows counts those establishments twice. Worse, a market defined on a
 * four-digit code and another defined on one of its six-digit children overlap
 * without sharing a code at all, so plain DISTINCT does not save you either.
 *
 * So the union is collapsed hierarchically first: a code is dropped when some
 * other code in the same client's set already contains it. What survives is a
 * non-overlapping set, and only then is it safe to sum.
 *
 * Stored as a '(all)' row in client_market_coverage rather than a separate
 * table -- same grain, same vintage, same freshness, and the report reads one
 * table instead of two.
 */
create or replace function public.rebuild_client_market_totals(p_vintage smallint default 2023)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  with est as (
    select naics,
           establishments,
           coalesce(n20_49, 0) + coalesce(n50_99, 0) + coalesce(n100_249, 0)
             + coalesce(n250_499, 0) + coalesce(n500_999, 0) + coalesce(n1000, 0) as estab_20plus,
           employees
    from naics_establishments
    where fipstate = '00' and vintage = p_vintage
  ),
  client_markets as (
    select distinct ca.salesforce_client_id, mt.market
    from client_attributes ca
    join market_terms mt on mt.term = lower(trim(ca.value))
    where ca.kind = 'market'
  ),
  client_codes as (
    select distinct cm.salesforce_client_id, mn.naics
    from client_markets cm
    join market_naics mn on mn.market = cm.market
  ),
  -- Drop any code already contained by another in the same client's set.
  client_roots as (
    select c.salesforce_client_id, c.naics
    from client_codes c
    where not exists (
      select 1 from client_codes p
      where p.salesforce_client_id = c.salesforce_client_id
        and p.naics <> c.naics
        and c.naics like p.naics || '%'
    )
  ),
  totals as (
    select r.salesforce_client_id,
           sum(e.establishments)::integer as tam,
           sum(e.estab_20plus)::integer   as tam_20plus,
           sum(e.employees)::bigint       as emp
    from client_roots r
    join est e on e.naics = r.naics
    group by 1
  ),
  label_mass as (
    select cin.industry, sum(e.establishments)::numeric as mass
    from crm_industry_naics cin
    join est e on e.naics = cin.naics
    group by 1
  ),
  /*
   * How much of each prospect label falls inside this client's whole universe.
   * client_roots is non-overlapping, so the same establishment cannot be
   * reached through two different roots and the sum stays honest.
   */
  overlap as (
    select cin.industry,
           r.salesforce_client_id,
           sum(e.establishments)::numeric as mass
    from crm_industry_naics cin
    join client_roots r
      on r.naics like cin.naics || '%'
      or cin.naics like r.naics || '%'
    join est e
      on e.naics = case when length(r.naics) >= length(cin.naics)
                        then r.naics else cin.naics end
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
  ours as (
    select o.salesforce_client_id,
           sum(a.n)::integer                        as db_accounts,
           sum(a.n_domain)::integer                 as db_with_domain,
           sum(a.n * (o.mass / nullif(lm.mass, 0))) as db_adjusted
    from overlap o
    join label_mass lm on lm.industry = o.industry
    join acct a        on a.industry = o.industry
    group by 1
  ),
  touched as (
    select l.client__c as salesforce_client_id,
           count(distinct l.accountid)::integer as contacted
    from sf_opp_leads_raw l
    join crm_accounts a on a.salesforce_account_id = l.accountid
    join overlap o      on o.industry = lower(trim(a.industry))
                       and o.salesforce_client_id = l.client__c
    where l.accountid is not null and a.industry is not null
    group by 1
  ),
  judged as (
    select t.salesforce_client_id,
           t.tam, t.tam_20plus, t.emp,
           coalesce(o.db_accounts, 0)    as db_accounts,
           coalesce(o.db_with_domain, 0) as db_with_domain,
           coalesce(o.db_adjusted, 0)    as db_adjusted,
           coalesce(tc.contacted, 0)     as contacted,
           case when coalesce(o.db_accounts, 0) > 0
                then coalesce(o.db_adjusted, 0) / o.db_accounts end as precision
    from totals t
    left join ours o     on o.salesforce_client_id = t.salesforce_client_id
    left join touched tc on tc.salesforce_client_id = t.salesforce_client_id
  )
  insert into client_market_coverage as t (
    salesforce_client_id, market, vintage,
    tam_establishments, tam_in_size_band, tam_employees,
    db_accounts, db_with_domain, db_accounts_adjusted, contacted,
    coverage_pct, coverage_precision, coverage_status, computed_at
  )
  select j.salesforce_client_id,
         '(all)',
         p_vintage,
         j.tam, j.tam_20plus, j.emp,
         j.db_accounts, j.db_with_domain, round(j.db_adjusted, 1), j.contacted,
         case when j.db_accounts > 0 and j.db_adjusted <= j.tam and j.precision >= 0.25
                   and j.tam > 0
              then round(100 * j.db_adjusted / j.tam, 2) end,
         round(j.precision, 3),
         case
           when j.db_accounts = 0     then 'no_records'
           when j.db_adjusted > j.tam then 'implausible'
           when j.precision < 0.25    then 'low_precision'
           else 'ok'
         end,
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

comment on function public.rebuild_client_market_totals(smallint) is
  'Adds the deduplicated (all) row per client. Run after rebuild_client_market_coverage().';
