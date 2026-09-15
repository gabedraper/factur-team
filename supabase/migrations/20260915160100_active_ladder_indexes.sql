/*
 * Indexes behind "my active opportunities".
 *
 * The system views ask for the active rows of a person's clients, or the ones
 * they or their reports own, newest change first. Partial indexes on each flag
 * mean the planner seeks straight into the active slice -- a few thousand rows
 * for most people -- rather than scanning a client's fifty thousand and
 * discarding the closed ones.
 *
 * Built CONCURRENTLY, like the picklist indexes before them: the Salesforce
 * transform writes to this table every three minutes and a plain CREATE INDEX
 * would block it. That also means this file cannot be replayed inside a
 * transaction -- apply it with autocommit, one statement at a time.
 */

create index concurrently if not exists opportunities_client_active_stage_idx
  on public.opportunities (client_id, updated_at desc) where active_by_stage;

create index concurrently if not exists opportunities_client_active_lead_status_idx
  on public.opportunities (client_id, updated_at desc) where active_by_lead_status;

create index concurrently if not exists opportunities_owner_active_stage_idx
  on public.opportunities (owner_member_id, updated_at desc) where active_by_stage;

create index concurrently if not exists opportunities_owner_active_lead_status_idx
  on public.opportunities (owner_member_id, updated_at desc) where active_by_lead_status;
