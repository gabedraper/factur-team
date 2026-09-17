/*
 * Quotes and orders, from Salesforce, tied to their opportunities.
 *
 * Two standard objects the sync never carried: Quote (29,954 -- every one
 * points at an Opportunity) and Order (918, all "PO Won"; eight point at
 * nothing). Same shape as every other object: a sky_* mirror of the raw
 * Salesforce rows, filled by /api/salesforce/sync every three minutes, and a
 * transform that turns the mirror into an app table the pages read.
 *
 * Where the money is, because it is not where the standard fields say:
 * Salesforce's TotalPrice and TotalAmount are line-item sums, and nobody here
 * uses line items (QuoteLineItem and OrderItem are empty), so both are 0 on
 * every record. The figure a person typed is Quote_Amount__c on a quote and
 * PO_Amount__c on an order. Those are what the app calls "amount".
 *
 * Visible to whoever can see the opportunity. Every policy below leans on the
 * opportunities policy through the subquery, so quotes and orders never widen
 * or narrow what a person can already see.
 */

create table if not exists public."sky_Quote" (
  "Id" text,
  "OwnerId" text,
  "IsDeleted" text,
  "Name" text,
  "CreatedDate" text,
  "CreatedById" text,
  "LastModifiedDate" text,
  "LastModifiedById" text,
  "SystemModstamp" text,
  "LastViewedDate" text,
  "LastReferencedDate" text,
  "OpportunityId" text,
  "Pricebook2Id" text,
  "ContactId" text,
  "QuoteNumber" text,
  "IsSyncing" text,
  "ShippingHandling" text,
  "Tax" text,
  "Status" text,
  "ExpirationDate" text,
  "Description" text,
  "Subtotal" text,
  "TotalPrice" text,
  "LineItemCount" text,
  "BillingStreet" text,
  "BillingCity" text,
  "BillingState" text,
  "BillingPostalCode" text,
  "BillingCountry" text,
  "BillingLatitude" text,
  "BillingLongitude" text,
  "BillingGeocodeAccuracy" text,
  "ShippingStreet" text,
  "ShippingCity" text,
  "ShippingState" text,
  "ShippingPostalCode" text,
  "ShippingCountry" text,
  "ShippingLatitude" text,
  "ShippingLongitude" text,
  "ShippingGeocodeAccuracy" text,
  "QuoteToStreet" text,
  "QuoteToCity" text,
  "QuoteToState" text,
  "QuoteToPostalCode" text,
  "QuoteToCountry" text,
  "QuoteToLatitude" text,
  "QuoteToLongitude" text,
  "QuoteToGeocodeAccuracy" text,
  "AdditionalStreet" text,
  "AdditionalCity" text,
  "AdditionalState" text,
  "AdditionalPostalCode" text,
  "AdditionalCountry" text,
  "AdditionalLatitude" text,
  "AdditionalLongitude" text,
  "AdditionalGeocodeAccuracy" text,
  "BillingName" text,
  "ShippingName" text,
  "QuoteToName" text,
  "AdditionalName" text,
  "Email" text,
  "Phone" text,
  "Fax" text,
  "ContractId" text,
  "AccountId" text,
  "Discount" text,
  "GrandTotal" text,
  "CanCreateQuoteLineItems" text,
  "Quote_Amount__c" text,
  "delete__c" text,
  "Internal_Status__c" text,
  "Commission_Payout__c" text,
  "Client__c" text,
  "Completion_Date__c" text,
  "Salesforce_Exporter_Updated_At__c" text,
  "Time_to_Quote__c" text,
  "Client_Time_to_Quote__c" text,
  "Account_Managerxx__c" text,
  "Paid_Date__c" text,
  "Commission_Payout2__c" text,
  "Account_Manager__c" text,
  "Mongo_Id__c" text
);
create unique index if not exists "sky_Quote_Id_idx" on public."sky_Quote" ("Id");
create index if not exists sky_quote_lastmodified_idx on public."sky_Quote" (public.sf_ts("LastModifiedDate"));
create index if not exists sky_quote_opportunity_idx on public."sky_Quote" ("OpportunityId");
alter table public."sky_Quote" enable row level security;
revoke all on public."sky_Quote" from anon, authenticated;
grant all on public."sky_Quote" to service_role;

