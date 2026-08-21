-- Reps see their own leads, managers their team's, admins everything.
--
-- "Manager" is taken from the reporting line rather than granted per person:
-- if someone reports to you, you see their leads. That keeps one fact in one
-- place -- the org chart -- instead of a permission that has to be remembered
-- separately every time somebody moves.

insert into public.org_permissions (key, name, description) values
  ('timelines.view.all', 'See everyone''s timelines',
   'See every lead, not just your own or your team''s.')
on conflict (key) do nothing;

insert into public.org_role_permissions (role_id, permission_key)
select r.id, 'timelines.view.all' from public.org_roles r
where r.slug in ('app-admin', 'exec')
on conflict do nothing;
