/*
 * First names for the people we email.
 *
 * sf_clients_raw carries contact *addresses* and no names, so without this a
 * survey from a named person opens "Hi there" -- which reads as a mailshot, the
 * one thing a personal ask must not look like.
 *
 * An app-owned table rather than a Coupler feed of Salesforce Contact: that
 * object holds four million prospecting records, and the couple of hundred
 * people we actually write to are a much smaller question. Keyed on the address
 * because that is what the client record holds and what we send to -- a name we
 * cannot tie to the address being written to is no use.
 */
create table if not exists public.client_contact_names (
  email text primary key,
  first_name text,
  last_name text,
  -- So a hand correction can be told from a sync and left alone by the next
  -- one. Salesforce is often wrong about who owns an address; a person who has
  -- fixed it should not have to fix it again next quarter.
  source text not null default 'salesforce' check (source in ('salesforce', 'manual')),
  updated_at timestamptz not null default now()
);

alter table public.client_contact_names enable row level security;

drop policy if exists client_contact_names_read on public.client_contact_names;
create policy client_contact_names_read on public.client_contact_names
  for select to authenticated
  using (public.is_factur_user());

-- Return type changes, so it is dropped rather than replaced.
drop function if exists public.create_nps_campaign(text, date);

/*
 * Rebuilt to stamp the contact's first name onto each invitation.
 *
 * Copied onto the send rather than joined at delivery, for the same reason the
 * address is: the wording that went out should stay legible a year later even
 * if the contact record changes underneath it.
 *
 * `named` comes back alongside the count so a shortfall is visible before the
 * first email goes out rather than after.
 */
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
      lower(coalesce(nullif(btrim(c.client_main_contact_email__c), ''),
                     nullif(btrim(c.client_decision_maker_contact_email__c), ''))) as email,
      coalesce(oc.team_lead_id, am.manager_member_id) as lead_id
    from public.org_clients oc
    join public.sf_clients_raw c on c.id = oc.salesforce_client_id
    left join public.org_members am on am.id = oc.account_manager_id
    where c.client_status__c = 'Active'
  ),
  made as (
    insert into public.nps_sends (campaign_id, client_id, recipient_email, recipient_name)
    select v_campaign, e.client_id, e.email, nullif(btrim(n.first_name), '')
    from eligible e
    left join public.client_contact_names n on n.email = e.email
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
