-- One-time import of people from Salesforce. After this the app is the source
-- of truth and Salesforce is never consulted for roles again.
--
-- Mapped explicitly rather than by joining sf_users_raw, for two reasons: that
-- table carries no UserRole at all, and its emails are not unique -- three
-- guest/integration accounts reuse a real person's address, so an email join
-- would attach a role to the wrong row.
--
-- needs_review marks the people whose Salesforce role could not be resolved
-- confidently: a blank role, a role named after a permission set rather than a
-- job ("OBDM/OSDR Revised 25' Role", ambiguous between the two), or a shared
-- mailbox rather than a person.

create temp table seed(email text, full_name text, sf_id text, role_slug text, review boolean) on commit drop;
insert into seed values
  ('alyssa.davis@facturmfg.com','Alyssa Davis','005VI00000IqRTBYA3','bdm',false),
  ('ashley.sanders@facturmfg.com','Ashley Sanders','005VI00000EpYnZYAV','bdm',false),
  ('caleb.deering@facturmfg.com','Caleb Deering','005VI000009mg4dYAA','sdr',false),
  ('evan.gonzalez@facturmfg.com','Evan Gonzalez','005VI00000IvbjdYAB','sdr',false),
  ('elijah.condellone@facturmfg.com','Elijah Condellone','0051R00000HhHw8QAF','bdm',false),
  ('nash.rushing@facturmfg.com','Nash Rushing','005VI00000IzLd3YAF','bdm',false),
  ('craig.mackenzie@facturmfg.com','Craig Mackenzie','0051R00000JTlnjQAD','obdm',false),
  ('deandre.dowell@facturmfg.com','DeAndre Dowell','0051R00000JDXL2QAP','obdm',false),
  ('dylan.murray@facturmfg.com','Dylan Murray','005VI00000ak3KkYAI','obdm',false),
  ('eli@bethefactur.com','Eli Garcia II','0051R00000InrARQAZ','obdm',false),
  ('jacob.warrens@facturmfg.com','Jacob Warrens','005VI000007yvLxYAI','obdm',false),
  ('john.boss@facturmfg.com','John Boss','0051R00000HKsdOQAT','obdm',false),
  ('jon.montgomery@facturmfg.com','Jon Montgomery','005VI00000BzUXZYA3','obdm',false),
  ('josh@bethefactur.com','Josh Hobson','0051R00000K32eKQAR','obdm',false),
  ('lance.rhodes@facturmfg.com','Lance Rhodes','005VI00000IqQs5YAF','obdm',false),
  ('parker.blodgett@facturmfg.com','Parker Blodgett','005VI00000iicxuYAA','obdm',false),
  ('derek.cavanaugh@facturmfg.com','Derek Cavanaugh','005VI00000MtvqbYAB','osdr',false),
  ('noah.funk@facturmfg.com','Noah Funk','005VI00000MtvLxYAJ','osdr',false),
  ('matt@bethefactur.com','Matt Beaver','0051R00000ICL99QAH','bdp',false),
  ('srdjan@bethefactur.com','Srdjan Todorovic','0051R00000HKCLSQA5','leadgen',false),
  ('chad@bethefactur.com','Chad Kinner','0051Hq00000LjmEQIAZ','revops',false),
  ('gabe@bethefactur.com','Gabe Draper','005360000025FTaAAM','exec',false),
  -- Ambiguous or blank in Salesforce; an admin decides.
  ('camryn.cruden@facturmfg.com','Camryn Cruden','005VI00000CTYIjYAP',null,true),
  ('meghan.mooney@facturmfg.com','Meghan Mooney','0051R00000JUQmnQAH',null,true),
  ('phil.tubman@facturmfg.com','Phil Tubman','005VI00000X1gYUYAZ',null,true),
  ('tanaka.mwafuli@facturmfg.com','Tanaka Mwafuli','005VI00000aUuRRYA0',null,true),
  ('brenolene.govender@facturmfg.com','Brenolene Govender','005VI00000jPuptYAC',null,true),
  ('darryl@bethefactur.com','Darryl Mechell','0051R00000Hi1HLQAZ',null,true),
  ('irena@bethefactur.com','Irena Sisic','0051R00000Hi9A3QAJ',null,true),
  ('miljan@bethefactur.com','Miljan Todorovic','00536000008FNDHAA4',null,true),
  -- Shared mailboxes, not people. Kept so nothing silently disappears.
  ('operations@facturmfg.com','Factur Operations','0051R00000JEMi8QAH',null,true),
  ('facturcustomersuccess@facturmfg.com','Service Delivery Operations','005VI00000LjYe9YAF',null,true),
  ('leads@bethefactur.com','Lg Leads','0051R00000IuBCXQA3',null,true);

insert into public.org_members (email, full_name, salesforce_user_id, needs_review)
select lower(s.email), s.full_name, s.sf_id, s.review from seed s
on conflict (email) do nothing;

-- Anyone already in the app but absent from that list: reps who work the boards
-- and people who have signed in. They need a role picked by hand.
insert into public.org_members (email, full_name, needs_review)
select lower(r.email), r.display_name, true from public.reps r
where r.email is not null and r.active
on conflict (email) do nothing;

insert into public.org_members (email, full_name, needs_review)
select lower(u.email), coalesce(p.full_name, u.email), true
from auth.users u left join public.profiles p on p.id = u.id
where u.email is not null
on conflict (email) do nothing;

-- Link to the app's own records.
update public.org_members m set auth_user_id = u.id
from auth.users u where lower(u.email) = m.email and m.auth_user_id is null;

update public.org_members m set rep_id = r.id
from public.reps r where lower(r.email) = m.email and m.rep_id is null;

update public.org_members m set full_name = coalesce(m.full_name, p.full_name)
from public.profiles p where p.id = m.auth_user_id;

-- Reporting lines, from the rep hierarchy the scoreboard already maintains.
update public.org_members m set manager_member_id = mgr.id
from public.reps r
join public.reps mr on mr.id = r.manager_rep_id
join public.org_members mgr on mgr.rep_id = mr.id
where m.rep_id = r.id and m.manager_member_id is null;

-- Primary assignment, onto that role's seeded team.
insert into public.org_assignments (member_id, role_id, team_id, is_primary)
select m.id, ro.id, t.id, true
from public.org_members m
join seed s on lower(s.email) = m.email and s.role_slug is not null
join public.org_roles ro on ro.slug = s.role_slug
left join public.org_teams t on t.service_id = ro.service_id
on conflict do nothing;

-- Whoever already administers the app keeps doing so, or nobody could get in
-- to fix any of the above.
insert into public.org_assignments (member_id, role_id, is_primary)
select distinct m.id, ro.id, false
from public.org_members m
join public.org_roles ro on ro.slug = 'app-admin'
where m.rep_id in (select id from public.reps where is_admin)
   or m.auth_user_id in (select id from public.profiles where role = 'admin')
on conflict do nothing;

-- Managers, by the same rule the scoreboard already uses: someone reports to you.
insert into public.org_assignments (member_id, role_id, is_primary)
select distinct mgr.id, ro.id, false
from public.org_members m
join public.org_members mgr on mgr.id = m.manager_member_id
join public.org_roles ro on ro.slug = 'manager'
on conflict do nothing;
