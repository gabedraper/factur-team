/*
 * ClickUp's spaces, folders and lists as records, not as names on a task.
 *
 * work_items already remembers the space, folder and list it came from, which
 * is enough to group by and not enough to navigate. It cannot show a list that
 * happens to have no tasks in it, it has no stable address for a space or a
 * folder, and it can only be ordered alphabetically -- and people do not keep
 * their sidebar in alphabetical order, they drag it into the shape of their
 * job. Rebuilding the tree from task rows produces something recognisable but
 * subtly wrong, which for adoption is worse than either extreme.
 *
 * So the containers are mirrored too. It costs about 46 API calls against the
 * 1,178 a full task sync spends, and it is what lets somebody find their way
 * around here on the first day using the map they already have in their head.
 */
create table if not exists public.work_containers (
  id uuid primary key default gen_random_uuid(),

  clickup_id text not null unique,
  kind text not null check (kind in ('space', 'folder', 'list')),
  name text not null,

  /*
   * A folder's parent is its space; a list's parent is its folder, or its space
   * when it is one of ClickUp's "folderless" lists. Depth is therefore not
   * fixed, which is why this is a parent pointer and not three columns.
   */
  parent_clickup_id text,

  /* Denormalised so the whole tree for one space is a single indexed read. */
  space_clickup_id text,

  /* ClickUp's own manual ordering. The reason the tree reads correctly. */
  orderindex numeric,

  /* What ClickUp reports, which includes tasks we may not have mirrored. */
  task_count integer not null default 0,

  archived boolean not null default false,

  /*
   * A list's status set, kept whole. Phase 2 needs it to map statuses in both
   * directions, and it is free to collect now while we are already here.
   */
  statuses jsonb,

  url text,
  synced_at timestamptz not null default now()
);

create index if not exists work_containers_parent_idx
  on public.work_containers (parent_clickup_id, orderindex);
create index if not exists work_containers_space_idx
  on public.work_containers (space_clickup_id, kind);
create index if not exists work_containers_kind_idx
  on public.work_containers (kind, orderindex);

alter table public.work_containers enable row level security;

drop policy if exists work_containers_read on public.work_containers;
create policy work_containers_read on public.work_containers
  for select using (public.work_can_view());

/* No write policy, for the same reason work_items has none: the sync owns it. */
