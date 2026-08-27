/*
 * Who held which role on a client, and when -- plus the service and status.
 *
 * Everything the app knows about a client today is a current value that gets
 * overwritten. org_clients.account_manager_id changes and the old one is gone.
 * org_client_assignments looks like it records this and does not: it has an
 * assigned_at, no end date, exactly one row per client and role, and every
 * timestamp equal to the last sync. It is current state wearing a date, which
 * is worse than nothing because it invites the question it cannot answer.
 *
 * A validity range instead: one row per client, field and value, open until
 * something replaces it. valid_to null means "still true". That makes "who was
 * the account manager in March" a query, and it is the only way to attribute a
 * score to whoever was looking after the client at the time rather than
 * whoever inherited them since.
 *
 * People and non-people share the table because the question has the same
 * shape. A person lands in member_id, a service or status in value_text.
 */
create table if not exists public.client_history (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.org_clients(id) on delete cascade,
  field text not null check (field in (
    'account_manager', 'team_lead', 'data_team_lead', 'sdr',
    'marketing_strategist', 'data_analyst', 'data_engineer',
    'owner', 'service', 'status'
  )),
  member_id uuid references public.org_members(id) on delete set null,
  value_text text,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  -- How we noticed. 'seed' is the starting line, drawn the day this shipped;
  -- nothing before it can ever be recovered.
  source text not null default 'sync' check (source in ('seed', 'sync', 'manual')),
  created_at timestamptz not null default now(),
  constraint client_history_one_value check (
    (member_id is not null and value_text is null)
    or (member_id is null and value_text is not null)
    or (member_id is null and value_text is null)
  ),
  constraint client_history_range check (valid_to is null or valid_to >= valid_from)
);

-- At most one open row per client and field. The invariant the whole table
-- rests on: two open rows would make "who is it now" ambiguous.
create unique index if not exists client_history_open_idx
  on public.client_history (client_id, field) where valid_to is null;

create index if not exists client_history_lookup_idx
  on public.client_history (client_id, field, valid_from desc);
create index if not exists client_history_member_idx
  on public.client_history (member_id, valid_from desc);

alter table public.client_history enable row level security;

drop policy if exists client_history_read on public.client_history;
create policy client_history_read on public.client_history
  for select to authenticated using (public.is_factur_user());
