-- Seeding what Salesforce can answer, and stopping where it cannot.
--
-- The widened client sync brought over Account_Manager__c and Service__c, which
-- between them cover most of what would otherwise have been assigned by hand
-- across 200 clients.

-- Tony Haight has left. Inactive rather than deleted: his clients and history
-- stay attached and visible.
update public.org_members set active = false
where lower(email) = 'tony.haight@facturmfg.com';

-- Owner: the Salesforce account manager, matched on Salesforce id first and
-- exact name second. Only fills clients nobody has claimed in the app, so any
-- assignment already made by hand wins over this.
update public.org_clients c
set member_id = m.id
from public.sf_clients_raw s
join public.org_members m
  on m.salesforce_user_id = s.account_manager__c
  or lower(m.full_name) = lower(s.account_manager__r_name)
where c.salesforce_client_id = s.id
  and s.account_manager__c is not null
  and c.member_id is null and c.team_id is null;

-- Service: only where Salesforce names exactly one and it maps cleanly.
-- Service__c is a multipicklist; a client carrying two services has no single
-- right answer, so those are left for a person rather than guessed.
update public.org_clients c
set service_id = svc.id
from public.sf_clients_raw s
join public.org_services svc on svc.slug = case
    when s.service__c in ('OP','OSDR','Constructur - OBDM','Constructur - OSDR','SMB - OSDR','SMB - OBDM')
      then 'outsourced-prospecting'
    when s.service__c in ('Sales','Sales Enablement') then 'factur-sales'
    when s.service__c in ('LG','Constructur - LG') then 'lead-generation'
    when s.service__c in ('Precision Marketing','Website Project','Website Maintenance','LinkedIn Advertising')
      then 'marketing-revops'
  end
where c.salesforce_client_id = s.id
  and s.service__c is not null and s.service__c not like '%;%'
  and c.service_id is null;

-- Link people to Salesforce where the match is exact: same email, or an exact
-- name against a real (non-integration) account. Anything fuzzier stays on the
-- review screen, which is where the dangerous near-misses live -- "Matt Cool"
-- scores 0.50 against "Matt Beaver".
with real_sf as (
  select id, name, email from public.sf_users_raw
  where isactive
    and email not like '%@00d%' and email not like 'noreply@%'
    and name not ilike '%site guest user%' and name not ilike '%integration%'
    and name not ilike 'automated%' and name not ilike 'security user'
    and name not ilike 'system' and name not ilike 'data.com%'
),
exact as (
  select m.id as member_id, s.id as sf_id,
         row_number() over (partition by m.id order by (lower(s.email) = m.email) desc) as rn
  from public.org_members m
  join real_sf s on lower(s.email) = m.email or lower(s.name) = lower(m.full_name)
  where m.salesforce_user_id is null
)
update public.org_members m
set salesforce_user_id = e.sf_id
from exact e where e.member_id = m.id and e.rn = 1;

-- Roles, now that UserRole finally syncs -- this is what the hand-written
-- mapping in 20260820231029 existed to work around. Only the unambiguous ones:
-- "Sales" and "OBDM/OSDR Revised 25' Role" name two jobs or none.
insert into public.org_assignments (member_id, role_id, team_id, allocation, is_primary)
select m.id, r.id, null, 100, true
from public.org_members m
join public.sf_users_raw s on s.id = m.salesforce_user_id
join public.org_roles r on r.slug = case s.userrole_name
    when 'OBDM' then 'obdm'
    when 'SDR' then 'sdr'
    when 'BDM' then 'bdm'
    when 'Lead Generation' then 'leadgen'
    when 'RevOps Leader' then 'revops'
    when 'CEO' then 'exec'
    when 'Outsourced Prospecting' then case when s.title = 'BDP' then 'bdp' else 'osdr' end
  end
where not exists (select 1 from public.org_assignments a where a.member_id = m.id)
on conflict do nothing;

update public.org_members m set needs_review = false
where exists (select 1 from public.org_assignments a where a.member_id = m.id);