create table if not exists public."sky_Order" (
  "Id" text,
  "OwnerId" text,
  "ContractId" text,
  "AccountId" text,
  "Pricebook2Id" text,
  "OriginalOrderId" text,
  "OpportunityId" text,
  "EffectiveDate" text,
  "EndDate" text,
  "IsReductionOrder" text,
  "Status" text,
  "Description" text,
  "CustomerAuthorizedById" text,
  "CompanyAuthorizedById" text,
  "Type" text,
  "BillingStreet" text,
  "BillingCity" text,
  "BillingState" text,
  "BillingPostalCode" text,
  "BillingCountry" text,
  "BillingLatitude" text,
  "BillingLongitude" text,
  "BillingGeocodeAccuracy" text,
  "ShippingStreet" text,
  "ShippingCity" text,
  "ShippingState" text,
  "ShippingPostalCode" text,
  "ShippingCountry" text,
  "ShippingLatitude" text,
  "ShippingLongitude" text,
  "ShippingGeocodeAccuracy" text,
  "Name" text,
  "PoDate" text,
  "ActivatedDate" text,
  "ActivatedById" text,
  "StatusCode" text,
  "OrderNumber" text,
  "TotalAmount" text,
  "CreatedDate" text,
  "CreatedById" text,
  "LastModifiedDate" text,
  "LastModifiedById" text,
  "IsDeleted" text,
  "SystemModstamp" text,
  "LastViewedDate" text,
  "LastReferencedDate" text,
  "PO_Amount__c" text,
  "Client__c" text,
  "Account_Managerxx__c" text,
  "Internal_Status__c" text,
  "Commission_Payout__c" text,
  "Completion_Date__c" text,
  "Paid_Date__c" text,
  "Time_to_Order__c" text,
  "PO_Count__c" text,
  "Commission_Payout2__c" text,
  "Service__c" text,
  "Account_Manager__c" text,
  "Salesforce_Exporter_Updated_At__c" text,
  "Mongo_Id__c" text
);
create unique index if not exists "sky_Order_Id_idx" on public."sky_Order" ("Id");
create index if not exists sky_order_lastmodified_idx on public."sky_Order" (public.sf_ts("LastModifiedDate"));
create index if not exists sky_order_opportunity_idx on public."sky_Order" ("OpportunityId");
alter table public."sky_Order" enable row level security;
revoke all on public."sky_Order" from anon, authenticated;
grant all on public."sky_Order" to service_role;

