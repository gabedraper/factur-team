/*
 * Where the app and Salesforce disagree about who covers a client.
 *
 * The app owns these assignments -- decided when the org structure was built.
 * But the Salesforce fields still exist and are still edited, and nothing showed
 * the two drifting, so clients quietly ended up with a different owner in each.
 * This changes nothing; it only makes the disagreement visible.
 *
 * Two traps, both found by checking the output before trusting it:
 *
 *   Salesforce's "Sales Representative" is the BDM who *sold* the account, not
 *   the SDR serving it. Pairing them reported 177 disagreements that were not
 *   disagreements at all, so that role is not compared.
 *
 *   The remaining fields are free text, and a person is written differently in
 *   each system -- "Zorina Reyes" against "Zorina Olson", "Jess Graves" against
 *   "Jessica Graves". Comparing the words called 41 matches a mismatch. Names
 *   are resolved to a person first, and only then compared.
 */
create or replace function public.get_client_role_drift()
returns table (
  client_id uuid, client_name text, role_label text,
  in_app text, in_salesforce text, kind text
)
language sql stable security definer set search_path to 'public'
as $$
  with sf_person as (
    -- A Salesforce name resolved to somebody the app knows, so a difference in
    -- spelling is not mistaken for a difference in person.
    select m.id, lower(btrim(m.full_name)) as key from org_members m
    where m.full_name is not null
    union
    select m.id, lower(btrim(u.name)) from org_members m
    join sf_users_raw u on u.id = m.salesforce_user_id
    where u.name is not null
  ),
  pairs as (
    select c.id, c.name, v.label, v.app_member, v.sf_text,
           (select p.id from sf_person p
             where p.key = lower(btrim(v.sf_text)) limit 1) as sf_member
    from org_clients c
    join sf_clients_raw sf on sf.id = c.salesforce_client_id
    cross join lateral (values
      ('Account Manager',      c.account_manager_id,      sf.account_manager__r_name),
      ('Marketing Strategist', c.marketing_strategist_id, sf.marketing_analyst__c),
      ('Data Analyst',         c.data_analyst_id,         sf.data_analyst__c),
      ('Data Engineer',        c.data_engineer_id,        sf.data_engineer__c)
    ) as v(label, app_member, sf_text)
    where public.is_factur_user()
      and c.active and coalesce(c.status, '') <> 'Inactive'
      and nullif(btrim(v.sf_text), '') is not null
  )
  select p.id, p.name, p.label,
         (select m.full_name from org_members m where m.id = p.app_member),
         p.sf_text,
         case
           when p.app_member is null then 'missing from the app'
           when p.sf_member is null then 'Salesforce names someone the app does not know'
           else 'different person'
         end
  from pairs p
  -- Same person under two spellings is not drift.
  where p.app_member is distinct from p.sf_member;
$$;

revoke all on function public.get_client_role_drift() from public, anon;
grant execute on function public.get_client_role_drift() to authenticated, service_role;
