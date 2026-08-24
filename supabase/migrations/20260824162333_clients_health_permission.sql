insert into public.org_permissions (key, name, description, category, position)
values ('clients.health', 'View client health',
        'See the client health scores and record NPS.', 'Clients', 1)
on conflict (key) do nothing;

/*
 * Granted to whoever already manages the org, rather than to everyone.
 *
 * Health pulls in receivables, so it starts with the narrower audience and can
 * be widened in Settings -> Roles. Easier to open up than to explain later why
 * the whole company could see who is behind on payment.
 */
insert into public.org_role_permissions (role_id, permission_key)
select distinct rp.role_id, 'clients.health'
from public.org_role_permissions rp
where rp.permission_key = 'org.manage'
on conflict do nothing;
