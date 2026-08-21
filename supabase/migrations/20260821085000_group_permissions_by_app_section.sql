-- Permissions grouped by the part of the app they govern, so the roles screen
-- reads like the navigation rather than one flat list of keys.
--
-- Category is stored rather than parsed from the key prefix: "org.manage" is
-- Administration and "timelines.view.all" is Timelines, and a naming convention
-- is a weak thing to hang a UI on when someone adds a key that does not follow it.

alter table public.org_permissions
  add column if not exists category text not null default 'Other',
  add column if not exists position integer not null default 0;

update public.org_permissions set category = 'Learn', position = 1 where key = 'lms.admin';
update public.org_permissions set category = 'Learn', position = 2 where key = 'lms.instruct';
update public.org_permissions set category = 'Scoreboard', position = 1 where key = 'scoreboard.view';
update public.org_permissions set category = 'Scoreboard', position = 2 where key = 'scoreboard.retention.unmask';
update public.org_permissions set category = 'Scoreboard', position = 3 where key = 'scoreboard.weights.edit';
update public.org_permissions set category = 'Timelines', position = 1 where key = 'timelines.view';
update public.org_permissions set category = 'Timelines', position = 2 where key = 'timelines.view.all';
update public.org_permissions set category = 'Administration', position = 1 where key = 'org.manage';
