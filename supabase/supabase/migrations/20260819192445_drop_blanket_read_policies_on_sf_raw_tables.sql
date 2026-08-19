-- Each sf_*_raw table already carried a dormant "authenticated_read_*" policy
-- with a `true` condition. Those were inert while RLS was disabled, but
-- enabling RLS switched them on -- and Postgres ORs permissive policies
-- together, so `true` swallowed the new domain check. Drop them so only
-- factur_users_read_* applies.

drop policy if exists authenticated_read_sf_tasks_raw         on public.sf_tasks_raw;
drop policy if exists authenticated_read_sf_events_raw        on public.sf_events_raw;
drop policy if exists authenticated_read_sf_clients_raw       on public.sf_clients_raw;
drop policy if exists authenticated_read_sf_opportunities_raw on public.sf_opportunities_raw;
drop policy if exists authenticated_read_sf_orders_raw        on public.sf_orders_raw;
drop policy if exists authenticated_read_sf_users_raw         on public.sf_users_raw;
