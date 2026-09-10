/*
 * Indexes that make an equals filter on a picklist seek instead of scan.
 *
 * These are what turn "Lead status equals Pipeline - Warm, sorted by lead
 * status" from 4,087ms into 7.9ms. The composite ones matter most: with
 * (client_id, lead_status) the planner seeks straight to the matching rows,
 * already in sort order, so the LIMIT stops after fifty and only fifty contacts
 * and companies get joined -- rather than joining all 1,909 matches and sorting
 * afterwards.
 *
 * Client first in the composite because a list view is nearly always looking at
 * one client's pipeline, and because it is the column RLS narrows on anyway.
 *
 * Built CONCURRENTLY: the Salesforce sync writes to this table every three
 * minutes and a plain CREATE INDEX would block it. That also means this file
 * cannot be replayed inside a transaction -- it was applied with autocommit.
 */

create index concurrently if not exists opportunities_client_lead_status_idx
  on public.opportunities (client_id, lead_status);

create index concurrently if not exists opportunities_client_stage_idx
  on public.opportunities (client_id, stage);

create index concurrently if not exists opportunities_lead_status_idx
  on public.opportunities (lead_status);

create index concurrently if not exists opportunities_stage_idx
  on public.opportunities (stage);
