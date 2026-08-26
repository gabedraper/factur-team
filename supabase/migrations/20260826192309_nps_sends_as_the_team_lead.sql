/*
 * A survey goes out from the client's team lead, not from whoever owns the
 * client day to day.
 *
 * This is how the existing process already works -- all fifteen imported
 * responses carry darryl.mechell@facturmfg.com as the team lead -- and it is a
 * better fit than the per-owner design the NPS brief started with. Three
 * things fall out of it:
 *
 *   - Four people cover the entire Active list instead of twenty.
 *   - The shared customer-success mailbox can never be a sender. It owns 37
 *     clients, but a mailbox has a team lead like anyone else, and that lead is
 *     a person.
 *   - Coverage goes from 108/158 under the per-owner rule to 151/157.
 *
 * The lead is resolved exactly as org_client_team already resolves it: the
 * explicit team_lead_id when one is set, and the account manager's manager
 * otherwise. Not re-derived here -- one definition of who leads a client.
 */

create or replace function public.nps_sender_coverage()
returns table (email text, full_name text, clients bigint)
language sql
security definer
set search_path to 'public'
as $$
  select tl.email, tl.full_name, count(*)
  from public.org_clients oc
  join public.sf_clients_raw c on c.id = oc.salesforce_client_id
  left join public.org_members am on am.id = oc.account_manager_id
  join public.org_members tl
    on tl.id = coalesce(oc.team_lead_id, am.manager_member_id)
  where c.client_status__c = 'Active'
    and public.is_factur_user()
  group by tl.email, tl.full_name
  order by count(*) desc;
$$;

-- Return type changes, so it is dropped rather than replaced.
drop function if exists public.nps_campaign_readiness();

create or replace function public.nps_campaign_readiness()
returns table (
  client_id uuid,
  client_name text,
  has_contact_email boolean,
  has_team_lead boolean,
  team_lead text,
  blocker text
)
language sql
security definer
set search_path to 'public'
as $$
  select
    oc.id,
    oc.name,
    coalesce(nullif(btrim(c.client_main_contact_email__c), '') is not null
          or nullif(btrim(c.client_decision_maker_contact_email__c), '') is not null, false),
    coalesce(oc.team_lead_id, am.manager_member_id) is not null,
    coalesce(tl.full_name, amgr.full_name),
    -- Named apart because they are fixed in different places: no account
    -- manager is set on the client, a manager-less account manager in People.
    case
      when coalesce(oc.team_lead_id, am.manager_member_id) is not null then null
      when oc.account_manager_id is null then 'No account manager'
      else 'Account manager has no manager set'
    end
  from public.org_clients oc
  join public.sf_clients_raw c on c.id = oc.salesforce_client_id
  left join public.org_members am   on am.id   = oc.account_manager_id
  left join public.org_members tl   on tl.id   = oc.team_lead_id
  left join public.org_members amgr on amgr.id = am.manager_member_id
  where c.client_status__c = 'Active'
    and public.is_factur_user()
  order by oc.name;
$$;

revoke all on function public.nps_campaign_readiness() from public;
grant execute on function public.nps_campaign_readiness() to authenticated, service_role;
