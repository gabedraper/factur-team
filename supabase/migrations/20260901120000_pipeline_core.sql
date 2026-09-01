/*
 * The pipeline: Clients pursuing Contacts.
 *
 * In this market many of our Clients independently chase the same Contact at
 * once -- normal, not a data error. Salesforce's Opportunity object is the
 * junction that ties a Client to a target Account/Contact and carries the
 * state of that one pursuit. This is the app's own version of that junction,
 * kept in sync with Salesforce via Skyvia going forward.
 *
 * crm_accounts / crm_contacts hold the prospected companies and people
 * themselves -- read-mostly, synced in from Salesforce. Named with a crm_
 * prefix on purpose: client_contacts already means people at our own Clients,
 * and tal_people/tal_companies is the separate recruiting domain. Reusing
 * either name for a different meaning would be its own kind of bug.
 *
 * One Client can only be pursuing one Contact once at a time -- the unique
 * constraint on (client_id, contact_id) is that rule, enforced, not just
 * documented.
 */

create table if not exists public.crm_accounts (
  id uuid primary key default gen_random_uuid(),
  salesforce_account_id text unique,
  name text not null,
  domain text,
  industry text,
  city text,
  state text,
  country text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.crm_contacts (
  id uuid primary key default gen_random_uuid(),
  salesforce_contact_id text unique,
  account_id uuid references public.crm_accounts(id) on delete set null,
  first_name text,
  last_name text,
  title text,
  email text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_contacts_account_idx on public.crm_contacts(account_id);

create table if not exists public.opportunities (
  id uuid primary key default gen_random_uuid(),
  salesforce_opportunity_id text unique,

  client_id uuid not null references public.org_clients(id) on delete restrict,
  contact_id uuid not null references public.crm_contacts(id) on delete restrict,
  account_id uuid references public.crm_accounts(id) on delete set null,

  stage text not null default 'prospecting',
  lead_status text,

  reached_lead boolean not null default false,
  reached_eval_call_scheduled boolean not null default false,
  reached_selling boolean not null default false,
  reached_discovery boolean not null default false,
  reached_proposal boolean not null default false,
  reached_closing boolean not null default false,

  notes text,
  opened_on date not null default current_date,
  closed_on date,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.org_members(id),
  updated_by uuid references public.org_members(id),

  constraint opportunities_one_pursuit_per_client_contact unique (client_id, contact_id)
);

create index if not exists opportunities_client_idx on public.opportunities(client_id);
create index if not exists opportunities_contact_idx on public.opportunities(contact_id);
create index if not exists opportunities_account_idx on public.opportunities(account_id);

/*
 * RLS. crm_accounts/crm_contacts are read-only for everyone at Factur --
 * Skyvia writes them via service_role, which bypasses RLS entirely, so the
 * write policy here is only for the rare manual cleanup by someone with
 * org.manage.
 *
 * opportunities follows org_clients' own reach exactly: my_client_ids()
 * already answers "which clients is this person responsible for, directly or
 * through people who report to them" -- an opportunity is visible and
 * editable under the same rule as the client it belongs to.
 */

alter table public.crm_accounts enable row level security;
alter table public.crm_contacts enable row level security;
alter table public.opportunities enable row level security;

create policy crm_accounts_read on public.crm_accounts
  for select to authenticated
  using (public.is_factur_user());

create policy crm_accounts_manual_write on public.crm_accounts
  for all to authenticated
  using (public.is_factur_user() and public.has_permission('org.manage'))
  with check (public.is_factur_user() and public.has_permission('org.manage'));

create policy crm_contacts_read on public.crm_contacts
  for select to authenticated
  using (public.is_factur_user());

create policy crm_contacts_manual_write on public.crm_contacts
  for all to authenticated
  using (public.is_factur_user() and public.has_permission('org.manage'))
  with check (public.is_factur_user() and public.has_permission('org.manage'));

create policy opportunities_scoped on public.opportunities
  for all to authenticated
  using (public.is_factur_user()
         and (public.has_permission('org.manage')
              or client_id in (select client_id from public.my_client_ids())))
  with check (public.is_factur_user()
              and (public.has_permission('org.manage')
                   or client_id in (select client_id from public.my_client_ids())));
