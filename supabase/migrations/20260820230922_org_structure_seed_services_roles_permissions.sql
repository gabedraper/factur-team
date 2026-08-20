-- The taxonomy itself, drawn from what Salesforce shows people actually doing
-- rather than invented. Two lines of business dominate: prospecting run on
-- behalf of clients, and Factur selling its own services.

insert into public.org_services (slug, name, description, position) values
  ('outsourced-prospecting', 'Outsourced Prospecting',
   'Prospecting run on behalf of client companies. Nearly all opportunity volume sits here.', 1),
  ('factur-sales', 'Factur Sales', 'Selling Factur''s own services to prospective clients.', 2),
  ('lead-generation', 'Lead Generation', 'Building and enriching the lists both sales motions work from.', 3),
  ('service-delivery', 'Service Delivery', 'Looking after clients once they are signed.', 4),
  ('marketing-revops', 'Marketing & RevOps',
   'Demand generation, reporting, and the systems the other services run on.', 5),
  ('leadership', 'Leadership & Operations', 'Executive, finance and operations.', 6);

insert into public.org_teams (service_id, slug, name, description)
select id, slug, name, 'Seeded as one team per service. Split into real teams as needed.'
from public.org_services;

insert into public.org_roles (service_id, slug, name, description)
select s.id, r.slug, r.name, r.description
from (values
  ('outsourced-prospecting','obdm','OBDM','Outsourced business development manager, working a client''s pipeline.'),
  ('outsourced-prospecting','osdr','OSDR','Outsourced sales development rep, prospecting on a client''s behalf.'),
  ('outsourced-prospecting','bdp','BDP','Business development prospector.'),
  ('factur-sales','bdm','BDM','Business development manager selling Factur''s services.'),
  ('factur-sales','sdr','SDR','Sales development rep for Factur''s own pipeline.'),
  ('lead-generation','leadgen','Lead Generation Specialist',null),
  ('service-delivery','service-delivery','Service Delivery',null),
  ('marketing-revops','revops','RevOps / Marketing',null),
  ('leadership','exec','Executive',null),
  ('leadership','operations','Operations',null)
) as r(service_slug, slug, name, description)
join public.org_services s on s.slug = r.service_slug;

-- A manager role that is deliberately not tied to a service: it says what
-- someone may see, not what line of business they are in.
insert into public.org_roles (service_id, slug, name, description) values
  (null,'manager','Manager','Sees their team''s data unmasked across every board.'),
  (null,'app-admin','App Administrator','Runs the app itself: people, roles, courses, scoring.');

insert into public.org_permissions (key, name, description) values
  ('org.manage','Manage people and roles','Add people, assign roles and teams, edit permissions.'),
  ('lms.admin','Administer training','Manage courses, enrolments and role training.'),
  ('lms.instruct','Author training','Create and edit courses and lessons.'),
  ('scoreboard.view','View scoreboards','See the hustle, deals and retention boards.'),
  ('scoreboard.retention.unmask','See retention detail','See other people''s names and detail on the retention board.'),
  ('scoreboard.weights.edit','Edit scoring weights','Change how hustle points and deals are scored.'),
  ('timelines.view','View opportunity timelines',null);

-- Everyone who works here sees the boards and the timelines.
insert into public.org_role_permissions (role_id, permission_key)
select r.id, p.key from public.org_roles r
cross join (values ('scoreboard.view'), ('timelines.view')) as p(key)
where r.active;

-- Managers see retention detail; admins and execs run the place.
insert into public.org_role_permissions (role_id, permission_key)
select r.id, 'scoreboard.retention.unmask' from public.org_roles r
where r.slug in ('manager','app-admin','exec');

insert into public.org_role_permissions (role_id, permission_key)
select r.id, p.key from public.org_roles r
cross join (values ('org.manage'),('lms.admin'),('lms.instruct'),('scoreboard.weights.edit')) as p(key)
where r.slug in ('app-admin','exec');
