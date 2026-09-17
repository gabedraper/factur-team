/*
 * Quotes and purchase orders by client by month, for the clients table.
 *
 * Same shape as client_lead_months and client_activity_months: the last six
 * months per client, rebuilt hourly, read by the health table to show a
 * count in the row and the month-by-month figures in the card beneath it.
 * Keyed on our client id rather than Salesforce's because opp_quotes and
 * opp_orders already carry it (falling back to the opportunity's when the
 * quote's own Client__c is blank, which it is on most).
 *
 * A quote's month is when it was created; an order's is its PO date, or its
 * effective date, or failing both its creation. Amounts are Quote_Amount__c
 * and PO_Amount__c -- the typed figures, not Salesforce's line-item sums.
 */

create table if not exists public.client_commerce_months (
  client_id     uuid not null references public.org_clients(id) on delete cascade,
  month_start   date not null,
  quotes        bigint not null default 0,
  quotes_total  numeric,
  orders        bigint not null default 0,
  orders_total  numeric,
  computed_at   timestamptz not null default now(),
  primary key (client_id, month_start)
);

alter table public.client_commerce_months enable row level security;
revoke all on public.client_commerce_months from anon;
drop policy if exists client_commerce_months_read on public.client_commerce_months;
create policy client_commerce_months_read on public.client_commerce_months
  for select using ((select public.is_factur_user()));

create or replace function public.refresh_client_commerce_months()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  since date := (date_trunc('month', current_date) - interval '5 months')::date;
begin
  create temp table _commerce on commit drop as
  with q as (
    select client_id, date_trunc('month', salesforce_created_at)::date as month_start,
           count(*) as quotes, sum(amount) as quotes_total
      from public.opp_quotes
     where client_id is not null and salesforce_created_at >= since
     group by 1, 2
  ),
  o as (
    select client_id,
           date_trunc('month', coalesce(po_date, effective_on, salesforce_created_at::date))::date as month_start,
           count(*) as orders, sum(amount) as orders_total
      from public.opp_orders
     where client_id is not null
       and coalesce(po_date, effective_on, salesforce_created_at::date) >= since
     group by 1, 2
  )
  select coalesce(q.client_id, o.client_id) as client_id,
         coalesce(q.month_start, o.month_start) as month_start,
         coalesce(q.quotes, 0) as quotes, q.quotes_total,
         coalesce(o.orders, 0) as orders, o.orders_total
    from q full outer join o on o.client_id = q.client_id and o.month_start = q.month_start;

  delete from public.client_commerce_months;
  insert into public.client_commerce_months (client_id, month_start, quotes, quotes_total, orders, orders_total, computed_at)
    select client_id, month_start, quotes, quotes_total, orders, orders_total, now() from _commerce;
end;
$function$;

revoke all on function public.refresh_client_commerce_months() from public, anon;

select public.refresh_client_commerce_months();

/* Hourly, like the lead and activity months. */
select cron.schedule('client-commerce-months', '20 * * * *', 'select public.refresh_client_commerce_months();');
