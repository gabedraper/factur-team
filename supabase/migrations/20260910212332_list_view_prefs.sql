-- Per-person adjustments to any view, including the ones defined in code.
--
-- A row exists only once somebody actually hides, pins or moves something, so
-- this stays small rather than holding a row per person per view.
--
-- view_key is text rather than a foreign key because it also has to address
-- views that are not rows anywhere:
--   'system:mine'            -- defined in code
--   'scoped:client:<uuid>'   -- rendered per client, never materialised
--   'saved:<uuid>'           -- a row in list_views
create table if not exists public.list_view_prefs (
  member_id  uuid not null,
  entity     text not null,
  view_key   text not null,
  hidden     boolean not null default false,
  pinned     boolean not null default false,
  position   int,
  updated_at timestamptz not null default now(),
  primary key (member_id, entity, view_key)
);

create index if not exists list_view_prefs_member_entity_idx
  on public.list_view_prefs (member_id, entity);
