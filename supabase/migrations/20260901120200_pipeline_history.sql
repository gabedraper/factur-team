/*
 * Opportunity history, kept the same way client_history is.
 *
 * opportunities will be written both by people in the app and by Skyvia's
 * incoming Salesforce sync -- the same two-source shape record_client_history()
 * was built for, and for the same reason: a trigger only sees the writes it
 * happens to be wired to catch, and it's an open question whether Skyvia's
 * connector even performs row-level UPDATEs a trigger would see. Diffing
 * current state against last-known state on a schedule works no matter how
 * the row got written, so that's the pattern here too, not a trigger.
 */

create table if not exists public.opportunity_history (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  field text not null,
  value_text text,
  valid_from timestamptz not null,
  valid_to timestamptz,
  source text not null check (source in ('seed', 'sync', 'manual')),
  created_at timestamptz not null default now()
);

create index if not exists opportunity_history_open_idx
  on public.opportunity_history (opportunity_id, field) where valid_to is null;

alter table public.opportunity_history enable row level security;

create policy opportunity_history_scoped on public.opportunity_history
  for select to authenticated
  using (public.is_factur_user()
         and exists (
           select 1 from public.opportunities o
           where o.id = opportunity_history.opportunity_id
             and (public.has_permission('org.manage')
                  or o.client_id in (select client_id from public.my_client_ids()))
         ));

create or replace view public.opportunity_field_now
with (security_invoker = true) as
select o.id as opportunity_id, f.field, f.value_text
from public.opportunities o
cross join lateral (values
  ('stage', o.stage),
  ('lead_status', o.lead_status),
  ('reached_lead', o.reached_lead::text),
  ('reached_eval_call_scheduled', o.reached_eval_call_scheduled::text),
  ('reached_selling', o.reached_selling::text),
  ('reached_discovery', o.reached_discovery::text),
  ('reached_proposal', o.reached_proposal::text),
  ('reached_closing', o.reached_closing::text)
) as f(field, value_text);

create or replace function public.record_opportunity_history(p_source text default 'sync')
returns table(opened integer, closed integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_now timestamptz := now();
  v_opened integer := 0;
  v_closed integer := 0;
begin
  if p_source not in ('seed', 'sync', 'manual') then
    raise exception 'Unknown source %', p_source using errcode = 'check_violation';
  end if;

  with changed as (
    update public.opportunity_history h
       set valid_to = v_now
      from public.opportunity_field_now c
     where h.opportunity_id = c.opportunity_id
       and h.field = c.field
       and h.valid_to is null
       and h.value_text is distinct from c.value_text
    returning 1
  )
  select count(*) into v_closed from changed;

  with added as (
    insert into public.opportunity_history (opportunity_id, field, value_text, valid_from, source)
    select c.opportunity_id, c.field, c.value_text, v_now, p_source
    from public.opportunity_field_now c
    where not exists (
      select 1 from public.opportunity_history h
      where h.opportunity_id = c.opportunity_id and h.field = c.field and h.valid_to is null
    )
    returning 1
  )
  select count(*) into v_opened from added;

  return query select v_opened, v_closed;
end;
$function$;

revoke all on function public.record_opportunity_history(text) from public, anon;
grant execute on function public.record_opportunity_history(text) to authenticated, service_role;

select cron.schedule(
  'reconcile-opportunity-history',
  '* * * * *',
  $$select public.record_opportunity_history('sync')$$
);
