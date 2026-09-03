/*
 * Plan C: Twilio's own signup flow couldn't deliver a 2FA code after
 * repeated tries, so Telnyx is the third provider in the rotation pool.
 * Same reasoning as when Twilio was added to what was Dialpad-only --
 * generalize the constraint, not duplicate the table.
 */
alter table public.voice_numbers drop constraint if exists voice_numbers_provider_check;
alter table public.voice_numbers add constraint voice_numbers_provider_check
  check (provider in ('dialpad', 'twilio', 'telnyx'));

drop function if exists public.claim_voice_number(uuid, text);

create or replace function public.claim_voice_number(p_member_id uuid, p_provider text)
returns table(e164 text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  if p_provider not in ('dialpad', 'twilio', 'telnyx') then
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
