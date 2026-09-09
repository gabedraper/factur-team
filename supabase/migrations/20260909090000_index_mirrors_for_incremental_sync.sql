/*
 * Make "what changed since I last looked" cheap.
 *
 * The mirrors store every column as text, so the transforms compared
 * "LastModifiedDate"::timestamptz against the watermark. A cast on the left of a
 * comparison cannot use an index, so each incremental run scanned all 900K
 * opportunities and 743K tasks to find the couple of thousand changed rows, and
 * timed out before it found them.
 *
 * Indexing that expression directly is not allowed: text -> timestamptz is
 * STABLE, not IMMUTABLE, because in general it depends on the session timezone.
 *
 * sf_ts() gets around that, and is honest about why it is safe rather than
 * pretending the general case holds. Salesforce always writes an explicit UTC
 * offset -- 2026-09-09T15:28:01.000+0000 from the REST API,
 * 2026-09-09T15:28:01.000Z from a Bulk API export -- and a timestamp string
 * carrying its own offset parses to the same instant under any session timezone.
 * The immutability the index needs therefore does hold for this data, even
 * though it would not for a bare '2026-09-09 15:28:01'.
 *
 * If a future loader ever writes offset-free timestamps into these columns, this
 * index becomes wrong rather than slow. That is the trade, and it is why the
 * loader writes Salesforce's values through unchanged.
 */

create or replace function public.sf_ts(p text)
returns timestamptz
language sql
immutable
parallel safe
as $function$
  select nullif(p, '')::timestamptz;
$function$;

comment on function public.sf_ts(text) is
  'Parse a Salesforce timestamp string. Marked immutable so it can be indexed -- safe only because Salesforce always includes an explicit UTC offset.';

create index if not exists sky_opportunity_lastmodified_idx
  on public."sky_Opportunity" (public.sf_ts("LastModifiedDate"));
create index if not exists sky_contact_lastmodified_idx
  on public."sky_Contact" (public.sf_ts("LastModifiedDate"));
create index if not exists sky_account_lastmodified_idx
  on public."sky_Account" (public.sf_ts("LastModifiedDate"));
create index if not exists sky_task_lastmodified_idx
  on public."sky_Task" (public.sf_ts("LastModifiedDate"));
create index if not exists sky_event_lastmodified_idx
  on public."sky_Event" (public.sf_ts("LastModifiedDate"));

/*
 * The join columns too. Once the changed rows are found quickly, the next cost
 * is looking up each one's client, contact, account or opportunity -- on a full
 * backfill that was a hash join nobody minded, but on a two-thousand-row
 * incremental it should be index lookups, not scans.
 */
create index if not exists sky_opportunity_client_idx
  on public."sky_Opportunity" ("Client__c");
create index if not exists sky_opportunity_contact_idx
  on public."sky_Opportunity" ("Client_Contact__c");
create index if not exists sky_opportunity_account_idx
  on public."sky_Opportunity" ("AccountId");
create index if not exists sky_task_whatid_idx
  on public."sky_Task" ("WhatId");
create index if not exists sky_event_whatid_idx
  on public."sky_Event" ("WhatId");

revoke all on function public.sf_ts(text) from public, anon;
grant execute on function public.sf_ts(text) to authenticated, service_role;
