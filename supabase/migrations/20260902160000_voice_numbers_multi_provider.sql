/*
 * dialpad_numbers -> voice_numbers: the rotation pool now spans providers.
 * Twilio is Plan B while the Dialpad Mini Dialer Client ID is still pending
 * -- same rotation problem (protect caller-ID reputation), different vendor,
 * so this generalizes the one table rather than duplicating it. Existing
 * rows (none provisioned yet) default to provider='dialpad'.
 *
 * A pool entry's e164 must be a real number already purchased on that
 * provider's account -- Twilio in particular rejects a Dial callerId that
 * isn't either Twilio-owned or separately verified, so this table still
 * doesn't buy anything, same as before.
 */

alter table public.dialpad_numbers rename to voice_numbers;

alter table public.voice_numbers
  add column if not exists provider text not null default 'dialpad' check (provider in ('dialpad', 'twilio'));

drop index if exists dialpad_numbers_rotation_idx;
create index if not exists voice_numbers_rotation_idx
  on public.voice_numbers (provider, assigned_member_id, status, last_used_at nulls first);

alter table public.voice_numbers drop constraint if exists dialpad_numbers_e164_key;
alter table public.voice_numbers add constraint voice_numbers_e164_key unique (e164);

drop policy if exists dialpad_numbers_read on public.voice_numbers;
drop policy if exists dialpad_numbers_manage on public.voice_numbers;

create policy voice_numbers_read on public.voice_numbers
  for select to authenticated
  using (public.is_factur_user());

create policy voice_numbers_manage on public.voice_numbers
  for all to authenticated
  using (public.is_factur_user() and public.has_permission('org.manage'))
  with check (public.is_factur_user() and public.has_permission('org.manage'));

/* claim_dialpad_number -> claim_voice_number: same logic, provider-scoped. */
drop function if exists public.claim_dialpad_number(uuid);

create or replace function public.claim_voice_number(p_member_id uuid, p_provider text)
returns table(e164 text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  if p_provider not in ('dialpad', 'twilio') then
    raise exception 'Unknown provider %', p_provider using errcode = 'check_violation';
  end if;

  select id into v_id
  from public.voice_numbers
  where status = 'active' and provider = p_provider and assigned_member_id = p_member_id
  order by last_used_at nulls first
  limit 1
  for update skip locked;

  if v_id is null then
    select id into v_id
    from public.voice_numbers
    where status = 'active' and provider = p_provider and assigned_member_id is null
    order by last_used_at nulls first
    limit 1
    for update skip locked;
  end if;

  if v_id is null then
    return;
  end if;

  return query
  update public.voice_numbers
  set last_used_at = now(), calls_placed = calls_placed + 1
  where id = v_id
  returning voice_numbers.e164;
end;
$function$;

revoke all on function public.claim_voice_number(uuid, text) from public, anon;
grant execute on function public.claim_voice_number(uuid, text) to authenticated;
