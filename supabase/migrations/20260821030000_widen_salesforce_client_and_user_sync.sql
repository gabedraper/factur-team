-- Records a change made in Coupler, not in the database, so the reason is not
-- lost: the dataflow "Factur Scoreboard — Salesforce to Supabase" had two
-- sources narrowed in ways that were costing the app real data.
--
-- Clients (source 67b62843) was:
--   ... FROM Clients__c
--   WHERE Client_Account__c != null
--     AND Client_Status__c IN ('Active','Hold','Onboarding','Financial Pause')
--
-- Two filters, and both hurt. The status list hid all 773 Inactive clients --
-- which is exactly the population the retention board is about. The
-- Client_Account__c filter silently dropped a further 18 *current* clients that
-- simply had no linked Account; they still carry their own Name, so there was
-- never a reason to exclude them.
--
-- Users (source 202c789a) synced every row but only six fields. UserRole, Title,
-- Department and Profile were missing, which is why seeding roles from
-- Salesforce had to be done with a hand-written mapping in
-- 20260820231029_org_structure_seed_members_from_salesforce.sql.
--
-- Both now select the full set. 189 -> 985 clients; users gain userrole_name,
-- profile_name, title, department, username and timestamps.
--
-- No schema change is needed here -- Coupler drops and recreates these tables on
-- every load, so the new columns arrive on their own. Two consequences worth
-- remembering:
--
--   1. That drop takes RLS with it. ensure_staging_rls() restores it, but only
--      nightly, so the tables sit unprotected between a load and the next
--      maintenance run. Run it by hand after any manual sync.
--   2. Anything reading these tables must tolerate new columns appearing.

-- Reconcile the app's own client list with the widened source. Matched on
-- Salesforce id, so nothing already assigned to a pod or a person is disturbed.
insert into public.org_clients (salesforce_client_id, name, status)
select c.id, coalesce(nullif(c.client_account__r_name, ''), c.name, c.id), c.client_status__c
from public.sf_clients_raw c
on conflict (salesforce_client_id) do update
  set status = excluded.status,
      name = coalesce(nullif(excluded.name, ''), public.org_clients.name);

select public.ensure_staging_rls();
