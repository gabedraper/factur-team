/*
 * Build a campaign: one invitation per eligible Active client.
 *
 * Eligible means both halves are present -- somebody to write to and somebody
 * to write as. A client missing either is left out rather than half-created,
 * because an invitation with no address is one the queue would offer forever.
 *
 * Nothing is emailed here. This only mints the invitations and their tokens, so
 * a campaign can be built, looked at, and abandoned without a single client
 * hearing about it. The ladder in get_nps_queue() is what sends step one.
 */
create or replace function public.create_nps_campaign(p_name text, p_period date)
returns table (campaign_id uuid, invitations integer, skipped integer)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_campaign uuid;
  v_made integer;
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
      coalesce(nullif(btrim(c.client_main_contact_email__c), ''),
               nullif(btrim(c.client_decision_maker_contact_email__c), '')) as email,
      coalesce(oc.team_lead_id, am.manager_member_id) as lead_id
    from public.org_clients oc
    join public.sf_clients_raw c on c.id = oc.salesforce_client_id
    left join public.org_members am on am.id = oc.account_manager_id
    where c.client_status__c = 'Active'
  ),
  made as (
    insert into public.nps_sends (campaign_id, client_id, recipient_email)
    select v_campaign, e.client_id, lower(e.email)
    from eligible e
    where e.email is not null and e.lead_id is not null
    on conflict (campaign_id, client_id, recipient_email) do nothing
    returning 1
  )
  select
    (select count(*) from made),
    (select count(*) from eligible where email is null or lead_id is null)
  into v_made, v_skipped;

  return query select v_campaign, v_made, v_skipped;
end;
$$;

revoke all on function public.create_nps_campaign(text, date) from public, anon;
grant execute on function public.create_nps_campaign(text, date) to authenticated, service_role;
