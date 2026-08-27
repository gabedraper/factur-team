/*
 * A campaign stamps its team onto every invitation as it is built.
 *
 * At build time rather than at send time: a campaign can sit in draft for a
 * week, and the people credited should be the ones it was built around.
 *
 * Only the `perform public.freeze_nps_send_team(v_campaign)` line differs from
 * the previous definition; the rest is unchanged and repeated because the
 * function has to be replaced whole.
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

  perform public.freeze_nps_send_team(v_campaign);

  return query select v_campaign, v_made, v_named, v_skipped;
end;
$$;

revoke all on function public.create_nps_campaign(text, date) from public, anon;
grant execute on function public.create_nps_campaign(text, date) to authenticated, service_role;
