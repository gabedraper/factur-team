/*
 * Reconcile the history against how things stand right now.
 *
 * Supersedes 20260827213243_record_client_history, applied minutes earlier and
 * not checked in: that version built the current-state set as a temporary table
 * declared `on commit drop`, which does not fire between two calls in the same
 * transaction -- so calling it twice in one transaction failed with "relation
 * _current already exists". A view has no lifecycle to get wrong, and is
 * independently useful as "who is on this client now".
 */
create or replace view public.client_role_now
with (security_invoker = true) as
select oc.id as client_id, f.field, f.member_id, f.value_text
from public.org_clients oc
cross join lateral (values
  ('account_manager',      oc.account_manager_id,      null::text),
  ('team_lead',            oc.team_lead_id,            null),
  ('data_team_lead',       oc.data_team_lead_id,       null),
  ('sdr',                  oc.sdr_id,                  null),
  ('marketing_strategist', oc.marketing_strategist_id, null),
  ('data_analyst',         oc.data_analyst_id,         null),
  ('data_engineer',        oc.data_engineer_id,        null),
  ('owner',                oc.member_id,               null),
  ('service',              null,                       (select s.name from public.org_services s where s.id = oc.service_id)),
  ('status',               null,                       oc.status)
) as f(field, member_id, value_text);

/*
 * Idempotent on purpose: run it hourly, nightly, or twice in a row, and it
 * writes only when something actually moved. That is what lets it hang off both
 * a schedule and the edit screens without either needing to know about the
 * other.
 *
 * A vacancy is a fact, so it is recorded too -- a client losing its account
 * manager for six weeks is exactly what this exists to show, and a design that
 * only stored occupied roles would hide it.
 */
create or replace function public.record_client_history(p_source text default 'sync')
returns TABLE(opened integer, closed integer)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_now timestamptz := now();
  v_opened integer := 0;
  v_closed integer := 0;
begin
  if p_source not in ('seed', 'sync', 'manual') then
    raise exception 'Unknown source %', p_source using errcode = 'check_violation';
  end if;

  /*
   * `is distinct from` rather than <>, so that a role becoming vacant, or being
   * filled from vacant, counts as a change. With <> a null on either side
   * compares false and the transition would be silently lost.
   */
  with changed as (
    update public.client_history h
       set valid_to = v_now
      from public.client_role_now c
     where h.client_id = c.client_id
       and h.field = c.field
       and h.valid_to is null
       and (h.member_id is distinct from c.member_id
            or h.value_text is distinct from c.value_text)
    returning 1
  )
  select count(*) into v_closed from changed;

  /*
   * Open a row wherever nothing is open -- both the rows just closed and any
   * client or field seen for the first time. A separate statement on purpose:
   * data-modifying CTEs all see the same snapshot, so an insert alongside the
   * update above would not know those rows had just been closed and would open
   * nothing.
   */
  with added as (
    insert into public.client_history (client_id, field, member_id, value_text, valid_from, source)
    select c.client_id, c.field, c.member_id, c.value_text, v_now, p_source
    from public.client_role_now c
    where not exists (
      select 1 from public.client_history h
      where h.client_id = c.client_id and h.field = c.field and h.valid_to is null
    )
    returning 1
  )
  select count(*) into v_opened from added;

  return query select v_opened, v_closed;
end;
$$;

revoke all on function public.record_client_history(text) from public, anon;
grant execute on function public.record_client_history(text) to service_role;

/* Who held a role on a client at a given moment. */
create or replace function public.client_role_at(
  p_client_id uuid, p_field text, p_at timestamptz
)
returns uuid
language sql stable
security definer
set search_path to 'public'
as $$
  select h.member_id
  from public.client_history h
  where h.client_id = p_client_id
    and h.field = p_field
    and h.valid_from <= p_at
    and (h.valid_to is null or h.valid_to > p_at)
  order by h.valid_from desc
  limit 1;
$$;

revoke all on function public.client_role_at(uuid, text, timestamptz) from public, anon;
grant execute on function public.client_role_at(uuid, text, timestamptz) to authenticated, service_role;

-- The starting line. Everything before this moment was never recorded.
select public.record_client_history('seed');
