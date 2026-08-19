-- Restrict signup to company domains and auto-create profiles server-side,
-- so role is never taken from client input.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  email_domain text;
  allowed_domains text[] := array['bethefactur.com', 'facturmfg.com'];
begin
  email_domain := lower(split_part(new.email, '@', 2));

  if not (email_domain = any(allowed_domains)) then
    raise exception 'Sign up is restricted to @bethefactur.com and @facturmfg.com email addresses';
  end if;

  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    'learner'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- Only admins (or trusted server-side/service-role code, which has no auth.uid())
-- may change a profile's role, regardless of which RLS policy allowed the update.
create or replace function public.is_admin(uid uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = uid and role = 'admin');
$$;

create or replace function public.prevent_role_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role then
    if auth.uid() is not null and not public.is_admin(auth.uid()) then
      raise exception 'Only admins can change a user''s role';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_role_change on public.profiles;
create trigger enforce_role_change
  before update on public.profiles
  for each row
  execute function public.prevent_role_escalation();
