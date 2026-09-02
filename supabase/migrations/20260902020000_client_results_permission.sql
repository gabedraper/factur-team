/*
 * A permission of its own for Client Results.
 *
 * The section has been riding on clients.health since it was built, which
 * conflates two different audiences: health is the operational view of live
 * accounts, results is the historical record across all 987 clients including
 * every one that has left, with billing rates and quote values on it. Those
 * should be grantable apart.
 *
 * Granted here to exactly the roles that hold clients.health today, so this
 * changes nobody's access on the way in -- it only makes it possible to change
 * it afterwards, in either direction.
 */
insert into public.org_permissions (key, name, description, category, position)
values (
  'clients.results',
  'View client results',
  'The historical record of what every client was delivered, month by month.',
  'Clients',
  2
)
on conflict (key) do nothing;

-- Room for it beside client health rather than at the end of the list.
update public.org_permissions
   set position = position + 1
 where category = 'Clients' and position >= 2 and key <> 'clients.results';

insert into public.org_role_permissions (role_id, permission_key)
select p.role_id, 'clients.results'
from public.org_role_permissions p
where p.permission_key = 'clients.health'
on conflict do nothing;
