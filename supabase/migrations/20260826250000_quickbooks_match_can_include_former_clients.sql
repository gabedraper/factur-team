/*
 * A debt does not stop being a debt when the client stops being a client.
 *
 * Everything keyed off get_client_quickbooks() only ever saw current clients,
 * which is right for a health score and wrong for collections: seventeen former
 * clients owe $187,932 between them and none of them appeared anywhere.
 *
 * The match now takes a flag. Health and the client screen carry on asking the
 * default question -- current clients -- and collections asks the wider one.
 */
drop function if exists public.get_client_quickbooks();

create function public.get_client_quickbooks(p_include_inactive boolean default false)
returns table (client_id uuid, client_name text, qb_customer_id text, qb_customer_name text)
language sql stable security definer set search_path to 'public'
as $function$
  with qb as (
    select distinct customerref_value::text as qb_id, customerref_name as qb_name,
           public.norm_company(customerref_name) as key
    from public.qb_invoices_raw where customerref_value is not null
  ),
  cl as (
    select id, name, public.norm_company(name) as key
    from public.org_clients
    where p_include_inactive
       or (active and coalesce(status, '') <> 'Inactive')
  ),
  counts as (
    select k.key,
           (select count(*) from cl where cl.key = k.key) as clients_here,
           (select count(*) from qb where qb.key = k.key) as customers_here
    from (select distinct key from qb union select distinct key from cl) k
  ),
  exact as (
    select cl.id, cl.name, qb.qb_id, qb.qb_name
    from cl
    join counts c on c.key = cl.key
    join qb on qb.key = cl.key
    where c.clients_here = 1 and c.customers_here = 1
      -- A decision by a person overrides the name match, including a rejection.
      and not exists (
        select 1 from public.client_quickbooks_links l where l.qb_customer_name = qb.qb_name
      )
  ),
  confirmed as (
    select cl.id, cl.name, qb.qb_id, qb.qb_name
    from public.client_quickbooks_links l
    join cl on cl.id = l.client_id
    join qb on qb.qb_name = l.qb_customer_name
    where not l.rejected and l.client_id is not null
  )
  select * from exact
  union all
  select * from confirmed;
$function$;

revoke all on function public.get_client_quickbooks(boolean) from public, anon;
grant execute on function public.get_client_quickbooks(boolean) to authenticated, service_role;

/*
 * The same widening for who counts as yours. Somebody who ran a client that has
 * since left is still the person who knows what happened to the money.
 */
create or replace function public.my_client_ids(p_as_member uuid default null)
returns table (client_id uuid)
language sql stable security definer set search_path to 'public'
as $function$
  with me as (
    select id from public.org_members
    where active
      and (case when p_as_member is not null
                then id = p_as_member
                else auth_user_id = auth.uid() end)
  ),
  circle as (
    select id from me
    union
    select m.id from public.org_members m
    join me on m.manager_member_id = me.id
    where m.active
  )
  select c.id
  from public.org_clients c
  where c.account_manager_id in (select id from circle)
     or c.team_lead_id in (select id from circle)
     or c.sdr_id in (select id from circle)
     or c.marketing_strategist_id in (select id from circle)
     or c.data_analyst_id in (select id from circle)
     or c.data_engineer_id in (select id from circle)
     or c.data_team_lead_id in (select id from circle)
     or c.member_id in (select id from circle);
$function$;

revoke all on function public.my_client_ids(uuid) from public, anon;
grant execute on function public.my_client_ids(uuid) to authenticated, service_role;

/*
 * The arrears clock has to count former clients too, or the board would list
 * them with no overdue_since and never work out a next step.
 */
create or replace function public.refresh_collections_state()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  with links as (
    select client_id, qb_customer_id from public.get_client_quickbooks(true)
  ),
  overdue as (
    select l.client_id, min(i.duedate)::date as anchor
    from links l
    join public.qb_invoices_raw i on i.customerref_value::text = l.qb_customer_id
    where i.balance > 0 and i.duedate < current_date
    group by l.client_id
  )
  insert into public.collections_client_state (client_id, overdue_since, updated_at)
  select o.client_id, o.anchor, now()
  from overdue o
  on conflict (client_id) do update
    set overdue_since = coalesce(public.collections_client_state.overdue_since, excluded.overdue_since),
        updated_at = now();

  update public.collections_client_state s
     set overdue_since = null, updated_at = now()
   where s.overdue_since is not null
     and not exists (
       select 1
       from public.get_client_quickbooks(true) l
       join public.qb_invoices_raw i on i.customerref_value::text = l.qb_customer_id
       where l.client_id = s.client_id and i.balance > 0 and i.duedate < current_date
     );
end;
$function$;

revoke all on function public.refresh_collections_state() from public, anon;
grant execute on function public.refresh_collections_state() to authenticated, service_role;
