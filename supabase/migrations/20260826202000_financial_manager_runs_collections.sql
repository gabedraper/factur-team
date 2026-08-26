/*
 * Collections belongs to the person who does it.
 *
 * Granted to the role rather than to an address, so it survives Brenolene being
 * on leave or the job changing hands. Admins reach it through org.manage as
 * they do everything else.
 */
insert into public.org_role_permissions (role_id, permission_key)
select r.id, 'finance.collections'
from public.org_roles r
where r.slug = 'financial-manager'
on conflict do nothing;
