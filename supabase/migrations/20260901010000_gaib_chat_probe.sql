/*
 * A note of what arrives at the Chat endpoint, for working out why nothing is
 * coming back.
 *
 * Google reports every failure as "Gaib not responding" whether the request was
 * refused, errored, or never arrived at all, and those need completely
 * different fixes. This records the fact of an arrival so the three can be told
 * apart: an empty table means Google is not reaching the address at all, which
 * is a configuration problem and not a code one; rows saying refused mean it is
 * arriving and the signature check is unhappy.
 *
 * Nothing sensitive is kept. The token is never stored -- only whether one was
 * present and what audience it claimed, and that claim is read without being
 * trusted, purely so a mismatch is visible instead of being guessed at.
 */
create table if not exists public.gaib_chat_probe (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  had_auth_header boolean not null,
  verified boolean not null,
  claimed_audience text,
  claimed_issuer text,
  event_type text
);

alter table public.gaib_chat_probe enable row level security;

drop policy if exists gaib_chat_probe_read on public.gaib_chat_probe;
create policy gaib_chat_probe_read on public.gaib_chat_probe
  for select to authenticated
  using (public.is_factur_user() and public.has_permission('org.manage'));

-- Anyone who finds the address can cause a row, so it is kept small on write
-- rather than left to grow.
create or replace function public.gaib_chat_probe_trim()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  delete from public.gaib_chat_probe
   where id < (select max(id) - 50 from public.gaib_chat_probe);
  return null;
end;
$$;

drop trigger if exists gaib_chat_probe_trim on public.gaib_chat_probe;
create trigger gaib_chat_probe_trim
  after insert on public.gaib_chat_probe
  for each statement execute function public.gaib_chat_probe_trim();

-- Which fields the payload arrived with. Names only, never values -- enough to
-- tell a classic Chat app request from a Workspace add-on one, which send
-- entirely different shapes and are otherwise indistinguishable from a failure.
alter table public.gaib_chat_probe add column if not exists body_keys text;
