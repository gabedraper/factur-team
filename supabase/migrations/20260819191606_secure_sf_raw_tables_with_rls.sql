-- Lock down the raw Salesforce mirror tables.
--
-- These were readable and writable by anyone holding the public anon key,
-- which ships in the browser bundle. Reads are now limited to signed-in users
-- on a Factur email domain -- the same rule the app enforces in middleware
-- (see src/lib/allowed-domains.ts). Writes get no policy at all, so only the
-- ingest pipeline (direct Postgres credentials / service role, both of which
-- bypass RLS) can modify them.

create or replace function public.is_factur_user()
returns boolean
language sql
stable
as $$
  select lower(split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 2))
         in ('facturmfg.com', 'bethefactur.com');
$$;

alter table public.sf_tasks_raw          enable row level security;
alter table public.sf_events_raw         enable row level security;
alter table public.sf_clients_raw        enable row level security;
alter table public.sf_opportunities_raw  enable row level security;
alter table public.sf_orders_raw         enable row level security;
alter table public.sf_users_raw          enable row level security;

create policy factur_users_read_sf_tasks_raw on public.sf_tasks_raw
  for select to authenticated using (public.is_factur_user());

create policy factur_users_read_sf_events_raw on public.sf_events_raw
  for select to authenticated using (public.is_factur_user());

create policy factur_users_read_sf_clients_raw on public.sf_clients_raw
  for select to authenticated using (public.is_factur_user());

create policy factur_users_read_sf_opportunities_raw on public.sf_opportunities_raw
  for select to authenticated using (public.is_factur_user());

create policy factur_users_read_sf_orders_raw on public.sf_orders_raw
  for select to authenticated using (public.is_factur_user());

create policy factur_users_read_sf_users_raw on public.sf_users_raw
  for select to authenticated using (public.is_factur_user());
