/*
 * Shared and private sequences, and people to put in them.
 *
 * Built onto the sequence engine that already exists rather than beside it.
 * `sequences`, `sequence_steps`, `sequence_runs` and `sequence_actions` already
 * do ladders, offsets, per-writer wording and a generic queue; collections and
 * NPS both run on them. What was missing was ownership, and any way to enrol
 * somebody who is not a client.
 */

alter table public.sequences
  add column if not exists visibility text not null default 'shared'
    check (visibility in ('shared', 'private')),
  add column if not exists owner_member_id uuid
    references public.org_members(id) on delete set null;

comment on column public.sequences.visibility is
  'shared = the company''s, listed for everyone. private = one person''s, listed only for its owner.';

-- Collections and NPS predate this and belong to the company, not to whoever
-- happened to create them.
update public.sequences set visibility = 'shared' where slug in ('collections', 'nps');

create index if not exists sequences_owner_idx
  on public.sequences (owner_member_id) where owner_member_id is not null;

/*
 * Who has been added to a sequence.
 *
 * A row of its own rather than a pointer at client_contacts, because the people
 * in a sequence do not all exist anywhere else -- a CSV row is a person we have
 * never seen. It is also a snapshot: name and company are copied in when they
 * are added, so what went out stays explicable if the contact record later
 * changes or disappears.
 *
 * sequence_runs.subject_id points here with subject_type 'audience'. That keeps
 * every enrolment uniform whatever the person came from, instead of teaching
 * the run table about three kinds of source -- and get_sequence_queue, which
 * does not filter on subject type, picks them up with no change at all.
 */
create table if not exists public.sequence_audience (
  id uuid primary key default gen_random_uuid(),
  sequence_id uuid not null references public.sequences(id) on delete cascade,
  email text not null,
  first_name text,
  last_name text,
  company text,
  -- Known when the person came from the app; null for a CSV row we cannot tie
  -- to anybody. It is what lets a sequence send as that client's team lead.
  client_id uuid references public.org_clients(id) on delete set null,
  source text not null check (source in ('contacts', 'csv')),
  source_ref text,
  added_by text,
  added_at timestamptz not null default now()
);

-- Nobody is added to the same sequence twice, whatever case the address arrived
-- in. Re-uploading the same CSV is then safe rather than a second send.
create unique index if not exists sequence_audience_once_idx
  on public.sequence_audience (sequence_id, lower(email));
create index if not exists sequence_audience_seq_idx
  on public.sequence_audience (sequence_id, added_at desc);

alter table public.sequence_audience enable row level security;

drop policy if exists sequence_audience_read on public.sequence_audience;
create policy sequence_audience_read on public.sequence_audience
  for select to authenticated
  using (public.is_factur_user()
         and (public.has_permission('sequences.send')
              or public.has_permission('org.manage')
              or public.has_permission('nps.send')
              or public.has_permission('finance.collections')));
