-- Stamp org_members.auth_user_id when somebody signs in for the first time.
--
-- handle_new_user() has been stamping public.reps since before org_members
-- existed, and was never extended. org_members.auth_user_id is what
-- permissionsForMember() reads, so anyone who signed in after the move landed
-- in an app that granted them nothing and had no way to say so. Ten people are
-- in that state today, two of whom signed in this afternoon.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  seeded_role text;
begin
  update public.reps
     set auth_user_id = new.id
   where lower(email) = lower(new.email)
     and auth_user_id is null;

  -- The org chart, which is what permissions are actually read from.
  update public.org_members
     set auth_user_id = new.id
   where lower(email) = lower(new.email)
     and auth_user_id is null;

  if lower(split_part(new.email, '@', 2)) in ('bethefactur.com', 'facturmfg.com') then
    select role into seeded_role
      from public.lms_initial_roles
     where lower(email) = lower(new.email);

    insert into public.profiles (id, full_name, role)
    values (
      new.id,
      coalesce(new.raw_user_meta_data->>'full_name', ''),
      coalesce(seeded_role, 'learner')
    )
    on conflict (id) do nothing;
  end if;

  return new;
end;
$function$;

-- The ten already stranded.
update public.org_members m
   set auth_user_id = u.id
  from auth.users u
 where lower(u.email) = lower(m.email)
   and m.auth_user_id is null;
