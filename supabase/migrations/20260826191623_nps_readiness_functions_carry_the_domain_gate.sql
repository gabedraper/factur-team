/*
 * The two questions that have to be answered before the first campaign.
 *
 * Supersedes 20260826191610_nps_campaign_readiness_functions, applied minutes
 * earlier and not checked in: it defined these same two routines without the
 * is_factur_user() gate below, which left them readable through PostgREST by
 * any signed-in account rather than only a Factur one. These definitions are
 * the whole of both functions, so applying this alone is enough.
 *
 * Functions rather than views, deliberately: both read sf_clients_raw, which
 * Coupler drops and recreates on every sync. A view built on it disappears with
 * it; a function just reads whatever is there at call time.
 *
 * SECURITY DEFINER to get past that table's RLS, so each carries the domain
 * gate inline -- the same pattern as the leaderboard views. That gate reads the
 * caller's token, which is why actions/nps-readiness.ts asks with the signed-in
 * person's connection and not the service key: with no token there is no email
 * to check, and both would answer "not a Factur user" and return nothing.
 */

create or replace function public.nps_campaign_readiness()
returns table (
  client_id uuid,
  client_name text,
  has_contact_email boolean,
  has_owner boolean
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
    oc.member_id is not null or oc.team_id is not null
  from public.org_clients oc
  join public.sf_clients_raw c on c.id = oc.salesforce_client_id
  where c.client_status__c = 'Active'
    and public.is_factur_user()
  order by oc.name;
$$;

-- Who would be sending, and how many clients each would be sending to. The
-- app asks Google for a token as each of these before any campaign runs.
create or replace function public.nps_sender_coverage()
returns table (email text, full_name text, clients bigint)
language sql
security definer
set search_path to 'public'
as $$
  select m.email, m.full_name, count(*)
  from public.org_clients oc
  join public.sf_clients_raw c on c.id = oc.salesforce_client_id
  join public.org_members m on m.id = oc.member_id
  where c.client_status__c = 'Active'
    and public.is_factur_user()
  group by m.email, m.full_name
  order by count(*) desc;
$$;

revoke all on function public.nps_campaign_readiness() from public;
revoke all on function public.nps_sender_coverage() from public;
grant execute on function public.nps_campaign_readiness() to authenticated, service_role;
grant execute on function public.nps_sender_coverage() to authenticated, service_role;
