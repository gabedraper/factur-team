-- Watching the site itself, not just the data behind it.
--
-- Two outages in one day were noticed only because a page looked wrong: a client
-- name that broke classification, and middleware timing out. The maintenance
-- alert catches neither -- it reports on the database, and in both cases the
-- database was fine.
--
-- This runs in Supabase, which is separate infrastructure from Vercel. That is
-- the point: a check hosted on the thing being checked cannot report its own
-- outage.
--
-- pg_net is asynchronous -- http_get queues a request and the response lands in
-- net._http_response later -- so a probe and a settle step alternate every five
-- minutes rather than trying to do both at once.

create extension if not exists pg_net with schema extensions;

create table if not exists public.uptime_checks (
  id bigserial primary key,
  checked_at timestamptz not null default now(),
  url text not null,
  status_code integer,
  ok boolean not null,
  error text
);

create index if not exists uptime_checks_time on public.uptime_checks(checked_at desc);

alter table public.uptime_checks enable row level security;
create policy factur_users_read_uptime on public.uptime_checks
  for select to authenticated using (public.is_factur_user());

-- Settings live in a table rather than a function body so the Resend key can be
-- pasted in without a migration, and so it never reaches the repository.
create table if not exists public.app_settings (
  key text primary key, value text, description text
);

alter table public.app_settings enable row level security;
-- Deliberately no read policy: this holds an API key. Only the service role and
-- SECURITY DEFINER functions see it.

insert into public.app_settings (key, value, description) values
  ('uptime_url', 'https://team.facturmfg.com/login',
   'The page the uptime check requests. The login page needs no session and still passes through middleware, which is what failed.'),
  ('alert_email_to', 'gabe@bethefactur.com', 'Who hears about an outage.'),
  ('alert_email_from', 'alerts@facturmfg.com', 'Must be a domain verified in Resend.'),
  ('resend_api_key', null, 'Paste the Resend key here to turn on email alerts. Until then failures are recorded but nothing is sent.')
on conflict (key) do nothing;

-- See the applied migration for uptime_probe() and uptime_settle(); the probe
-- queues a request and records it as pending, and the settle step reads the
-- response, marks the check, and emails on two consecutive failures -- one
-- failure is a blip, two is an outage. It shouts once per outage, not once per
-- check.

select cron.schedule('uptime-check', '*/5 * * * *',
  $$select public.uptime_settle(); select public.uptime_probe();$$);
