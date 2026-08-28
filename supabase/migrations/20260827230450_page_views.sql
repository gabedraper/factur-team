-- What each page costs the people using it.
--
-- One row per view. Written by the browser, because the number that matters is
-- the one somebody waited through -- server time alone leaves out the part
-- where the page arrives and then does nothing for a second.

create table if not exists page_views (
  id bigserial primary key,
  path text not null,
  -- Null for a signed-out or expired view. Kept rather than dropped: the view
  -- still happened and still took as long as it took.
  member_id uuid references org_members(id) on delete set null,
  -- 'load' is a fresh arrival, 'route' a move inside the app. They are not
  -- comparable -- one pays for the whole document and the other does not -- so
  -- they are recorded apart rather than averaged into one misleading number.
  kind text not null check (kind in ('load', 'route')),
  duration_ms integer not null check (duration_ms >= 0),
  occurred_at timestamptz not null default now()
);

create index if not exists page_views_path_idx on page_views (path, occurred_at desc);
create index if not exists page_views_occurred_idx on page_views (occurred_at desc);

alter table page_views enable row level security;

drop policy if exists page_views_insert on page_views;
create policy page_views_insert on page_views
  for insert to authenticated with check (true);

drop policy if exists page_views_select on page_views;
create policy page_views_select on page_views
  for select to authenticated using (has_permission('org.manage'));
