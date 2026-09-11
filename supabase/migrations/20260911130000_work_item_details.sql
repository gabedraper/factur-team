/*
 * What a task page needs that the bulk sync cannot fetch.
 *
 * Comments and attachments only come from ClickUp one task at a time. Pulling
 * them for all 30,000 tasks would take five hours of rate limit, for pages most
 * of which nobody will ever open. So a task page fetches its own the moment
 * somebody opens it, and keeps the answer here for a few minutes: a refresh, or
 * a second person opening the same task, costs nothing.
 *
 * It is a cache, not a record. The raw payloads are kept whole so the page can
 * render whatever ClickUp said without this table having to anticipate every
 * field; anything worth querying across tasks belongs on work_items instead.
 *
 * No read policy: only the service key touches it, from a page that has
 * already checked the viewer may see the task.
 */
create table if not exists public.work_item_details (
  clickup_id text primary key,
  task jsonb not null,
  comments jsonb not null default '[]'::jsonb,
  fetched_at timestamptz not null default now()
);

alter table public.work_item_details enable row level security;
