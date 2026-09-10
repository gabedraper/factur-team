/*
 * Who was on a campaign, and therefore which companies were.
 *
 * The opportunity link answered "which pursuits came out of this show". It
 * cannot answer "was this person at the show" or "have we ever had anyone from
 * this company on a list", because a campaign only becomes an opportunity once
 * somebody works it -- 17,187 people are on campaigns and 12,120 pursuits carry
 * one, so a good part of the membership never turned into a pursuit at all.
 * That gap is the interesting part: it is the follow-up nobody did.
 *
 * CampaignMember is the join Salesforce keeps. Every row in this org points at
 * a Contact rather than a Lead, which fits -- the Lead object here is the
 * recruiting pipeline, not prospecting.
 *
 * The company side is derived rather than stored. Salesforce has no
 * Campaign-to-Account object, and a company is on a campaign exactly when one
 * of its people is, so storing it would be a second copy of the same fact
 * waiting to disagree with the first.
 */

create table if not exists public."sky_CampaignMember" (
  "Id" text primary key,
  "IsDeleted" text, "CampaignId" text, "LeadId" text, "ContactId" text,
  "Status" text, "HasResponded" text, "CreatedDate" text, "CreatedById" text,
  "LastModifiedDate" text, "LastModifiedById" text, "SystemModstamp" text,
  "FirstRespondedDate" text, "Salutation" text, "Name" text, "FirstName" text,
  "LastName" text, "Title" text, "Street" text, "City" text, "State" text,
  "PostalCode" text, "Country" text, "Email" text, "Phone" text, "Fax" text,
  "MobilePhone" text, "Description" text, "DoNotCall" text,
  "HasOptedOutOfEmail" text, "HasOptedOutOfFax" text, "LeadSource" text,
  "CompanyOrAccount" text, "Type" text, "LeadOrContactId" text,
  "LeadOrContactOwnerId" text
);

alter table public."sky_CampaignMember" enable row level security;
revoke all on table public."sky_CampaignMember" from public, anon;


create table if not exists public.crm_campaign_members (
  id                   uuid primary key default gen_random_uuid(),
  salesforce_member_id text not null unique,
  campaign_id          uuid not null references public.crm_campaigns(id) on delete cascade,
  contact_id           uuid not null references public.crm_contacts(id) on delete cascade,
  status               text,
  has_responded        boolean not null default false,
  first_responded_date date,
  joined_at            timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (campaign_id, contact_id)
);

create index if not exists crm_campaign_members_contact_idx
  on public.crm_campaign_members (contact_id);
create index if not exists crm_campaign_members_campaign_idx
  on public.crm_campaign_members (campaign_id);

alter table public.crm_campaign_members enable row level security;

drop policy if exists crm_campaign_members_read on public.crm_campaign_members;
create policy crm_campaign_members_read on public.crm_campaign_members
  for select to authenticated using (public.is_factur_user());

revoke all on table public.crm_campaign_members from public, anon;
grant select on table public.crm_campaign_members to authenticated;


create or replace function public.sync_crm_campaign_members_from_salesforce(p_since timestamptz default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  written integer;
begin
  with upserted as (
    insert into public.crm_campaign_members (
      salesforce_member_id, campaign_id, contact_id, status,
      has_responded, first_responded_date, joined_at
    )
    select distinct on (s."Id")
           s."Id",
           c.id,
           k.id,
           nullif(trim(s."Status"), ''),
           coalesce(nullif(s."HasResponded", '')::boolean, false),
           nullif(trim(s."FirstRespondedDate"), '')::date,
           nullif(s."CreatedDate", '')::timestamptz
    from public."sky_CampaignMember" s
    join public.crm_campaigns c on c.salesforce_campaign_id = nullif(trim(s."CampaignId"), '')
    join public.crm_contacts  k on k.salesforce_contact_id  = nullif(trim(s."ContactId"), '')
    where coalesce(nullif(s."IsDeleted", '')::boolean, false) = false
      and nullif(trim(s."Id"), '') is not null
      and (p_since is null or nullif(s."LastModifiedDate", '')::timestamptz > p_since)
    order by s."Id", nullif(s."LastModifiedDate", '')::timestamptz desc nulls last
    on conflict (salesforce_member_id) do update set
      status               = excluded.status,
      has_responded        = excluded.has_responded,
      first_responded_date = coalesce(excluded.first_responded_date, crm_campaign_members.first_responded_date),
      updated_at           = now()
    returning 1
  )
  select count(*) into written from upserted;

  return written;
end;
$function$;

comment on function public.sync_crm_campaign_members_from_salesforce(timestamptz) is
  'CampaignMember mirror to crm_campaign_members. Needs campaigns and contacts to be transformed first; rows pointing at either one we do not hold are skipped rather than invented.';


/*
 * A contact's campaigns, newest first.
 *
 * Reading crm_campaign_members directly would do, but the panel wants the
 * campaign's own name and dates alongside the membership, and every caller
 * writing that join by hand is how two screens end up disagreeing about what a
 * campaign is called.
 */
create or replace function public.contact_campaigns(p_contact_id uuid)
returns table (
  campaign_id          uuid,
  name                 text,
  type                 text,
  start_date           date,
  status               text,
  has_responded        boolean,
  first_responded_date date
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select c.id, c.name, c.type, c.start_date,
         m.status, m.has_responded, m.first_responded_date
  from public.crm_campaign_members m
  join public.crm_campaigns c on c.id = m.campaign_id
  where m.contact_id = p_contact_id
  order by c.start_date desc nulls last, c.name;
$function$;


/*
 * A company's campaigns: every campaign any of its people are on, with how many
 * of them and how many replied. Membership is the source; the opportunity link
 * is a separate question already answered by opportunities.campaign_id.
 */
create or replace function public.account_campaigns(p_account_id uuid)
returns table (
  campaign_id  uuid,
  name         text,
  type         text,
  start_date   date,
  members      bigint,
  responded    bigint
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select c.id, c.name, c.type, c.start_date,
         count(*),
         count(*) filter (where m.has_responded)
  from public.crm_campaign_members m
  join public.crm_contacts k on k.id = m.contact_id
  join public.crm_campaigns c on c.id = m.campaign_id
  where k.account_id = p_account_id
  group by c.id, c.name, c.type, c.start_date
  order by c.start_date desc nulls last, c.name;
$function$;

revoke all on function public.contact_campaigns(uuid) from public, anon;
revoke all on function public.account_campaigns(uuid) from public, anon;
grant execute on function public.contact_campaigns(uuid) to authenticated, service_role;
grant execute on function public.account_campaigns(uuid) to authenticated, service_role;


/*
 * Members transform after campaigns and contacts, since it needs both.
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
    'clients',          public.sync_org_clients_from_salesforce(p_since),
    'campaigns',        public.sync_crm_campaigns_from_salesforce(p_since),
    'accounts',         public.sync_crm_accounts_from_salesforce(p_since),
    'contacts',         public.sync_crm_contacts_from_salesforce(p_since),
    'campaign_members', public.sync_crm_campaign_members_from_salesforce(p_since),
    'opportunities',    public.sync_opportunities_from_salesforce(p_since),
    'campaign_links',   public.attach_opportunity_campaigns(p_since),
    'activities',       public.sync_opp_activities_from_salesforce(p_since)
  );
  return r;
end;
$function$;

revoke all on function public.apply_salesforce_transforms(timestamptz) from public, anon;
grant execute on function public.apply_salesforce_transforms(timestamptz) to service_role;

insert into public.salesforce_sync_state (object, watermark)
values ('CampaignMember', timestamptz '2000-01-01')
on conflict (object) do nothing;
