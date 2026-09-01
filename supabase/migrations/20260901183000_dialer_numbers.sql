/*
 * The outbound number pool for the click-to-dial widget.
 *
 * Reps place calls through Dialpad's Mini Dialer, embedded client-side --
 * that flow never touches our server, so this table is the one thing about
 * dialing that *is* ours: which of the company's reserved Dialpad numbers
 * presents as caller ID for a given call. Repeated outbound calls from one
 * number get carrier/app spam-flagged over time (the voice equivalent of a
 * cold-email domain losing reputation), so calls rotate across a pool
 * instead of all going out from one line.
 *
 * A number is provisioned here by hand once it's been purchased and
 * reserved in Dialpad's own admin -- this table doesn't call Dialpad's
 * Numbers API to buy anything, it just tracks the pool we've already bought
 * and the rotation state, which is the part Dialpad has no opinion on.
 *
 * assigned_member_id narrows a number to one rep's pool; left null it's
 * shared across everyone with pipeline access. Rotation always prefers a
 * number assigned to the calling rep before falling back to the shared pool,
 * so a lead who's heard from a rep before keeps hearing from a familiar
 * number where possible.
 */

create table if not exists public.dialpad_numbers (
  id uuid primary key default gen_random_uuid(),
  e164 text unique not null,
  label text,
  assigned_member_id uuid references public.org_members(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'paused', 'flagged')),
  last_used_at timestamptz,
  calls_placed integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references public.org_members(id)
);

create index if not exists dialpad_numbers_rotation_idx
  on public.dialpad_numbers (assigned_member_id, status, last_used_at nulls first);

alter table public.dialpad_numbers enable row level security;

-- Anyone with pipeline access needs to read the pool to place a call; only
-- org.manage provisions or pauses a number.
create policy dialpad_numbers_read on public.dialpad_numbers
  for select to authenticated
  using (public.is_factur_user());

create policy dialpad_numbers_manage on public.dialpad_numbers
  for all to authenticated
  using (public.is_factur_user() and public.has_permission('org.manage'))
  with check (public.is_factur_user() and public.has_permission('org.manage'));

/*
 * Claims the least-recently-used active number for a call, preferring the
 * calling rep's own assigned numbers over the shared pool, and immediately
 * marks it used -- the update is inside the same statement as the pick
 * (order + limit + update, not a separate select-then-update) so two reps
 * dialing at once can't both walk away with the same number.
 */
create or replace function public.claim_dialpad_number(p_member_id uuid)
returns table(e164 text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  select id into v_id
  from public.dialpad_numbers
  where status = 'active' and assigned_member_id = p_member_id
  order by last_used_at nulls first
  limit 1
  for update skip locked;

  if v_id is null then
    select id into v_id
    from public.dialpad_numbers
    where status = 'active' and assigned_member_id is null
    order by last_used_at nulls first
    limit 1
    for update skip locked;
  end if;

  if v_id is null then
    return;
  end if;

  return query
  update public.dialpad_numbers
  set last_used_at = now(), calls_placed = calls_placed + 1
  where id = v_id
  returning dialpad_numbers.e164;
end;
$function$;

revoke all on function public.claim_dialpad_number(uuid) from public, anon;
grant execute on function public.claim_dialpad_number(uuid) to authenticated;
