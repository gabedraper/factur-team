-- Whose requests Gaib builds and puts live without waiting for approval.
-- The guard on the actual change (lib/gaib/danger.ts) still holds back
-- anything near sign-in, money or Gaib's own rules, whoever asked.
insert into public.org_permissions (key, name, description, category, position)
values (
  'gaib.ship',
  'Gaib ships my requests',
  'Fixes and ideas this person asks Gaib for are built and put live without waiting for approval.',
  'Administration',
  3
)
on conflict (key) do nothing;

insert into public.org_role_permissions (role_id, permission_key)
select id, 'gaib.ship' from public.org_roles where name = 'CEO'
on conflict do nothing;
