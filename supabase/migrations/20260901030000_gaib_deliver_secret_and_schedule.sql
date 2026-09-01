/*
 * The secret that lets the scheduler call the delivery endpoint, and the
 * schedule itself.
 *
 * Kept in the database rather than in an environment variable, because both
 * ends can read the database and only one end can read Vercel. Putting it in
 * both meant copying a string between two places and keeping them in step
 * forever; this way it is generated once, read by the schedule and by the
 * endpoint, and nobody ever has to see it.
 */
create table if not exists public.gaib_secrets (
  name text primary key,
  value text not null,
  created_at timestamptz not null default now()
);

-- Row level security on, and deliberately no policy. Nothing reaches this
-- except the service key, which is the only thing that should: a table with
-- security enabled and no policy is readable by nobody through the API.
alter table public.gaib_secrets enable row level security;

insert into public.gaib_secrets (name, value)
values ('deliver', encode(gen_random_bytes(24), 'hex'))
on conflict (name) do nothing;

select cron.schedule(
  'gaib-deliver-updates',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://team.facturmfg.com/api/gaib/deliver',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-gaib-secret', (select value from public.gaib_secrets where name = 'deliver')
    ),
    body := '{}'::jsonb
  );
  $$
);
