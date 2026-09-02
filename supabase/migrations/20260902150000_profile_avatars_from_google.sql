/*
 * Staff photos, which we already had and were not using.
 *
 * Signing in with Google returns a photo URL, and every one of the forty-eight
 * accounts has had one sitting in auth metadata since the day they first
 * signed in. profiles.avatar_url existed the whole time and was empty.
 *
 * Kept current rather than copied once: people change their Google photo, and
 * a face that is two years stale is worse than initials.
 */

create or replace function public.sync_profile_avatar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles p
  set avatar_url = coalesce(
    new.raw_user_meta_data->>'picture',
    new.raw_user_meta_data->>'avatar_url'
  )
  where p.id = new.id
    and p.avatar_url is distinct from coalesce(
      new.raw_user_meta_data->>'picture',
      new.raw_user_meta_data->>'avatar_url'
    );
  return null;
end;
$$;

/*
 * After insert as well as update: the profile row is created by its own
 * trigger on the same insert, and whichever runs second would otherwise find
 * nothing to update.
 */
drop trigger if exists sync_profile_avatar on auth.users;
create trigger sync_profile_avatar
  after insert or update of raw_user_meta_data on auth.users
  for each row execute function public.sync_profile_avatar();

update public.profiles p
set avatar_url = coalesce(
  u.raw_user_meta_data->>'picture',
  u.raw_user_meta_data->>'avatar_url'
)
from auth.users u
where u.id = p.id
  and p.avatar_url is null
  and coalesce(u.raw_user_meta_data->>'picture', u.raw_user_meta_data->>'avatar_url') is not null;
