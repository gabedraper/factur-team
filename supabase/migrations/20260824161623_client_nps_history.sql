/*
 * Every NPS response ever recorded, one row each.
 *
 * Deliberately a log rather than a field on the client: a score is only
 * meaningful next to the ones before it, and overwriting last quarter's number
 * with this quarter's throws away the very thing that makes it useful -- whether
 * a client is climbing or sliding. Quarterly to begin with, monthly later, so
 * only the date is stored and the app groups it either way rather than pinning
 * a cadence into the data.
 */
create table if not exists public.client_nps (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.org_clients(id) on delete cascade,

  -- 0-10 is the NPS question's own scale. Anything outside it is a typo, and a
  -- typo in a score nobody can trace back is worse than a rejected form.
  score smallint not null check (score between 0 and 10),

  collected_on date not null default current_date,
  respondent text,
  comment text,

  -- Who at Factur recorded it, so a surprising number can be asked about.
  recorded_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create index if not exists client_nps_client_date_idx
  on public.client_nps (client_id, collected_on desc);

alter table public.client_nps enable row level security;

-- Read is open to the company, like the rest of the client record.
create policy "Factur users read NPS" on public.client_nps
  for select to authenticated using (public.is_factur_user());

-- Recording and correcting is for whoever manages the org.
create policy "Org managers record NPS" on public.client_nps
  for insert to authenticated with check (public.has_permission('org.manage'));

create policy "Org managers correct NPS" on public.client_nps
  for delete to authenticated using (public.has_permission('org.manage'));

/*
 * The latest response per client, and the one before it.
 *
 * The movement matters as much as the level: a client sitting at 7 having come
 * from 9 needs attention that a client at 7 climbing from 5 does not.
 */
create or replace view public.client_nps_latest
with (security_invoker = true) as
select distinct on (client_id)
  client_id,
  score          as latest_score,
  collected_on   as latest_on,
  lag(score) over (partition by client_id order by collected_on) as previous_score,
  count(*)  over (partition by client_id) as responses
from public.client_nps
order by client_id, collected_on desc;
