/* The clients that have at least one quote or order the caller can see, for
   a client filter that only offers real choices. Invoker rights, so the
   quotes and orders policies decide the list. */
create or replace function public.commerce_clients(p_kind text)
returns table (id uuid, name text)
language sql
stable
security invoker
set search_path = public
as $$
  select c.id, c.name
    from public.org_clients c
   where exists (
     select 1 from public.opp_quotes q where p_kind = 'quotes' and q.client_id = c.id
     union all
     select 1 from public.opp_orders o where p_kind = 'orders' and o.client_id = c.id
   )
   order by c.name;
$$;
grant execute on function public.commerce_clients(text) to authenticated;
