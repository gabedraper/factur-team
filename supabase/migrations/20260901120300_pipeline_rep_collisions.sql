/*
 * When the same Account Manager ends up representing two different Clients
 * chasing the same Contact -- awkward for the Contact, who'd see one person
 * apparently selling for two companies. Not always wrong, so this is a flag
 * for a human to weigh in on, not a rule that blocks anything.
 *
 * A rep normally only sees their own clients' opportunities under RLS, which
 * would make a security_invoker view of this an incomplete, misleading
 * picture -- the whole point is seeing across clients a single viewer might
 * not otherwise have access to both sides of. Same reasoning the leaderboard
 * views already use, per the migrations README: stay definer, carry the
 * domain/permission gate inline instead of relying on the caller's RLS.
 */

create or replace view public.opportunity_rep_collisions as
select
  cc.id as contact_id,
  cc.first_name,
  cc.last_name,
  om.id as account_manager_id,
  om.full_name as account_manager,
  array_agg(distinct oc.id) as client_ids,
  array_agg(distinct oc.name order by oc.name) as client_names,
  array_agg(distinct o.id) as opportunity_ids
from public.opportunities o
join public.org_clients oc on oc.id = o.client_id
join public.org_members om on om.id = oc.account_manager_id
join public.crm_contacts cc on cc.id = o.contact_id
where oc.account_manager_id is not null
  and public.is_factur_user()
  and public.has_permission('org.manage')
group by cc.id, cc.first_name, cc.last_name, om.id, om.full_name
having count(distinct oc.id) > 1;

revoke all on public.opportunity_rep_collisions from public, anon;
grant select on public.opportunity_rep_collisions to authenticated;
