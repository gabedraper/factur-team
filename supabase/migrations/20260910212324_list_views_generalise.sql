-- Generalise the opportunity-only saved-view table.
--
-- client_id is deliberately NOT a foreign key. org_clients is rebuilt by
-- Coupler on every sync, which drops dependent constraints with it -- the same
-- reason indexes and RLS have to be reapplied by ensure_staging_ready().
alter table public.opportunity_list_views rename to list_views;

alter table public.list_views
  add column if not exists entity text not null default 'opportunities',
  add column if not exists client_id uuid,
  add column if not exists position int not null default 0;
