/*
 * What an opportunity's quotes and orders add up to, on the opportunity.
 *
 * List views filter, sort and export on columns of the opportunities table;
 * PostgREST cannot sort a list by a to-many embed, and "has a purchase order"
 * is a question people ask of a list, not of one record. So the few numbers a
 * list needs are kept on the row and refreshed by the same run that brings the
 * quotes and orders in: counts, totals, and the latest of each.
 *
 * Refreshed for every opportunity whose quotes or orders were touched since
 * p_since -- which after the three-minute sync is a handful -- and for all of
 * them when p_since is null.
 */

alter table public.opportunities
  add column if not exists quote_count         integer,
  add column if not exists quotes_total        numeric,
  add column if not exists latest_quote_on     date,
  add column if not exists latest_quote_status text,
  add column if not exists latest_quote_amount numeric,
  add column if not exists order_count         integer,
  add column if not exists orders_total        numeric,
  add column if not exists latest_order_on     date,
  add column if not exists latest_order_amount numeric;

create index if not exists opportunities_order_count_idx on public.opportunities (order_count) where order_count > 0;
create index if not exists opportunities_quote_count_idx on public.opportunities (quote_count) where quote_count > 0;

create or replace function public.refresh_opportunity_commerce(p_since timestamptz default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  touched integer;
begin
  with affected as (
    select opportunity_id from public.opp_quotes
     where opportunity_id is not null and (p_since is null or updated_at > p_since)
    union
    select opportunity_id from public.opp_orders
     where opportunity_id is not null and (p_since is null or updated_at > p_since)
  ),
  q as (
    select opportunity_id,
           count(*) as n, sum(amount) as total,
           (array_agg(salesforce_created_at::date order by salesforce_created_at desc nulls last))[1] as latest_on,
           (array_agg(status order by salesforce_created_at desc nulls last))[1] as latest_status,
           (array_agg(amount order by salesforce_created_at desc nulls last))[1] as latest_amount
      from public.opp_quotes where opportunity_id in (select opportunity_id from affected)
     group by opportunity_id
  ),
  o as (
    select opportunity_id,
           count(*) as n, sum(amount) as total,
           (array_agg(coalesce(po_date, effective_on, salesforce_created_at::date) order by coalesce(po_date, effective_on, salesforce_created_at::date) desc nulls last))[1] as latest_on,
           (array_agg(amount order by coalesce(po_date, effective_on, salesforce_created_at::date) desc nulls last))[1] as latest_amount
      from public.opp_orders where opportunity_id in (select opportunity_id from affected)
     group by opportunity_id
  ),
  written as (
    update public.opportunities op
       set quote_count = coalesce(q.n, 0),
           quotes_total = q.total,
           latest_quote_on = q.latest_on,
           latest_quote_status = q.latest_status,
           latest_quote_amount = q.latest_amount,
           order_count = coalesce(o.n, 0),
           orders_total = o.total,
           latest_order_on = o.latest_on,
           latest_order_amount = o.latest_amount
      from affected a
      left join q on q.opportunity_id = a.opportunity_id
      left join o on o.opportunity_id = a.opportunity_id
     where op.id = a.opportunity_id
    returning 1
  )
  select count(*) into touched from written;
  return touched;
end;
$function$;

revoke all on function public.refresh_opportunity_commerce(timestamptz) from public, anon;

create or replace function public.apply_salesforce_transforms(p_since timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r jsonb;
begin
  r := jsonb_build_object(
    'clients',       public.sync_org_clients_from_salesforce(p_since),
    'members',       (public.sync_org_members_from_salesforce_owners())->'created',
    'campaigns',     public.sync_crm_campaigns_from_salesforce(p_since),
    'accounts',      public.sync_crm_accounts_from_salesforce(p_since),
    'contacts',      public.sync_crm_contacts_from_salesforce(p_since),
    'opportunities', public.sync_opportunities_from_salesforce(p_since),
    'owners',        public.backfill_opportunity_owners(20000),
    'duplicates',    public.refresh_opportunity_duplicates(p_since),
    'campaign_links', public.attach_opportunity_campaigns(p_since),
    'activities',    public.sync_opp_activities_from_salesforce(p_since),
    'quotes',        public.sync_opp_quotes_from_salesforce(p_since),
    'orders',        public.sync_opp_orders_from_salesforce(p_since),
    'commerce',      public.refresh_opportunity_commerce(p_since)
  );
  return r;
end;
$function$;

/* Every opportunity that has anything, once. */
select public.refresh_opportunity_commerce(null);
