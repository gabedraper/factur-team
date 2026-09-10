/*
 * Sending a collections text is its own right, separate from
 * finance.collections (the email chase flow).
 *
 * SMS consent isn't documented in every client's MSA the way email
 * follow-up is assumed to be -- only whoever holds Financial Manager
 * (currently Brenolene alone) is trusted to know, client by client,
 * whether that consent actually exists before sending. Both Brenolene and
 * Gabe hold finance.collections today; this permission intentionally goes
 * to Financial Manager only, not also to CEO.
 */
insert into public.org_permissions (key, name, description, category, position)
values ('finance.collections.sms', 'Send collections texts',
        'Send SMS payment reminders through the collections flow.',
        'Clients', 6)
on conflict (key) do nothing;

insert into public.org_role_permissions (role_id, permission_key)
select r.id, 'finance.collections.sms' from public.org_roles r
where r.slug = 'financial-manager'
on conflict (role_id, permission_key) do nothing;
