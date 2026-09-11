/*
 * Sharing one task with one person.
 *
 * Access to the mirror follows ClickUp space membership, which is the right
 * default and too coarse for the first real request against it: "give Sonitha
 * this page". Adding her to Marketing Services - Client in ClickUp would show
 * her all 450 tasks in that space to answer a question about one.
 *
 * A grant opens a single task's page, and the subtasks on it, to a named
 * person. It does not surface the task in their queue or lists -- they reach it
 * through the link they were sent, the way a shared ClickUp task works. Tasks
 * the granted one is blocked by or linked to stay private unless they are
 * visible anyway.
 *
 * Grants live here rather than in ClickUp because the mirror is read-only, and
 * the next containers sync rewrites space membership from ClickUp -- a person
 * added to member_emails by hand would be removed within the day.
 *
 * No policies: the service key reads it, from code that has already decided
 * who is asking.
 */
create table if not exists public.work_access_grants (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.org_members(id) on delete cascade,
  clickup_id text not null,
  granted_by uuid references public.org_members(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (member_id, clickup_id)
);

create index if not exists work_access_grants_member_idx on public.work_access_grants (member_id);

alter table public.work_access_grants enable row level security;
