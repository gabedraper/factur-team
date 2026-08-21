-- Reconciling people whose name is spelled one way in Salesforce and another in
-- the app, which was leaving client roles unfilled.
--
-- Two of the three had *deactivated* Salesforce accounts, which is why the
-- earlier exact-match pass missed them: it only considered active users. That
-- was wrong. A leaver's account still owns their history, and in these cases
-- the person is very much still here -- only their Salesforce login is gone.

-- Match on email regardless of whether the Salesforce account is still active.
-- This alone recovered Jess Graves, whose Salesforce record reads "Jessica
-- Graves" at the same address.
update public.org_members m
set salesforce_user_id = s.id
from public.sf_users_raw s
where lower(s.email) = m.email and m.salesforce_user_id is null;

update public.org_clients c set marketing_strategist_id = m.id
from public.sf_clients_raw s, public.org_members m
where c.salesforce_client_id = s.id and c.marketing_strategist_id is null
  and s.marketing_analyst__c = 'Jessica Graves'
  and m.email = 'jessica.graves@facturmfg.com';

update public.org_clients c set marketing_strategist_id = m.id
from public.sf_clients_raw s, public.org_members m
where c.salesforce_client_id = s.id and c.marketing_strategist_id is null
  and s.marketing_analyst__c = 'Gedalia Tobias'
  and m.email = 'gedaliah.tobias@facturmfg.com';

-- "Zorina Olson" is a deactivated Salesforce account and Zorina Reyes is in the
-- app. Same uncommon first name, and no other Zorina exists in either system,
-- so this is treated as one person after a name change. It is an inference, not
-- a fact from the data -- reversible by clearing her Salesforce link and the
-- strategist field on those clients.
update public.org_members m
set salesforce_user_id = s.id
from public.sf_users_raw s
where m.email = 'zorina.reyes@facturmfg.com'
  and s.name = 'Zorina Olson' and m.salesforce_user_id is null;

update public.org_clients c set marketing_strategist_id = m.id
from public.sf_clients_raw s, public.org_members m
where c.salesforce_client_id = s.id and c.marketing_strategist_id is null
  and s.marketing_analyst__c = 'Zorina Olson'
  and m.email = 'zorina.reyes@facturmfg.com';

-- Adam Cvijovic is the data engineer on 29 current clients but appears in
-- neither the app nor Salesforce, and was not in the directory list either.
-- Added so those clients can point at a person; the address follows the company
-- pattern and is a guess, hence needs_review.
insert into public.org_members (email, full_name, needs_review)
values ('adam.cvijovic@facturmfg.com', 'Adam Cvijovic', true)
on conflict (email) do nothing;

update public.org_clients c set data_engineer_id = m.id
from public.sf_clients_raw s, public.org_members m
where c.salesforce_client_id = s.id and c.data_engineer_id is null
  and s.data_engineer__c = 'Adam Cvijovic'
  and m.email = 'adam.cvijovic@facturmfg.com';

-- The seven CSDRs named on 38 clients are deliberately NOT added: that team no
-- longer works here. Their names remain on the Salesforce records as history.
