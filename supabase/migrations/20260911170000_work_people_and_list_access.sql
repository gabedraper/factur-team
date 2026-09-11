/*
 * Who each ClickUp user is here, and which lists ClickUp lets them see.
 *
 * Access to the mirror has followed the members ClickUp lists on a private
 * space. That was the wrong source twice over. It misses anyone given access
 * through a user group, or through a folder or list shared on its own. And it
 * says nothing at all about private lists inside public spaces.
 *
 * ClickUp answers the real question per list: /list/{id}/member returns
 * everyone who can open it, however they came to. Checked against a list in a
 * public space: 66 of the workspace's 75 users, so it is effective access, not
 * the people added by hand. That is what gets mirrored here.
 *
 * Matching a ClickUp user to a person here is its own table because email is
 * not reliable enough to join on at read time: Darryl Mechell is
 * darryl@bethefactur.com in ClickUp and darryl.mechell@facturmfg.com here.
 * Email first, then full name, then a hand-set link that the sync never
 * overwrites.
 */

create table if not exists public.work_people (
  clickup_user_id text primary key,
  email text,
  username text,
  /* ClickUp's role: 1 owner, 2 admin, 3 member, 4 guest. */
  role integer,
  member_id uuid references public.org_members(id) on delete set null,
  match text check (match in ('email', 'name', 'manual')),
  synced_at timestamptz not null default now()
);

create index if not exists work_people_member_idx on public.work_people (member_id);

create table if not exists public.work_list_access (
  list_clickup_id text not null,
  clickup_user_id text not null,
  primary key (list_clickup_id, clickup_user_id)
);

create index if not exists work_list_access_user_idx on public.work_list_access (clickup_user_id);

/* When a list's access was last read, so a list never fetched can be told
 * apart from a list nobody may see. */
alter table public.work_containers
  add column if not exists access_synced_at timestamptz;

alter table public.work_people enable row level security;
alter table public.work_list_access enable row level security;
