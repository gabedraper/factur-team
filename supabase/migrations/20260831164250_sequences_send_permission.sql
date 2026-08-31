/*
 * Running a sequence is its own right.
 *
 * Separate from finance.collections and nps.send, which say who may edit the
 * wording of those two particular sequences. This is who may create one, put
 * people into it, and send.
 */
insert into public.org_permissions (key, name, description, category, position)
values ('sequences.send', 'Run sequences',
        'Create sequences, add contacts to them, and send.',
        'Clients', 4)
on conflict (key) do nothing;

insert into public.org_role_permissions (role_id, permission_key)
select r.id, 'sequences.send' from public.org_roles r
where r.name in ('App Administrator', 'Team Lead')
on conflict (role_id, permission_key) do nothing;
