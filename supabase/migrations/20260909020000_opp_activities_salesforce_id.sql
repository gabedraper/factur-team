/*
 * Give opp_activities a Salesforce id.
 *
 * Every other synced table carries the id of the record it came from --
 * salesforce_opportunity_id, salesforce_contact_id, salesforce_client_id -- and
 * opp_activities was created without one. That is the column an upsert matches
 * on, so without it a second sync run cannot tell an activity it has already
 * loaded from a new one, and every row doubles.
 *
 * Nullable, because activities logged in this app are not from Salesforce and
 * have no such id. Unique so the upsert has something to conflict against, and
 * a partial index so the nulls do not collide with each other.
 */

alter table public.opp_activities
  add column if not exists salesforce_activity_id text;

create unique index if not exists opp_activities_salesforce_activity_id_key
  on public.opp_activities (salesforce_activity_id)
  where salesforce_activity_id is not null;

comment on column public.opp_activities.salesforce_activity_id is
  'Salesforce Task or Event id. Null for activities created in this app. The match key for the Salesforce sync.';
