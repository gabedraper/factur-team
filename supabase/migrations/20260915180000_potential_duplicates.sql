/*
 * Potential duplicates, named but never removed.
 *
 * Now that every Salesforce opportunity is a row, 31,000 (client, contact)
 * pairs have more than one -- 143,000 rows, the biggest group 109 deep. Gabe's
 * call: nothing is deleted in Salesforce. Instead each group names one record
 * as the main one and the rest point at it, so the main record can list its
 * potential duplicates and a list view can leave the others out.
 *
 * The association is client + contact. The second signal is the owner: when
 * an account manager changes, the client and contact stay and a new record
 * appears under the new owner, so a group whose owners differ is more likely a
 * handover than a mistake. The screen says which; nothing here decides.
 *
 * Which record is the main one, in order:
 *   1. still active on either ladder beats finished;
 *   2. owned by someone still here beats owned by someone who left;
 *   3. most recently changed;
 *   4. oldest created, as the tie-break.
 * Recomputed with the transforms for the groups whose rows changed, and in
 * full by the nightly catch-up. Somebody editing a record can move which one
 * is main; that is intended, since "most recently worked" is the point.
 */

alter table public.opportunities
  add column if not exists duplicate_of uuid references public.opportunities(id) on delete set null,
  add column if not exists is_duplicate boolean not null default false;

comment on column public.opportunities.duplicate_of is
  'The main record of this (client, contact) group when this is not it. Set by refresh_opportunity_duplicates(); nothing is merged or deleted.';

create index if not exists opportunities_duplicate_of_idx
  on public.opportunities (duplicate_of) where duplicate_of is not null;

create or replace function public.refresh_opportunity_duplicates(p_since timestamptz default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  changed integer;
begin
  with touched as (
    select distinct client_id, contact_id
    from public.opportunities
    where p_since is null or updated_at > p_since
  ),
  ranked as (
    select o.id,
           first_value(o.id) over (
             partition by o.client_id, o.contact_id
             order by (o.active_by_stage or o.active_by_lead_status) desc,
                      coalesce(om.active, false) desc,
                      o.updated_at desc,
                      o.created_at asc,
                      o.id
           ) as main_id,
           count(*) over (partition by o.client_id, o.contact_id) as group_size
    from public.opportunities o
    join touched t on t.client_id = o.client_id and t.contact_id = o.contact_id
    left join public.org_members om on om.id = o.owner_member_id
  ),
  want as (
    select id, case when group_size > 1 and id <> main_id then main_id end as dup_of
    from ranked
  )
  update public.opportunities o
     set duplicate_of = w.dup_of,
         is_duplicate = (w.dup_of is not null)
    from want w
   where o.id = w.id
     and o.duplicate_of is distinct from w.dup_of;
  get diagnostics changed = row_count;
  return changed;
end;
$$;

comment on function public.refresh_opportunity_duplicates(timestamptz) is
  'Names the main record of every (client, contact) group with more than one opportunity and points the others at it. p_since limits to groups with a row changed since then; null does the whole table.';

revoke all on function public.refresh_opportunity_duplicates(timestamptz) from public, anon;
grant execute on function public.refresh_opportunity_duplicates(timestamptz) to service_role;

/*
 * The other records in this opportunity's group, for the record page. Runs
 * as the viewer, so a sibling they may not see is not listed -- a link to a
 * record that refuses to open would be worse than no link.
 */
create or replace function public.opportunity_duplicates(p_id uuid)
returns table (
  id uuid,
  name text,
  stage text,
  lead_status text,
  is_main boolean,
  active boolean,
  owner_member_id uuid,
  owner_name text,
  owner_active boolean,
  same_owner boolean,
  activity_count bigint,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security invoker
set search_path to 'public'
as $$
  with me as (
    select client_id, contact_id, owner_member_id from public.opportunities where id = p_id
  )
  select o.id, o.name, o.stage, o.lead_status,
         (o.duplicate_of is null)                              as is_main,
         (o.active_by_stage or o.active_by_lead_status)        as active,
         o.owner_member_id,
         om.full_name                                          as owner_name,
         coalesce(om.active, false)                            as owner_active,
         (o.owner_member_id is not distinct from me.owner_member_id) as same_owner,
         (select count(*) from public.opp_activities a where a.opportunity_id = o.id) as activity_count,
         o.created_at, o.updated_at
  from public.opportunities o
  join me on me.client_id = o.client_id and me.contact_id = o.contact_id
  left join public.org_members om on om.id = o.owner_member_id
  where o.id <> p_id
  order by (o.duplicate_of is null) desc, o.updated_at desc;
$$;

revoke all on function public.opportunity_duplicates(uuid) from public, anon;
grant execute on function public.opportunity_duplicates(uuid) to authenticated, service_role;

/* Runs after owners, since the main record prefers an owner who is still here. */
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
    'duplicates',    public.refresh_opportunity_duplicates(p_since),
    'campaign_links', public.attach_opportunity_campaigns(p_since),
    'activities',    public.sync_opp_activities_from_salesforce(p_since)
  );
  return r;
end;
$function$;

revoke all on function public.apply_salesforce_transforms(timestamptz) from public, anon;
grant execute on function public.apply_salesforce_transforms(timestamptz) to service_role;
