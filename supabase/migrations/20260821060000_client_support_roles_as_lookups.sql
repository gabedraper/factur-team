-- The people supporting a client, as real references to app users rather than
-- the free text and picklists Salesforce holds them in.
--
-- Salesforce stores most of these as a name typed or picked from a list, and it
-- drifts: "Jessica Graves" against "Jess Graves", "Zorina Olson" against
-- "Zorina Reyes", "Gedalia Tobias" against "Gedaliah Tobias". A reference cannot
-- drift, and a client's team survives someone changing their name.

alter table public.org_clients
  add column if not exists account_manager_id      uuid references public.org_members(id) on delete set null,
  add column if not exists marketing_strategist_id uuid references public.org_members(id) on delete set null,
  add column if not exists data_analyst_id         uuid references public.org_members(id) on delete set null,
  add column if not exists data_engineer_id        uuid references public.org_members(id) on delete set null,
  add column if not exists sdr_id                  uuid references public.org_members(id) on delete set null,
  -- Nullable on purpose: normally derived from the relevant person's manager,
  -- stored only when someone overrides that.
  add column if not exists team_lead_id            uuid references public.org_members(id) on delete set null,
  add column if not exists data_team_lead_id       uuid references public.org_members(id) on delete set null;

comment on column public.org_clients.team_lead_id is
  'Override. Normally the account manager''s manager -- read org_client_team, not this column.';
comment on column public.org_clients.data_team_lead_id is
  'Override. Normally the data analyst''s manager -- read org_client_team, not this column.';

-- Seed from Salesforce. Account manager is a real lookup there so it matches on
-- id; the rest are names, matched exactly and left null otherwise.
update public.org_clients c set account_manager_id = m.id
from public.sf_clients_raw s join public.org_members m on m.salesforce_user_id = s.account_manager__c
where c.salesforce_client_id = s.id and c.account_manager_id is null;

update public.org_clients c set data_analyst_id = m.id
from public.sf_clients_raw s join public.org_members m on lower(m.full_name) = lower(s.data_analyst__c)
where c.salesforce_client_id = s.id and c.data_analyst_id is null;

update public.org_clients c set data_engineer_id = m.id
from public.sf_clients_raw s join public.org_members m on lower(m.full_name) = lower(s.data_engineer__c)
where c.salesforce_client_id = s.id and c.data_engineer_id is null;

update public.org_clients c set marketing_strategist_id = m.id
from public.sf_clients_raw s join public.org_members m on lower(m.full_name) = lower(s.marketing_analyst__c)
where c.salesforce_client_id = s.id and c.marketing_strategist_id is null;

-- Stored only where Salesforce disagrees with the reporting line; otherwise it
-- stays null and is derived, so moving someone between managers updates every
-- client they touch at once.
update public.org_clients c set team_lead_id = m.id
from public.sf_clients_raw s join public.org_members m on lower(m.full_name) = lower(s.team_lead__c)
where c.salesforce_client_id = s.id and c.team_lead_id is null
  and m.id is distinct from (
    select am.manager_member_id from public.org_members am where am.id = c.account_manager_id
  );

-- The client's team with the leads resolved: stored override first, otherwise
-- the manager of the person doing the work.
create or replace view public.org_client_team as
select c.id as client_id, c.name as client_name, c.status,
       c.account_manager_id, am.full_name as account_manager,
       c.marketing_strategist_id, ms.full_name as marketing_strategist,
       c.data_analyst_id, da.full_name as data_analyst,
       c.data_engineer_id, de.full_name as data_engineer,
       c.sdr_id, sdr.full_name as sdr,
       coalesce(c.team_lead_id, am.manager_member_id) as effective_team_lead_id,
       coalesce(tl.full_name, amgr.full_name) as team_lead,
       (c.team_lead_id is not null) as team_lead_overridden,
       coalesce(c.data_team_lead_id, da.manager_member_id) as effective_data_team_lead_id,
       coalesce(dtl.full_name, dmgr.full_name) as data_team_lead,
       (c.data_team_lead_id is not null) as data_team_lead_overridden
from public.org_clients c
left join public.org_members am  on am.id  = c.account_manager_id
left join public.org_members ms  on ms.id  = c.marketing_strategist_id
left join public.org_members da  on da.id  = c.data_analyst_id
left join public.org_members de  on de.id  = c.data_engineer_id
left join public.org_members sdr on sdr.id = c.sdr_id
left join public.org_members tl  on tl.id  = c.team_lead_id
left join public.org_members dtl on dtl.id = c.data_team_lead_id
left join public.org_members amgr on amgr.id = am.manager_member_id
left join public.org_members dmgr on dmgr.id = da.manager_member_id
where public.is_factur_user();