create table if not exists public.opp_quotes (
  id                    uuid primary key default gen_random_uuid(),
  salesforce_quote_id   text not null unique,
  opportunity_id        uuid references public.opportunities(id) on delete set null,
  client_id             uuid references public.org_clients(id),
  account_id            uuid references public.crm_accounts(id),
  contact_id            uuid references public.crm_contacts(id),
  owner_member_id       uuid references public.org_members(id),
  quote_number          text,
  name                  text,
  status                text,
  internal_status       text,
  amount                numeric,
  expires_on            date,
  completed_at          timestamptz,
  paid_on               date,
  time_to_quote_days    numeric,
  commission_payout     text,
  salesforce_created_at timestamptz,
  salesforce_updated_at timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists opp_quotes_opportunity_idx on public.opp_quotes (opportunity_id, salesforce_created_at desc);
create index if not exists opp_quotes_client_idx on public.opp_quotes (client_id);

create table if not exists public.opp_orders (
  id                    uuid primary key default gen_random_uuid(),
  salesforce_order_id   text not null unique,
  opportunity_id        uuid references public.opportunities(id) on delete set null,
  client_id             uuid references public.org_clients(id),
  account_id            uuid references public.crm_accounts(id),
  owner_member_id       uuid references public.org_members(id),
  order_number          text,
  name                  text,
  status                text,
  internal_status       text,
  service               text,
  po_count              text,
  amount                numeric,
  po_date               date,
  effective_on          date,
  completed_at          timestamptz,
  paid_on               date,
  time_to_order_days    numeric,
  commission_payout     text,
  salesforce_created_at timestamptz,
  salesforce_updated_at timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists opp_orders_opportunity_idx on public.opp_orders (opportunity_id, salesforce_created_at desc);
create index if not exists opp_orders_client_idx on public.opp_orders (client_id);

alter table public.opp_quotes enable row level security;
alter table public.opp_orders enable row level security;
revoke all on public.opp_quotes from anon;
revoke all on public.opp_orders from anon;

drop policy if exists opp_quotes_read on public.opp_quotes;
create policy opp_quotes_read on public.opp_quotes for select using (
  (select public.is_factur_user()) and (
    (select public.has_permission('org.manage'))
    or client_id in (select client_id from public.my_client_ids())
    or exists (select 1 from public.opportunities o where o.id = opp_quotes.opportunity_id)
  )
);
drop policy if exists opp_orders_read on public.opp_orders;
create policy opp_orders_read on public.opp_orders for select using (
  (select public.is_factur_user()) and (
    (select public.has_permission('org.manage'))
    or client_id in (select client_id from public.my_client_ids())
    or exists (select 1 from public.opportunities o where o.id = opp_orders.opportunity_id)
  )
);

create or replace function public.sync_opp_quotes_from_salesforce(p_since timestamptz default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  written integer;
begin
  /* A quote deleted in Salesforce comes back with IsDeleted set; it leaves here too. */
  delete from public.opp_quotes q
   using public."sky_Quote" s
   where s."Id" = q.salesforce_quote_id
     and coalesce(nullif(s."IsDeleted", '')::boolean, false)
     and (p_since is null or public.sf_ts(s."LastModifiedDate") > p_since);

  with upserted as (
    insert into public.opp_quotes (
      salesforce_quote_id, opportunity_id, client_id, account_id, contact_id, owner_member_id,
      quote_number, name, status, internal_status, amount, expires_on, completed_at, paid_on,
      time_to_quote_days, commission_payout, salesforce_created_at, salesforce_updated_at
    )
    select s."Id", o.id,
           coalesce(cl.id, o.client_id),
           coalesce(a.id, o.account_id), ct.id, om.id,
           nullif(s."QuoteNumber", ''),
           nullif(trim(s."Name"), ''),
           nullif(s."Status", ''),
           nullif(s."Internal_Status__c", ''),
           coalesce(nullif(s."Quote_Amount__c", '')::numeric, nullif(s."GrandTotal", '')::numeric, nullif(s."TotalPrice", '')::numeric),
           nullif(s."ExpirationDate", '')::date,
           nullif(s."Completion_Date__c", '')::timestamptz,
           nullif(s."Paid_Date__c", '')::date,
           nullif(s."Time_to_Quote__c", '')::numeric,
           nullif(s."Commission_Payout__c", ''),
           nullif(s."CreatedDate", '')::timestamptz,
           nullif(s."LastModifiedDate", '')::timestamptz
    from public."sky_Quote" s
    left join public.opportunities o  on o.salesforce_opportunity_id = nullif(s."OpportunityId", '')
    left join public.org_clients   cl on cl.salesforce_client_id     = nullif(s."Client__c", '')
    left join public.crm_accounts  a  on a.salesforce_account_id     = nullif(s."AccountId", '')
    left join public.crm_contacts  ct on ct.salesforce_contact_id    = nullif(s."ContactId", '')
    left join public.org_members   om on om.salesforce_user_id       = nullif(s."OwnerId", '')
    where not coalesce(nullif(s."IsDeleted", '')::boolean, false)
      and (p_since is null or public.sf_ts(s."LastModifiedDate") > p_since)
    on conflict (salesforce_quote_id) do update set
      opportunity_id = excluded.opportunity_id,
      client_id      = excluded.client_id,
      account_id     = excluded.account_id,
      contact_id     = excluded.contact_id,
      owner_member_id = excluded.owner_member_id,
      quote_number   = excluded.quote_number,
      name           = excluded.name,
      status         = excluded.status,
      internal_status = excluded.internal_status,
      amount         = excluded.amount,
      expires_on     = excluded.expires_on,
      completed_at   = excluded.completed_at,
      paid_on        = excluded.paid_on,
      time_to_quote_days = excluded.time_to_quote_days,
      commission_payout  = excluded.commission_payout,
      salesforce_created_at = excluded.salesforce_created_at,
      salesforce_updated_at = excluded.salesforce_updated_at,
      updated_at     = now()
    returning 1
  )
  select count(*) into written from upserted;

  update public.opp_quotes q
     set opportunity_id = o.id,
         client_id  = coalesce(q.client_id, o.client_id),
         account_id = coalesce(q.account_id, o.account_id),
         updated_at = now()
    from public."sky_Quote" s
    join public.opportunities o on o.salesforce_opportunity_id = nullif(s."OpportunityId", '')
   where s."Id" = q.salesforce_quote_id and q.opportunity_id is null;

  return written;
end;
$function$;

create or replace function public.sync_opp_orders_from_salesforce(p_since timestamptz default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  written integer;
begin
  delete from public.opp_orders q
   using public."sky_Order" s
   where s."Id" = q.salesforce_order_id
     and coalesce(nullif(s."IsDeleted", '')::boolean, false)
     and (p_since is null or public.sf_ts(s."LastModifiedDate") > p_since);

  with upserted as (
    insert into public.opp_orders (
      salesforce_order_id, opportunity_id, client_id, account_id, owner_member_id,
      order_number, name, status, internal_status, service, po_count, amount,
      po_date, effective_on, completed_at, paid_on, time_to_order_days, commission_payout,
      salesforce_created_at, salesforce_updated_at
    )
    select s."Id", o.id,
           coalesce(cl.id, o.client_id),
           coalesce(a.id, o.account_id), om.id,
           nullif(s."OrderNumber", ''),
           nullif(trim(s."Name"), ''),
           nullif(s."Status", ''),
           nullif(s."Internal_Status__c", ''),
           nullif(s."Service__c", ''),
           nullif(s."PO_Count__c", ''),
           coalesce(nullif(s."PO_Amount__c", '')::numeric, nullif(s."TotalAmount", '')::numeric),
           nullif(s."PoDate", '')::date,
           nullif(s."EffectiveDate", '')::date,
           nullif(s."Completion_Date__c", '')::timestamptz,
           nullif(s."Paid_Date__c", '')::date,
           nullif(s."Time_to_Order__c", '')::numeric,
           nullif(s."Commission_Payout__c", ''),
           nullif(s."CreatedDate", '')::timestamptz,
           nullif(s."LastModifiedDate", '')::timestamptz
    from public."sky_Order" s
    left join public.opportunities o  on o.salesforce_opportunity_id = nullif(s."OpportunityId", '')
    left join public.org_clients   cl on cl.salesforce_client_id     = nullif(s."Client__c", '')
    left join public.crm_accounts  a  on a.salesforce_account_id     = nullif(s."AccountId", '')
    left join public.org_members   om on om.salesforce_user_id       = nullif(s."OwnerId", '')
    where not coalesce(nullif(s."IsDeleted", '')::boolean, false)
      and (p_since is null or public.sf_ts(s."LastModifiedDate") > p_since)
    on conflict (salesforce_order_id) do update set
      opportunity_id = excluded.opportunity_id,
      client_id      = excluded.client_id,
      account_id     = excluded.account_id,
      owner_member_id = excluded.owner_member_id,
      order_number   = excluded.order_number,
      name           = excluded.name,
      status         = excluded.status,
      internal_status = excluded.internal_status,
      service        = excluded.service,
      po_count       = excluded.po_count,
      amount         = excluded.amount,
      po_date        = excluded.po_date,
      effective_on   = excluded.effective_on,
      completed_at   = excluded.completed_at,
      paid_on        = excluded.paid_on,
      time_to_order_days = excluded.time_to_order_days,
      commission_payout  = excluded.commission_payout,
      salesforce_created_at = excluded.salesforce_created_at,
      salesforce_updated_at = excluded.salesforce_updated_at,
      updated_at     = now()
    returning 1
  )
  select count(*) into written from upserted;

  update public.opp_orders q
     set opportunity_id = o.id,
         client_id  = coalesce(q.client_id, o.client_id),
         account_id = coalesce(q.account_id, o.account_id),
         updated_at = now()
    from public."sky_Order" s
    join public.opportunities o on o.salesforce_opportunity_id = nullif(s."OpportunityId", '')
   where s."Id" = q.salesforce_order_id and q.opportunity_id is null;

  return written;
end;
$function$;

revoke all on function public.sync_opp_quotes_from_salesforce(timestamptz) from public, anon;
revoke all on function public.sync_opp_orders_from_salesforce(timestamptz) from public, anon;

/* Into the every-three-minutes run, after activities. */
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
    'activities',    public.sync_opp_activities_from_salesforce(p_since),
    'quotes',        public.sync_opp_quotes_from_salesforce(p_since),
    'orders',        public.sync_opp_orders_from_salesforce(p_since)
  );
  return r;
end;
$function$;

/*
 * A watermark far in the past makes the sync route fetch everything on its
 * next runs (20,000 rows per object per run), which is the bulk load for
 * objects this size -- 30,000 quotes is two runs, 918 orders is one.
 */
insert into public.salesforce_sync_state (object, watermark)
values ('Quote', '2000-01-01T00:00:00Z'), ('Order', '2000-01-01T00:00:00Z')
on conflict (object) do nothing;

/*
 * Applied as 20260917100100 (quotes_orders_client_from_opportunity), folded
 * in here so the file reads as one piece.
 *
 * Client__c is blank on 24,914 of the 29,954 quotes and half the orders, so
 * the client (and company) fall back to the opportunity's -- which is also
 * what the read policy scopes on. And a quote whose opportunity turns up
 * later (the contact backfill brings opportunities in daily) is re-linked in
 * a second pass over unlinked rows only, rather than waiting for Salesforce to
 * touch the quote again.
 */
