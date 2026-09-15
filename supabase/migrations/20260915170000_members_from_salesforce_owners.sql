/*
 * Every Salesforce owner is a member.
 *
 * 111,000 open opportunities were owned by Salesforce users with no row in
 * org_members, so they belonged to nobody here: no owner column, no "my
 * opportunities", no reporting line. Nearly all of those owners have left --
 * Chris Grote alone holds 22,000 -- but their pipeline has not, and one of
 * them, Kim Johnston, is an active BDM who simply was never added.
 *
 * So the transform now makes a member for any Salesforce user who owns an
 * opportunity and has no member yet. Inactive in Salesforce means inactive
 * here: the row exists so the work is attributed, not so the person can sign
 * in (auth_user_id stays null until they do). Each one is flagged
 * needs_review, the same flag the first seed used, so an admin sees them on
 * the members page and can fix a role or a reporting line.
 *
 * Same address, different account: linked, not duplicated. Salesforce reuses
 * real people's addresses on guest and integration accounts, so those are
 * excluded with the same list suggest_salesforce_matches() uses.
 *
 * A role is guessed from the Salesforce role, title and profile, in that
 * order, and only for members this function creates -- the people the first
 * seed left for an admin to decide keep that decision. The role is what sets
 * which ladder the person reads (org_roles.stage_field).
 */

-- Chad Kinner's id was seeded with a stray character (19 characters; a
-- Salesforce id is 18), so 302 of his opportunities could not find him.
update public.org_members
   set salesforce_user_id = '005Hq00000LjmEQIAZ'
 where salesforce_user_id = '0051Hq00000LjmEQIAZ';

create or replace function public.sync_org_members_from_salesforce_owners()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_started timestamptz := clock_timestamp();
  linked integer := 0;
  created integer := 0;
  roled integer := 0;
begin
  /* Salesforce users who own an opportunity and have no member. One row per
     address: an address shared by two accounts takes the active one. */
  create temp table _owners on commit drop as
  select distinct on (lower(u.email))
         u.id, u.name, lower(u.email) as email, coalesce(u.isactive, false) as isactive,
         u.userrole_name, u.profile_name, u.title
  from public.sf_users_raw u
  where u.email is not null
    and exists (select 1 from public."sky_Opportunity" s where s."OwnerId" = u.id)
    and not exists (select 1 from public.org_members m where m.salesforce_user_id = u.id)
    -- Not people. Same list as suggest_salesforce_matches().
    and u.email not like '%@00d%'
    and u.email not like 'noreply@%'
    and u.name not ilike '%site guest user%'
    and u.name not ilike '%integration%'
    and u.name not ilike 'automated%'
    and u.name not ilike 'security user'
    and u.name not ilike 'system'
    and u.name not ilike 'data.com%'
  order by lower(u.email), u.isactive desc, u.createddate desc;

  -- Already here under the same address, just never linked.
  update public.org_members m
     set salesforce_user_id = o.id
    from _owners o
   where m.email = o.email
     and m.salesforce_user_id is null;
  get diagnostics linked = row_count;

  insert into public.org_members (email, full_name, salesforce_user_id, active, needs_review, deactivated_at)
  select o.email, o.name, o.id, o.isactive, true,
         case when o.isactive then null else v_started end
  from _owners o
  where not exists (select 1 from public.org_members m where m.email = o.email);
  get diagnostics created = row_count;

  /* A role for the ones just made. Salesforce's role name is the most
     deliberate of the three fields, so it goes first; the profile is a
     permission set and only breaks ties. Nothing matches, nothing assigned:
     my_stage_fields() then shows both ladders, and needs_review says why. */
  insert into public.org_assignments (member_id, role_id, is_primary)
  select m.id, r.id, true
  from public.org_members m
  join _owners o on o.id = m.salesforce_user_id
  cross join lateral (
    select case
      when o.userrole_name ilike 'BDM' or o.userrole_name in ('Sales', 'Sales Manager') then 'bdm'
      when o.userrole_name ilike 'OSDR' then 'osdr'
      when o.userrole_name ilike 'OBDM' or o.userrole_name ilike 'Outsourced Prospecting' then 'obdm'
      when o.userrole_name ilike 'Lead Generation' then 'leadgen'
      when o.userrole_name ilike 'RevOps%' then 'revops'
      when o.title ilike '%business development manager%' then 'bdm'
      when o.title ilike 'OSDR' then 'osdr'
      when o.title ilike 'CSDR%' then 'sdr'
      when o.profile_name ilike 'CSDR%' then 'sdr'
      when o.profile_name ilike 'Lead Generation' then 'leadgen'
      when o.profile_name ilike 'Outsourced Prospecting%' or o.profile_name ilike 'OBDM/OSDR%' then 'obdm'
      when o.profile_name ilike 'Factur Salesperson%' then 'bdm'
    end as slug
  ) k
  join public.org_roles r on r.slug = k.slug and r.active
  where m.created_at >= v_started
    and not exists (select 1 from public.org_assignments a where a.member_id = m.id);
  get diagnostics roled = row_count;

  drop table _owners;
  return jsonb_build_object('linked', linked, 'created', created, 'roles', roled);
end;
$$;

comment on function public.sync_org_members_from_salesforce_owners() is
  'Makes a member (inactive if they have left) for every Salesforce user who owns an opportunity and has none, links same-address members, and guesses a role for the new ones. Runs with the Salesforce transforms.';

revoke all on function public.sync_org_members_from_salesforce_owners() from public, anon;
grant execute on function public.sync_org_members_from_salesforce_owners() to service_role;

/*
 * Members before opportunities, so a new owner exists by the time their rows
 * are written; then owners for rows already here whose owner has only just
 * become a member. backfill_opportunity_owners() is cheap once caught up: it
 * looks only at rows with no owner, and after this run those are the ones
 * owned by integration accounts.
 */
create or replace function public.apply_salesforce_transforms(p_since timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r jsonb;
begin
  r := jsonb_build_object(
    'clients',       public.sync_org_clients_from_salesforce(p_since),
    'members',       (public.sync_org_members_from_salesforce_owners())->'created',
    'campaigns',     public.sync_crm_campaigns_from_salesforce(p_since),
    'accounts',      public.sync_crm_accounts_from_salesforce(p_since),
    'contacts',      public.sync_crm_contacts_from_salesforce(p_since),
    'opportunities', public.sync_opportunities_from_salesforce(p_since),
    'owners',        public.backfill_opportunity_owners(20000),
    'campaign_links', public.attach_opportunity_campaigns(p_since),
    'activities',    public.sync_opp_activities_from_salesforce(p_since)
  );
  return r;
end;
$function$;

revoke all on function public.apply_salesforce_transforms(timestamptz) from public, anon;
grant execute on function public.apply_salesforce_transforms(timestamptz) to service_role;
