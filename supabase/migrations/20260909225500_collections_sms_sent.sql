/*
 * The record of every collections text actually sent -- collections_sent's
 * SMS counterpart. Kept even though volume will be tiny: it's the only
 * evidence, if it's ever asked for, of who was texted, when, what was said,
 * and who sent it.
 */
create table public.collections_sms_sent (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.org_clients(id) on delete cascade,
  to_phone text not null,
  body text not null,
  sent_by uuid references public.org_members(id) on delete set null,
  sent_at timestamptz not null default now()
);

alter table public.collections_sms_sent enable row level security;

create policy collections_sms_sent_read on public.collections_sms_sent
  for select to authenticated
  using (public.is_factur_user()
         and (public.has_permission('finance.collections.sms')
              or public.has_permission('org.manage')));
