/*
 * The three things a ClickUp list view shows that the mirror did not hold.
 *
 * Looking at a real Client Onboarding list: the rows are grouped by a custom
 * field ("Client Onboarding Phase"), one column is another custom field
 * ("Responsible Party" -- Team Lead, BDM, Account Manager), one is the time
 * estimate, and one is the dependency chain. None of those were mirrored, so
 * the view could not be rebuilt however the page was laid out.
 *
 * Custom field values arrive as option ids and orderindexes rather than words:
 * "Responsible Party" comes back as ["c82e0087-..."] and the phase as 0. The
 * definitions needed to turn those into "Team Lead" and "Phase 1: Sell & Sign"
 * ride along on every task payload, so the sync resolves them once, at write
 * time, and stores the words next to the raw value. A page should not have to
 * hold a field dictionary to render a row.
 */

alter table public.work_items
  add column if not exists time_estimate_ms bigint,
  add column if not exists time_spent_ms bigint,
  /*
   * One row's worth of custom fields, as an ordered array of
   * {id, name, type, value, display}. A column rather than a side table: 30,000
   * tasks times sixteen fields is half a million rows to answer "render this
   * list", and every question we actually ask is scoped to one list at a time.
   */
  add column if not exists fields jsonb;

/*
 * Dependencies are a table because both ends are asked about: "what is this
 * waiting on" and "what does finishing this unblock". The other end is stored
 * as a ClickUp id, not a foreign key -- a task may depend on one we have not
 * mirrored yet, and losing the edge would be worse than holding a dangling id.
 */
create table if not exists public.work_item_dependencies (
  work_item_id uuid not null references public.work_items(id) on delete cascade,
  depends_on_clickup_id text not null,
  relation text not null check (relation in ('blocking', 'waiting_on')),
  primary key (work_item_id, depends_on_clickup_id, relation)
);

create index if not exists work_item_dependencies_other_idx
  on public.work_item_dependencies (depends_on_clickup_id);

alter table public.work_item_dependencies enable row level security;

drop policy if exists work_item_dependencies_read on public.work_item_dependencies;
create policy work_item_dependencies_read on public.work_item_dependencies
  for select using (public.work_can_view());
