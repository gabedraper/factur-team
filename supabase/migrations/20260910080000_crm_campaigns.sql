/*
 * Which show produced which pipeline.
 *
 * Campaigns in this org are trade shows and events -- 2026 IMTS, Foam Expo, the
 * NTMA golf outing -- and an opportunity carrying a CampaignId is one that
 * traces back to a stand or a dinner. That is a question worth being able to
 * ask and the app could not ask it: 359 campaigns exist, 165 have pursuits
 * against them, and 12,742 opportunities point at one.
 *
 * Read-only from Salesforce, like crm_accounts and crm_contacts. Campaigns are
 * set up by whoever books the show, and an edit made here could not push back.
 *
 * Everyone signed in can read them. A campaign is a trade show, not a client's
 * private business -- there is nothing in the row that belongs to one client
 * and not another, and knowing IMTS runs in September is not a disclosure. The
 * link from an opportunity is still behind that opportunity's own RLS, so which
 * pursuits came out of a show stays scoped to whoever may see those pursuits.
 */

create table if not exists public.crm_campaigns (
  id                     uuid primary key default gen_random_uuid(),
  salesforce_campaign_id text not null unique,
  name                   text not null,
  type                   text,
  status                 text,
  start_date             date,
  end_date               date,
  is_active              boolean,
  location               text,
  targeted_industries    text,
  targeted_personas      text,
  description            text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

alter table public.crm_campaigns enable row level security;

drop policy if exists crm_campaigns_read on public.crm_campaigns;
create policy crm_campaigns_read on public.crm_campaigns
  for select to authenticated using (public.is_factur_user());

revoke all on table public.crm_campaigns from public, anon;
grant select on table public.crm_campaigns to authenticated;


/*
 * The link. Nullable and on delete set null: most pursuits come from
 * prospecting rather than a show, and losing a campaign should not take its
 * pipeline with it.
 */
alter table public.opportunities
  add column if not exists campaign_id uuid references public.crm_campaigns(id) on delete set null;

create index if not exists opportunities_campaign_idx
  on public.opportunities (campaign_id) where campaign_id is not null;


create or replace function public.sync_crm_campaigns_from_salesforce(p_since timestamptz default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  written integer;
begin
  with upserted as (
    insert into public.crm_campaigns (
      salesforce_campaign_id, name, type, status, start_date, end_date,
      is_active, location, targeted_industries, targeted_personas, description
    )
    select distinct on (s."Id")
           s."Id",
           coalesce(nullif(trim(s."Name"), ''), '(no name)'),
           nullif(trim(s."Type"), ''),
           nullif(trim(s."Status"), ''),
           nullif(trim(s."StartDate"), '')::date,
           nullif(trim(s."EndDate"), '')::date,
           nullif(trim(s."IsActive"), '')::boolean,
           nullif(trim(s."Location__c"), ''),
           nullif(trim(s."Targeted_Industries__c"), ''),
           nullif(trim(s."Targeted_Personas__c"), ''),
           nullif(trim(s."Description"), '')
    from public."sky_Campaign" s
    where coalesce(nullif(s."IsDeleted", '')::boolean, false) = false
      and nullif(trim(s."Id"), '') is not null
      and (p_since is null or nullif(s."LastModifiedDate", '')::timestamptz > p_since)
    order by s."Id", nullif(s."LastModifiedDate", '')::timestamptz desc nulls last
    on conflict (salesforce_campaign_id) do update set
      name                = excluded.name,
      type                = coalesce(excluded.type,   crm_campaigns.type),
      status              = coalesce(excluded.status, crm_campaigns.status),
      start_date          = coalesce(excluded.start_date, crm_campaigns.start_date),
      end_date            = coalesce(excluded.end_date,   crm_campaigns.end_date),
      is_active           = coalesce(excluded.is_active,  crm_campaigns.is_active),
      location            = coalesce(excluded.location,   crm_campaigns.location),
      targeted_industries = coalesce(excluded.targeted_industries, crm_campaigns.targeted_industries),
      targeted_personas   = coalesce(excluded.targeted_personas,   crm_campaigns.targeted_personas),
      description         = coalesce(excluded.description, crm_campaigns.description),
      updated_at          = now()
    returning 1
  )
  select count(*) into written from upserted;

  return written;
end;
$function$;

comment on function public.sync_crm_campaigns_from_salesforce(timestamptz) is
  'Campaign mirror to crm_campaigns. Must run before the opportunity transform, which resolves CampaignId against it.';


/*
 * Attach the pursuits.
 *
 * Kept apart from the opportunity transform rather than folded into it. That
 * one matches on (client, contact) and dedups by stage, and a campaign link is
 * a different question with a different key -- putting it there would mean
 * touching that logic every time a lookup gets added. This is a plain join from
 * the mirror, and it can be re-run over everything cheaply.
 */
create or replace function public.attach_opportunity_campaigns(p_since timestamptz default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  written integer;
begin
  with linked as (
    update public.opportunities o
    set campaign_id = c.id
    from public."sky_Opportunity" s
    join public.crm_campaigns c on c.salesforce_campaign_id = nullif(trim(s."CampaignId"), '')
    where s."Id" = o.salesforce_opportunity_id
      and o.campaign_id is distinct from c.id
      and (p_since is null or nullif(s."LastModifiedDate", '')::timestamptz > p_since)
    returning 1
  )
  select count(*) into written from linked;

  return written;
end;
$function$;

comment on function public.attach_opportunity_campaigns(timestamptz) is
  'Resolves sky_Opportunity.CampaignId to crm_campaigns and writes opportunities.campaign_id.';
