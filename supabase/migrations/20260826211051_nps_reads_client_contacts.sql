/*
 * NPS recipients come from client_contacts rather than straight off
 * sf_clients_raw.
 *
 * Three things follow. Names arrive with the address instead of through a
 * separate lookup. A hand-corrected contact beats the synced one. And opted-out
 * or bounced addresses are gone before the campaign is built, because
 * client_contact_current excludes them -- "do not email this person" should be
 * impossible to forget rather than something every caller remembers to filter.
 *
 * Primary first, decision maker if there is no primary: the survey asks how the
 * relationship is going, so it goes to whoever actually deals with us.
 */
drop function if exists public.create_nps_campaign(text, date);

create or replace function public.create_nps_campaign(p_name text, p_period date)
returns table (campaign_id uuid, invitations integer, named integer, skipped integer)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_campaign uuid;
  v_made integer;
  v_named integer;
  v_skipped integer;
begin
  if not (public.is_factur_user()
          and (public.has_permission('nps.send') or public.has_permission('org.manage'))) then
    raise exception 'Not permitted.' using errcode = 'insufficient_privilege';
  end if;

  if coalesce(btrim(p_name), '') = '' then
    raise exception 'A campaign needs a name.' using errcode = 'check_violation';
  end if;

  insert into public.nps_campaigns (name, period, status, source, created_by)
  values (btrim(p_name), p_period, 'draft', 'app', auth.uid())
  returning id into v_campaign;

  with eligible as (
    select
      oc.id as client_id,
      coalesce(p.email, d.email) as email,
      coalesce(p.first_name, d.first_name) as first_name,
      coalesce(oc.team_lead_id, am.manager_member_id) as lead_id
    from public.org_clients oc
    join public.sf_clients_raw c on c.id = oc.salesforce_client_id
    left join public.org_members am on am.id = oc.account_manager_id
    left join public.client_contact_current p
      on p.client_id = oc.id and p.role = 'primary'
    left join public.client_contact_current d
      on d.client_id = oc.id and d.role = 'decision_maker'
    where c.client_status__c = 'Active'
  ),
  made as (
    insert into public.nps_sends (campaign_id, client_id, recipient_email, recipient_name)
    select v_campaign, e.client_id, lower(e.email), nullif(btrim(e.first_name), '')
    from eligible e
    where e.email is not null and e.lead_id is not null
    on conflict (campaign_id, client_id, recipient_email) do nothing
    returning recipient_name
  )
  select
    (select count(*) from made),
    (select count(*) from made where recipient_name is not null),
    (select count(*) from eligible where email is null or lead_id is null)
  into v_made, v_named, v_skipped;

  return query select v_campaign, v_made, v_named, v_skipped;
end;
$$;

revoke all on function public.create_nps_campaign(text, date) from public, anon;
grant execute on function public.create_nps_campaign(text, date) to authenticated, service_role;

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
    coalesce(p.email, d.email) is not null,
    coalesce(oc.team_lead_id, am.manager_member_id) is not null,
    coalesce(tl.full_name, amgr.full_name),
    case
      when coalesce(oc.team_lead_id, am.manager_member_id) is null
        and oc.account_manager_id is null then 'No account manager'
      when coalesce(oc.team_lead_id, am.manager_member_id) is null
        then 'Account manager has no manager set'
      -- A contact that exists but has opted out or bounced is a different
      -- problem from never having had one, and needs a different fix.
      when coalesce(p.email, d.email) is null
        and exists (select 1 from public.client_contacts x
                    where x.client_id = oc.id
                      and x.role in ('primary', 'decision_maker'))
        then 'Contact opted out or bounced'
      else null
    end
  from public.org_clients oc
  join public.sf_clients_raw c on c.id = oc.salesforce_client_id
  left join public.org_members am   on am.id   = oc.account_manager_id
  left join public.org_members tl   on tl.id   = oc.team_lead_id
  left join public.org_members amgr on amgr.id = am.manager_member_id
  left join public.client_contact_current p on p.client_id = oc.id and p.role = 'primary'
  left join public.client_contact_current d on d.client_id = oc.id and d.role = 'decision_maker'
  where c.client_status__c = 'Active'
    and public.is_factur_user()
  order by oc.name;
$$;

revoke all on function public.nps_campaign_readiness() from public;
grant execute on function public.nps_campaign_readiness() to authenticated, service_role;
