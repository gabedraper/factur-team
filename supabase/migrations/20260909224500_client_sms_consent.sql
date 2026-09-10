/*
 * Whether a client's MSA actually covers texting them is not something this
 * system can derive -- client_terms is extracted from the agreement text and
 * has no mention of SMS/text anywhere in it today, for any client. This has
 * to be a manual, auditable record: who said this client is covered, when,
 * and why, rather than an inferred flag.
 *
 * One row per consenting client (existence is the boolean); everyone else is
 * simply absent and therefore not eligible. Reading is scoped to whoever can
 * touch collections SMS at all -- narrower than clients.health, since this is
 * closer to a compliance record than a health metric. Writing goes through
 * the server, same as every other collections table.
 */
create table public.client_sms_consent (
  client_id uuid primary key references public.org_clients(id) on delete cascade,
  consented_at timestamptz not null default now(),
  consented_by uuid not null references public.org_members(id) on delete set null,
  note text not null,
  created_at timestamptz not null default now()
);

alter table public.client_sms_consent enable row level security;

create policy client_sms_consent_read on public.client_sms_consent
  for select to authenticated
  using (public.is_factur_user()
         and (public.has_permission('finance.collections.sms')
              or public.has_permission('org.manage')));
