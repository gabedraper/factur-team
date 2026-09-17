/*
 * Are all the opportunities here? Counted, not assumed.
 *
 * Every hour the reconcile job asks Salesforce for its counts -- opportunities
 * by stage, and totals for quotes, orders, contacts and companies -- and writes
 * them beside the mirror's and the app's. One row per object per scope per
 * check, kept so the settings page can show how the gap has moved. The three
 * numbers answer three different questions: Salesforce is the truth, the
 * mirror says whether the sync fetched it, the app says whether the transform
 * took it.
 *
 * A difference is not always a fault. The app leaves out Prospecting: Cold
 * Call List on purpose, and holds a few opportunities that were created in the
 * app and are not in Salesforce at all. The page says which differences are
 * expected so the eye lands on the ones that are not.
 *
 * The job also does the one thing the sync cannot: learn about deletions. A
 * record deleted in Salesforce never comes back from an ordinary query, so the
 * mirror kept it and the app kept it. queryAll returns them; the job marks
 * them in the mirror and removes them here.
 */

create table if not exists public.salesforce_reconciliation (
  id            bigint generated always as identity primary key,
  checked_at    timestamptz not null default now(),
  object        text not null,
  /* '__all' for the object's total, otherwise the stage. */
  scope         text not null default '__all',
  sf_count      integer,
  mirror_count  integer,
  app_count     integer,
  /* Rows the app holds that Salesforce does not, and why (app-created, say). */
  note          text
);
create index if not exists salesforce_reconciliation_recent_idx
  on public.salesforce_reconciliation (object, checked_at desc);

alter table public.salesforce_reconciliation enable row level security;
revoke all on public.salesforce_reconciliation from anon;
drop policy if exists salesforce_reconciliation_read on public.salesforce_reconciliation;
create policy salesforce_reconciliation_read on public.salesforce_reconciliation
  for select using ((select public.is_factur_user()) and (select public.has_permission('org.manage')));

/*
 * The counts on our side, per object. Called by the job, which supplies
 * Salesforce's own; kept in SQL so the two sides are counted the same way
 * every time and nobody re-derives "not deleted" in JavaScript.
 */
create or replace function public.reconciliation_local_counts()
returns table (object text, scope text, mirror_count integer, app_count integer, note text)
language sql
stable
security definer
set search_path = public
as $$
  -- Opportunities by stage
  select 'Opportunity', s.stage, s.mirror::integer, s.app::integer,
         case when s.stage = 'Prospecting: Cold Call List' then 'Left out of the app on purpose: the cold-call list is not worked here.' end
  from (
    select coalesce(m.stage, a.stage) as stage, coalesce(m.n, 0) as mirror, coalesce(a.n, 0) as app
    from (select "StageName" as stage, count(*) as n from public."sky_Opportunity"
           where coalesce(nullif("IsDeleted", '')::boolean, false) = false group by 1) m
    full outer join (select stage, count(*) as n from public.opportunities
                      where salesforce_opportunity_id is not null group by 1) a on a.stage = m.stage
  ) s
  union all
  select 'Opportunity', '__all',
         (select count(*) from public."sky_Opportunity" where coalesce(nullif("IsDeleted", '')::boolean, false) = false)::integer,
         (select count(*) from public.opportunities where salesforce_opportunity_id is not null)::integer,
         (select case when count(*) > 0 then count(*) || ' created in the app, not in Salesforce' end
            from public.opportunities where salesforce_opportunity_id is null)
  union all
  select 'Quote', '__all',
         (select count(*) from public."sky_Quote" where coalesce(nullif("IsDeleted", '')::boolean, false) = false)::integer,
         (select count(*) from public.opp_quotes)::integer, null
  union all
  select 'Order', '__all',
         (select count(*) from public."sky_Order" where coalesce(nullif("IsDeleted", '')::boolean, false) = false)::integer,
         (select count(*) from public.opp_orders)::integer, null
  union all
  select 'Contact', '__all',
         (select count(*) from public."sky_Contact" where coalesce(nullif("IsDeleted", '')::boolean, false) = false)::integer,
         (select count(*) from public.crm_contacts)::integer,
         'The mirror holds only contacts on a client pipeline, fetched as their opportunities arrive.'
  union all
  select 'Account', '__all',
         (select count(*) from public."sky_Account" where coalesce(nullif("IsDeleted", '')::boolean, false) = false)::integer,
         (select count(*) from public.crm_accounts)::integer, null;
$$;
revoke all on function public.reconciliation_local_counts() from public, anon;

/*
 * Deletions learned from Salesforce. Marks the mirror and removes the app's
 * copy; activities go with their opportunity (cascade), quotes and orders lose
 * the link (set null) and are removed themselves only when Salesforce deleted
 * them. Returns how many of each were actually here.
 */
create or replace function public.apply_salesforce_deletions(
  p_opportunities text[] default '{}',
  p_quotes text[] default '{}',
  p_orders text[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o integer := 0; q integer := 0; r integer := 0;
begin
  update public."sky_Opportunity" set "IsDeleted" = 'true' where "Id" = any(p_opportunities);
  delete from public.opportunities where salesforce_opportunity_id = any(p_opportunities);
  get diagnostics o = row_count;

  update public."sky_Quote" set "IsDeleted" = 'true' where "Id" = any(p_quotes);
  delete from public.opp_quotes where salesforce_quote_id = any(p_quotes);
  get diagnostics q = row_count;

  update public."sky_Order" set "IsDeleted" = 'true' where "Id" = any(p_orders);
  delete from public.opp_orders where salesforce_order_id = any(p_orders);
  get diagnostics r = row_count;

  return jsonb_build_object('opportunities', o, 'quotes', q, 'orders', r);
end;
$$;
revoke all on function public.apply_salesforce_deletions(text[], text[], text[]) from public, anon;

select cron.schedule('salesforce-reconcile', '35 * * * *', $job$
  select net.http_post(
    url := 'https://team.facturmfg.com/api/salesforce/reconcile',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-gaib-secret', (select value from public.gaib_secrets where name = 'deliver')
    ),
    body := '{}'::jsonb
  );
$job$);
