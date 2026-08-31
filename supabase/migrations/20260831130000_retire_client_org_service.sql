/*
 * Take the org service off the client record.
 *
 * Two unrelated things were called "Service" on the same screen: the part of
 * Factur that delivers the work (org_services -- Outsourced Prospecting,
 * Marketing & RevOps) and the product the client buys (Salesforce Service__c --
 * LG, OP, OSDR). The second is what drives results; the first was written by a
 * dropdown and read by nothing. Every consumer was traced: it was displayed and
 * sorted in the clients screen and used nowhere else -- no view, no function,
 * no report, no permission check.
 *
 * org_services itself stays. It is the spine of roles and pods: assigning a
 * role looks up that role's service to find the matching pod, and 8 of 8 pods
 * and 13 of 23 roles hang off it. Only the client's copy goes.
 *
 * Nothing is lost. client_history already holds an open row per client with the
 * service name in it, so the 842 values survive as history -- renamed here to
 * 'org_service' so that "service" on a client means one thing again.
 */
-- Dropped first: the rows still say 'service', so a constraint naming only the
-- new value would reject them before the rename could run.
alter table public.client_history drop constraint if exists client_history_field_check;

update public.client_history set field = 'org_service' where field = 'service';

-- Re-added without 'service', so nothing writes that name to a client again.
alter table public.client_history add constraint client_history_field_check
  check (field = any (array[
    'account_manager', 'team_lead', 'data_team_lead', 'sdr',
    'marketing_strategist', 'data_analyst', 'data_engineer', 'owner',
    'org_service', 'status'
  ]));

/*
 * Rebuilt without the service row, so record_client_history stops opening new
 * ones. The rest of the view is untouched.
 */
create or replace view public.client_role_now
with (security_invoker = true) as
select oc.id as client_id, f.field, f.member_id, f.value_text
from public.org_clients oc
cross join lateral (values
  ('account_manager',      oc.account_manager_id,      null::text),
  ('team_lead',            oc.team_lead_id,            null),
  ('data_team_lead',       oc.data_team_lead_id,       null),
  ('sdr',                  oc.sdr_id,                  null),
  ('marketing_strategist', oc.marketing_strategist_id, null),
  ('data_analyst',         oc.data_analyst_id,         null),
  ('data_engineer',        oc.data_engineer_id,        null),
  ('owner',                oc.member_id,               null),
  ('status',               null,                       oc.status)
) as f(field, member_id, value_text);

alter table public.org_clients drop column if exists service_id;
