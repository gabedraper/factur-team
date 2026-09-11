/*
 * Writing app edits back to Salesforce -- the half that never existed.
 *
 * The sync has always been one way: Salesforce to here, every three minutes.
 * Editing a stage in the app changed our database and nothing else. This is the
 * other direction, deliberately narrow: a named handful of people, opportunities
 * that already exist in Salesforce, and a log of every field pushed.
 *
 * Three tables, and the log is the point of the exercise:
 *
 *   salesforce_writeback_settings  one row, one switch -- off stops everything
 *   salesforce_writeback_testers   whose edits are pushed; nobody else's are
 *   salesforce_writeback_log       one row per field, with four values on it
 *
 * Those four values are what make "did it work" answerable rather than a
 * guess: what the app had (old_value), what the person set (new_value), what
 * Salesforce held immediately before the push (sf_before) and what it held
 * immediately after (sf_after). A push that Salesforce accepts and then rewrites
 * through its own automation reads as a mismatch, not a success -- that is the
 * failure this log exists to catch, because nothing else would show it.
 *
 * Rows are queued by the save action, never by a trigger on the table. That is
 * the whole loop prevention: the inbound sync writes to opportunities constantly
 * and a trigger could not tell those writes from a person's, so every sync would
 * bounce back at Salesforce as an edit. An action knows who is typing.
 *
 * Not called sf_* on purpose -- Coupler owns that prefix and drops and recreates
 * what it owns. An audit log a sync tool might delete is not an audit log.
 */

create table if not exists public.salesforce_writeback_settings (
  id          boolean primary key default true check (id),
  enabled     boolean not null default false,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.org_members(id)
);

insert into public.salesforce_writeback_settings (id, enabled)
values (true, false)
on conflict (id) do nothing;

create table if not exists public.salesforce_writeback_testers (
  member_id  uuid primary key references public.org_members(id) on delete cascade,
  added_at   timestamptz not null default now(),
  added_by   uuid references public.org_members(id)
);

create table if not exists public.salesforce_writeback_log (
  id              bigint generated always as identity primary key,
  created_at      timestamptz not null default now(),
  /* One save can change several fields; they share an edit_id and go to
     Salesforce as a single PATCH, the way a person would save them. */
  edit_id         uuid not null,
  member_id       uuid references public.org_members(id),
  opportunity_id  uuid not null,
  salesforce_id   text not null,
  sf_object       text not null default 'Opportunity',
  field           text not null,
  sf_field        text not null,
  old_value       text,
  new_value       text,
  sf_before       text,
  sf_after        text,
  /*
   * queued    waiting for the worker
   * sending   claimed by a worker (a crash leaves this; it is retried)
   * sent      Salesforce accepted the write
   * verified  and reading it straight back agreed with what we sent
   * mismatch  Salesforce accepted it and holds something else -- automation,
   *           a validation rule rewriting the value, a formula field
   * conflict  Salesforce had changed underneath us; not pushed
   * failed    Salesforce refused it; error holds its message
   * skipped   nothing to push (no Salesforce id for the new company, say)
   */
  status          text not null default 'queued'
                  check (status in ('queued','sending','sent','verified','mismatch','conflict','failed','skipped')),
  attempts        integer not null default 0,
  error           text,
  sent_at         timestamptz,
  checked_at      timestamptz
);

create index if not exists salesforce_writeback_log_pending_idx
  on public.salesforce_writeback_log (status, id)
  where status in ('queued', 'sending');

create index if not exists salesforce_writeback_log_recent_idx
  on public.salesforce_writeback_log (created_at desc);

create index if not exists salesforce_writeback_log_opportunity_idx
  on public.salesforce_writeback_log (opportunity_id, created_at desc);

/*
 * Readable by admins, writable by nobody through the API. Every write comes
 * from the service role in the save action and the worker, which bypasses RLS
 * -- so there is no policy here that would let a person edit their own audit
 * trail, which is the one thing an audit trail must not allow.
 */
alter table public.salesforce_writeback_settings enable row level security;
alter table public.salesforce_writeback_testers  enable row level security;
alter table public.salesforce_writeback_log      enable row level security;

drop policy if exists salesforce_writeback_settings_read on public.salesforce_writeback_settings;
create policy salesforce_writeback_settings_read on public.salesforce_writeback_settings
  for select using ((select public.is_factur_user()) and (select public.has_permission('org.manage')));

drop policy if exists salesforce_writeback_testers_read on public.salesforce_writeback_testers;
create policy salesforce_writeback_testers_read on public.salesforce_writeback_testers
  for select using ((select public.is_factur_user()) and (select public.has_permission('org.manage')));

drop policy if exists salesforce_writeback_log_read on public.salesforce_writeback_log;
create policy salesforce_writeback_log_read on public.salesforce_writeback_log
  for select using ((select public.is_factur_user()) and (select public.has_permission('org.manage')));

revoke all on public.salesforce_writeback_settings from anon;
revoke all on public.salesforce_writeback_testers  from anon;
revoke all on public.salesforce_writeback_log      from anon;
