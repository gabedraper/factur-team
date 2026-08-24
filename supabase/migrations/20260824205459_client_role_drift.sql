/*
 * Where the app and Salesforce disagree about who covers a client.
 *
 * The app is the source of truth for this -- that decision was made when the
 * org structure was built, and the assignments were seeded from Salesforce once
 * and owned here after. But the Salesforce fields still exist and people still
 * edit them, and nothing was showing the two drifting apart, so 22 of 212
 * clients quietly ended up with a different owner in each system.
 *
 * This does not change anything. It only makes the disagreement visible, so it
 * gets resolved on purpose rather than discovered by accident.
 */
create or replace function public.get_client_role_drift()
returns table (
  client_id uuid, client_name text, role_label text,
  in_app text, in_salesforce text, kind text
)
language sql stable security definer set search_path to 'public'
as $$
  with pairs as (
    select c.id, c.name,
           v.label,
           v.app_name,
           -- Salesforce holds some of these as a user lookup and others as
           -- free text; both arrive as a name either way.
           nullif(btrim(v.sf_name), '') as sf_name
    from org_clients c
    join sf_clients_raw sf on sf.id = c.salesforce_client_id
    cross join lateral (values
      ('Account Manager',
       (select m.full_name from org_members m where m.id = c.account_manager_id),
       sf.account_manager__r_name),
      ('SDR',
       (select m.full_name from org_members m where m.id = c.sdr_id),
       sf.sales_representative__r_name),
      ('Marketing Strategist',
       (select m.full_name from org_members m where m.id = c.marketing_strategist_id),
       sf.marketing_analyst__c),
      ('Data Analyst',
       (select m.full_name from org_members m where m.id = c.data_analyst_id),
       sf.data_analyst__c),
      ('Data Engineer',
       (select m.full_name from org_members m where m.id = c.data_engineer_id),
       sf.data_engineer__c)
    ) as v(label, app_name, sf_name)
    where public.is_factur_user()
      and c.active and coalesce(c.status, '') <> 'Inactive'
  )
  select id, name, label, app_name, sf_name,
         case
           when app_name is not null and sf_name is not null then 'differs'
           when app_name is null then 'only in Salesforce'
           else 'only in the app'
         end
  from pairs
  -- Both blank is not a disagreement, it is just an unassigned role.
  where (app_name is not null or sf_name is not null)
    and app_name is distinct from sf_name;
$$;

revoke all on function public.get_client_role_drift() from public, anon;
grant execute on function public.get_client_role_drift() to authenticated, service_role;
