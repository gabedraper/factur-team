-- Numbers that only the opportunity knows.
--
-- Salesforce keeps phone numbers on the opportunity as well as the contact:
-- the enrichment tools write ZoomInfo mobiles and direct lines there, and
-- older records carry the number in Phone__c. Josh Muir's contact has no
-- number at all, while his opportunity has a mobile. On 3,776 open
-- opportunities the deal knows a number and the contact does not.
--
-- Filled in as a fallback only: a number the contact already has wins, and
-- the opportunity's is used where the contact's slot is empty.
--
-- Worked from the contact side, one contact's newest opportunity at a time
-- through the index on Client_Contact__c. The first version ranked all 922k
-- opportunities in one pass and never finished inside the statement timeout.
-- The one-off pass marks each contact it has looked at so it can run in
-- slices and stop; the incremental pass only looks at contacts whose
-- opportunities changed since the last run.

alter table public.crm_contacts
  add column if not exists opp_phones_checked_at timestamptz;

create or replace function public.backfill_contact_phones_from_opps(
  p_batch integer default 20000,
  p_since timestamptz default null
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n integer;
begin
  if p_since is null then
    -- The one-off pass: every contact not yet looked at, marked whether or
    -- not anything was found, so the next slice starts where this one ended.
    with todo as (
      select c.id, b.mobile, b.direct, b.phone
      from public.crm_contacts c
      left join lateral (
        select
          coalesce(nullif(trim(s."Zoominfo_Mobile__c"), ''), nullif(trim(s."Contact_Mobile_Phone__c"), '')) as mobile,
          nullif(trim(s."Zoominfo_Direct_Phone__c"), '') as direct,
          nullif(trim(s."Phone__c"), '') as phone
        from public."sky_Opportunity" s
        where s."Client_Contact__c" = c.salesforce_contact_id
          and coalesce(nullif(s."IsDeleted", '')::boolean, false) = false
          and (
            nullif(trim(s."Zoominfo_Mobile__c"), '') is not null
            or nullif(trim(s."Contact_Mobile_Phone__c"), '') is not null
            or nullif(trim(s."Zoominfo_Direct_Phone__c"), '') is not null
            or nullif(trim(s."Phone__c"), '') is not null
          )
        order by public.sf_ts(s."LastModifiedDate") desc nulls last
        limit 1
      ) b on true
      where c.opp_phones_checked_at is null
      limit p_batch
    )
    update public.crm_contacts c
       set mobile_phone = coalesce(c.mobile_phone, todo.mobile),
           direct_phone = coalesce(c.direct_phone, todo.direct),
           phone        = coalesce(c.phone, todo.phone),
           opp_phones_checked_at = now()
      from todo
     where c.id = todo.id;
  else
    -- Kept up: contacts whose opportunities changed since the last pass.
    with recent as (
      select distinct s."Client_Contact__c" as contact_sf
      from public."sky_Opportunity" s
      where public.sf_ts(s."LastModifiedDate") > p_since
        and s."Client_Contact__c" is not null and s."Client_Contact__c" <> ''
    ),
    todo as (
      select c.id, b.mobile, b.direct, b.phone
      from recent r
      join public.crm_contacts c on c.salesforce_contact_id = r.contact_sf
      cross join lateral (
        select
          coalesce(nullif(trim(s."Zoominfo_Mobile__c"), ''), nullif(trim(s."Contact_Mobile_Phone__c"), '')) as mobile,
          nullif(trim(s."Zoominfo_Direct_Phone__c"), '') as direct,
          nullif(trim(s."Phone__c"), '') as phone
        from public."sky_Opportunity" s
        where s."Client_Contact__c" = c.salesforce_contact_id
          and coalesce(nullif(s."IsDeleted", '')::boolean, false) = false
          and (
            nullif(trim(s."Zoominfo_Mobile__c"), '') is not null
            or nullif(trim(s."Contact_Mobile_Phone__c"), '') is not null
            or nullif(trim(s."Zoominfo_Direct_Phone__c"), '') is not null
            or nullif(trim(s."Phone__c"), '') is not null
          )
        order by public.sf_ts(s."LastModifiedDate") desc nulls last
        limit 1
      ) b
      where (c.mobile_phone is null and b.mobile is not null)
         or (c.direct_phone is null and b.direct is not null)
         or (c.phone is null and b.phone is not null)
      limit p_batch
    )
    update public.crm_contacts c
       set mobile_phone = coalesce(c.mobile_phone, todo.mobile),
           direct_phone = coalesce(c.direct_phone, todo.direct),
           phone        = coalesce(c.phone, todo.phone),
           opp_phones_checked_at = now()
      from todo
     where c.id = todo.id;
  end if;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.backfill_contact_phones_from_opps(integer, timestamptz) from public;
grant execute on function public.backfill_contact_phones_from_opps(integer, timestamptz) to service_role;

create or replace function public.apply_salesforce_transforms_incremental()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_since timestamptz;
  v_started timestamptz := now();
  v_ids text[];
  r jsonb;
  b jsonb := '{}'::jsonb;
begin
  select watermark into v_since
    from public.salesforce_sync_state where object = '__transforms';

  v_since := coalesce(v_since, v_started - interval '1 hour') - interval '5 minutes';

  r := public.apply_salesforce_transforms(v_since);

  select array_agg(id) into v_ids
  from (
    select id from public.salesforce_contact_backfill
    where applied_at is null
    order by fetched_at
    limit 2000
  ) q;
  if v_ids is not null then
    b := public.salesforce_apply_contact_backfill(v_ids);
    update public.salesforce_contact_backfill
       set applied_at = now()
     where id = any(v_ids);
    r := r || jsonb_build_object('backfilled_contacts', b->'contacts', 'backfilled_opportunities', b->'opportunities');
  end if;

  r := r || jsonb_build_object('phones_from_opps', public.backfill_contact_phones_from_opps(5000, v_since));

  insert into public.salesforce_sync_state (object, watermark, last_run_at, last_run_rows, last_error)
  values ('__transforms', v_started, v_started,
          (select sum(value::int) from jsonb_each_text(r)), null)
  on conflict (object) do update set
    watermark     = excluded.watermark,
    last_run_at   = excluded.last_run_at,
    last_run_rows = excluded.last_run_rows,
    last_error    = null;

  return r;
end;
$$;
