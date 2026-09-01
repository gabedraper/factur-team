/*
 * Activity against a pursuit, not against a Contact.
 *
 * Two different Clients can be emailing the same Contact in the same week.
 * If activity hung off crm_contacts directly, both Clients' outreach would
 * blend into one history for that person. opportunity_id is required, not
 * one of several optional parents, because a call/email/task only ever means
 * something in the context of one specific Client's pursuit.
 */

create table if not exists public.opp_activities (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  activity_type text not null check (activity_type in ('call', 'email', 'task', 'note')),
  subject text,
  body text,
  direction text check (direction in ('inbound', 'outbound')),
  outcome text,
  occurred_at timestamptz not null default now(),
  created_by uuid references public.org_members(id),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists opp_activities_opp_idx on public.opp_activities(opportunity_id, occurred_at desc);

alter table public.opp_activities enable row level security;

create policy opp_activities_scoped on public.opp_activities
  for all to authenticated
  using (public.is_factur_user()
         and exists (
           select 1 from public.opportunities o
           where o.id = opp_activities.opportunity_id
             and (public.has_permission('org.manage')
                  or o.client_id in (select client_id from public.my_client_ids()))
         ))
  with check (public.is_factur_user()
              and exists (
                select 1 from public.opportunities o
                where o.id = opp_activities.opportunity_id
                  and (public.has_permission('org.manage')
                       or o.client_id in (select client_id from public.my_client_ids()))
              ));
