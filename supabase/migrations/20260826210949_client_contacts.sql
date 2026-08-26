/*
 * Everyone we email at a client, and what each of them is for.
 *
 * Replaces two half-answers: contact addresses living as columns on
 * sf_clients_raw, and client_contact_names, which keyed a first name to an
 * address with no client and no role. The live data settles why a column pair
 * on org_clients was never going to work:
 *
 *   - 112 of 131 Active clients have a QuickBooks billing address that is a
 *     *different person* from the Salesforce main contact. Accounts payable is
 *     not who answers an NPS survey, and that is correct rather than a data
 *     problem.
 *   - 18 clients have two billing addresses. A column cannot hold both, and
 *     collections already mails them both.
 *   - 34 have a decision maker who is not the main contact.
 *
 * So: rows, with a role. And crucially with somewhere to record opting out --
 * a fact no column on the client could express, and the one that matters most
 * once a recurring survey is actually going out.
 */
create table if not exists public.client_contacts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.org_clients(id) on delete cascade,
  email text not null,
  first_name text,
  last_name text,
  role text not null check (role in ('primary', 'decision_maker', 'billing')),
  /*
   * Which system said so. Salesforce owns the decision maker, QuickBooks owns
   * the billing address, and both are routinely wrong about who actually reads
   * the mail -- so a person's correction is a row of its own, and the resolver
   * below prefers it. Same shape as the team lead override.
   */
  source text not null check (source in ('salesforce', 'quickbooks', 'manual')),
  active boolean not null default true,
  opted_out_at timestamptz,
  opted_out_reason text,
  bounced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text
);

-- Addresses are compared case-insensitively everywhere else, so the constraint
-- has to be too, or Bob@x.com and bob@x.com become two contacts.
create unique index if not exists client_contacts_unique_idx
  on public.client_contacts (client_id, lower(email), role);

create index if not exists client_contacts_client_idx on public.client_contacts (client_id);
create index if not exists client_contacts_email_idx on public.client_contacts (lower(email));

alter table public.client_contacts enable row level security;

drop policy if exists client_contacts_read on public.client_contacts;
create policy client_contacts_read on public.client_contacts
  for select to authenticated using (public.is_factur_user());

drop policy if exists client_contacts_write on public.client_contacts;
create policy client_contacts_write on public.client_contacts
  for all to authenticated
  using (public.is_factur_user()
         and (public.has_permission('org.manage') or public.has_permission('nps.send')))
  with check (public.is_factur_user()
              and (public.has_permission('org.manage') or public.has_permission('nps.send')));

/*
 * One answer per client per role.
 *
 * Opted out, bounced and inactive are excluded here rather than left to each
 * caller. Anyone asking this view for an address is about to email it, and "do
 * not email this person" should be impossible to forget.
 */
create or replace view public.client_contact_current
with (security_invoker = true) as
select distinct on (client_id, role)
  id, client_id, role, email, first_name, last_name, source, updated_at
from public.client_contacts
where active
  and opted_out_at is null
  and bounced_at is null
order by client_id, role,
         (source = 'manual') desc,
         updated_at desc;
