/* The statuses actually in use on quotes or orders, most common first, for a
   filter that offers real values rather than the picklist's full list. */
create or replace function public.commerce_statuses(p_kind text)
returns table (status text)
language sql
stable
security invoker
set search_path = public
as $$
  select s.status from (
    select q.status, count(*) n from public.opp_quotes q where p_kind = 'quotes' and q.status is not null group by 1
    union all
    select o.status, count(*) n from public.opp_orders o where p_kind = 'orders' and o.status is not null group by 1
  ) s order by s.n desc, s.status;
$$;
grant execute on function public.commerce_statuses(text) to authenticated;
