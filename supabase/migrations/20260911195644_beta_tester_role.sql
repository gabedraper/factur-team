-- A third visibility-only role beside Manager and App Administrator.
--
-- Five people are trying features before they go to everyone. They need more
-- than their job gives them and less than App Administrator, and their job
-- role must not change. A standalone role does that: it is an extra
-- assignment, and has_permission() unions across all of a member's
-- assignments. It is granted from the "Beta" checkbox on Settings > People
-- and its permissions are ticked on Settings > Roles.
--
-- It carries no permissions here on purpose; what is in beta changes.
insert into public.org_roles (service_id, slug, name, description) values
  (null, 'beta-tester', 'Beta Tester',
   'Tries features before they go to everyone. Sits beside the job role; take it away when the test ends.')
on conflict (slug) do nothing;
