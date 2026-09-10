/*
 * Saved list views, the way Salesforce does them.
 *
 * People coming off Salesforce know this shape: a dropdown of named views, each
 * carrying its own columns, its own filters and its own sort, some private and
 * some shared with everyone. Rebuilding the pipeline screens without it means
 * asking them to give up the one habit that makes a CRM theirs, which is a bad
 * trade when the whole point is getting them to move.
 *
 * Columns and filters are stored as data rather than as a query. Nothing here
 * is executed -- the app maps each field key through a whitelist to build the
 * query, so a filter row is a name and a value, never a fragment of SQL. A view
 * naming a field that no longer exists is ignored, which is what should happen
 * when somebody's saved view outlives a column.
 *
 * Two kinds: shared views belong to everyone and only org.manage may write
 * them, and private ones belong to the person who made them. That is the split
 * Salesforce draws too, and it keeps one person's experiment out of everybody
 * else's dropdown.
 */

create table if not exists public.opportunity_list_views (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  owner_member_id  uuid references public.org_members(id) on delete cascade,
  shared           boolean not null default false,
  columns          text[] not null default '{}',
  filters          jsonb  not null default '[]'::jsonb,
  sort_field       text,
  sort_dir         text not null default 'asc' check (sort_dir in ('asc', 'desc')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  /* A shared view has no owner; a private one must have one. */
  constraint opportunity_list_views_ownership
    check ((shared and owner_member_id is null) or (not shared and owner_member_id is not null))
);

create index if not exists opportunity_list_views_owner_idx
  on public.opportunity_list_views (owner_member_id) where owner_member_id is not null;

alter table public.opportunity_list_views enable row level security;

/*
 * Read: shared views, plus your own. Write: your own freely, shared ones only
 * with org.manage -- a view everybody sees is a small piece of company
 * furniture, not something to be rearranged by whoever opened it last.
 */
drop policy if exists opportunity_list_views_read on public.opportunity_list_views;
create policy opportunity_list_views_read on public.opportunity_list_views
  for select to authenticated
  using (
    public.is_factur_user()
    and (shared or owner_member_id = (
      select id from public.org_members where active and auth_user_id = auth.uid() limit 1
    ))
  );

drop policy if exists opportunity_list_views_write_own on public.opportunity_list_views;
create policy opportunity_list_views_write_own on public.opportunity_list_views
  for all to authenticated
  using (
    owner_member_id = (
      select id from public.org_members where active and auth_user_id = auth.uid() limit 1
    )
  )
  with check (
    owner_member_id = (
      select id from public.org_members where active and auth_user_id = auth.uid() limit 1
    )
  );

drop policy if exists opportunity_list_views_write_shared on public.opportunity_list_views;
create policy opportunity_list_views_write_shared on public.opportunity_list_views
  for all to authenticated
  using (shared and public.has_permission('org.manage'))
  with check (shared and public.has_permission('org.manage'));

revoke all on table public.opportunity_list_views from public, anon;
grant select, insert, update, delete on table public.opportunity_list_views to authenticated;


/*
 * Two shared views to start from, so the dropdown is never empty on a first
 * visit and there is something to copy rather than a blank form.
 *
 * "Open pipeline" is the working list: a client can carry tens of thousands of
 * historical Closed and DQ rows, and that is an archive to filter into on
 * purpose, not the default. "Needs action" is the one people actually live in.
 */
insert into public.opportunity_list_views (name, shared, columns, filters, sort_field, sort_dir)
select 'Open pipeline', true,
       array['contact_name', 'account_name', 'client_name', 'stage', 'lead_status', 'next_action_date', 'updates'],
       '[{"field": "stage", "op": "not_starts_with", "value": "Closed"}]'::jsonb,
       'next_action_date', 'asc'
where not exists (select 1 from public.opportunity_list_views where name = 'Open pipeline' and shared);

insert into public.opportunity_list_views (name, shared, columns, filters, sort_field, sort_dir)
select 'Needs action', true,
       array['contact_name', 'account_name', 'client_name', 'stage', 'next_action_date', 'updates'],
       '[{"field": "stage", "op": "not_starts_with", "value": "Closed"},
         {"field": "next_action_date", "op": "on_or_before", "value": "today"}]'::jsonb,
       'next_action_date', 'asc'
where not exists (select 1 from public.opportunity_list_views where name = 'Needs action' and shared);
