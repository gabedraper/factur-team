/*
 * Where the ladder starts.
 *
 * Sixty-five open invoices are already past sixty-one days. Without this, the
 * moment somebody activates the last rung all sixty-five are "due" their
 * handed-to-collections email at once, and the first thing the new system does
 * is mail three hundred thousand dollars' worth of customers to tell them
 * their account is closed. That is not a sequence starting, it is an accident.
 *
 * So invoices that fell due before start_from never enter the ladder. Finance
 * moves the date backwards deliberately, a step at a time, once they have
 * looked at who it would catch.
 *
 * The full text of the rewritten get_ar_queue() is in the migration applied to
 * the database under the same name; it differs from the version in
 * 20260909120000 only in reading start_from, grace_days and stale_hours out of
 * ar_settings instead of taking them as constants.
 */
create table if not exists public.ar_settings (
  id          boolean primary key default true check (id),
  start_from  date not null default current_date,
  grace_days  integer not null default 3,
  stale_hours integer not null default 6,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

insert into public.ar_settings (id) values (true) on conflict (id) do nothing;

alter table public.ar_settings enable row level security;

drop policy if exists ar_settings_read on public.ar_settings;
create policy ar_settings_read on public.ar_settings
  for select to authenticated
  using (public.is_factur_user()
         and (public.has_permission('clients.health')
              or public.has_permission('finance.collections')
              or public.has_permission('org.manage')));
