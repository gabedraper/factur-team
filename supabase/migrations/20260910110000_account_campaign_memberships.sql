/*
 * Every campaign membership at one company, in one call.
 *
 * The panel wants two things at once: which campaigns the company has been on,
 * and which of them each person was on. contact_campaigns() answers the second
 * one contact at a time, which is a query per row and thirty-six rows on a
 * decent-sized account. This returns the lot and lets the screen group it.
 */

create or replace function public.account_campaign_memberships(p_account_id uuid)
returns table (
  contact_id           uuid,
  campaign_id          uuid,
  name                 text,
  type                 text,
  start_date           date,
  status               text,
  has_responded        boolean
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select m.contact_id, c.id, c.name, c.type, c.start_date, m.status, m.has_responded
  from public.crm_campaign_members m
  join public.crm_contacts k  on k.id = m.contact_id
  join public.crm_campaigns c on c.id = m.campaign_id
  where k.account_id = p_account_id
  order by c.start_date desc nulls last, c.name;
$function$;

revoke all on function public.account_campaign_memberships(uuid) from public, anon;
grant execute on function public.account_campaign_memberships(uuid) to authenticated, service_role;
