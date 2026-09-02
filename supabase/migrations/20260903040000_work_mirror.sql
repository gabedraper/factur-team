/*
 * ClickUp, mirrored read-only.
 *
 * The work our team does lives in ClickUp, in 1,012 lists spread across 214
 * client folders. None of it is visible next to the client, the invoice or the
 * opportunity it concerns, so people keep two systems open and copy between
 * them by hand.
 *
 * This brings the work over as data and leaves the editing where it is. Every
 * row keeps its ClickUp id and URL and is one click from the real thing. There
 * is no write path back on purpose: the moment both sides accept edits we own a
 * conflict problem, and the useful half -- seeing the work in context -- does
 * not require it.
 *
 * docs/clickup-processes.md is the reasoning behind the shape.
 */

-- ---------------------------------------------------------------------------
-- Processes

/*
 * A ClickUp list is not a container, it is a kind of work. "Client Onboarding"
 * appears in 45 client folders and means the same thing in all of them, so it
 * is one row here and 45 sets of items over there.
 *
 * match_prefixes is how a list name becomes a process, lowercased and compared
 * from the start of the name. Order matters and is why position exists:
 * "Website Change Requests" has to be tested before "Website" or every change
 * request becomes a website project. First match wins.
 *
 * The patterns live in the table rather than in code so that a list somebody
 * renames next quarter is a row edit, not a deploy.
 */
create table if not exists public.work_processes (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  -- 'client' work hangs off a client record, 'internal' does not.
  kind text not null default 'client' check (kind in ('client', 'internal')),
  match_prefixes text[] not null default '{}',
  position integer not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists work_processes_order_idx
  on public.work_processes (position) where active;

-- ---------------------------------------------------------------------------
-- Items

/*
 * One row per ClickUp task.
 *
 * The links are one nullable foreign key per kind of thing, which is how
 * tal_tasks already does it. A single "type + id" pair would be shorter and
 * worse: it cannot be a real foreign key, so it can point at a deleted client,
 * and it can only hold one link at a time. A finance request belongs to a
 * client *and* a service period *and* sometimes an opportunity, and all three
 * matter -- that is the whole reason for doing this.
 *
 * The clickup_* text columns keep the original container names even after a
 * row is matched. An item whose folder we could not match to a client still has
 * to be findable by the person who wrote it, and the raw names are the only
 * thing that will identify it.
 */
create table if not exists public.work_items (
  id uuid primary key default gen_random_uuid(),

  -- Identity comes from ClickUp. Every sync is an upsert on this.
  clickup_id text not null unique,
  clickup_url text not null,

  title text not null,
  body text,

  -- Status is whatever ClickUp calls it, kept verbatim; status_type is
  -- ClickUp's own grouping and is the only part safe to reason about, because
  -- the names differ per list and always will.
  status text not null,
  status_type text check (status_type in ('open', 'custom', 'done', 'closed')),
  priority text check (priority in ('urgent', 'high', 'normal', 'low')),

  due_at timestamptz,
  start_at timestamptz,
  closed_at timestamptz,
  created_at_remote timestamptz,
  updated_at_remote timestamptz,

  process_id uuid references public.work_processes(id) on delete set null,

  -- The pod in the list name: "Service Delivery // LG" -> 'LG'.
  pod text,

  -- The links. All nullable, several may be set at once.
  client_id uuid references public.org_clients(id) on delete set null,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  service_period_id uuid references public.client_service_periods(id) on delete set null,

  -- Where it came from, kept whether or not the match above succeeded.
  clickup_space text,
  clickup_folder text,
  clickup_list text,
  clickup_list_id text,

  -- How the client link was made, so a bad match can be found and the matcher
  -- corrected rather than the row patched.
  client_match text check (client_match in ('folder', 'alias', 'title', 'space', 'manual')),

  parent_clickup_id text,

  synced_at timestamptz not null default now()
);

create index if not exists work_items_client_idx
  on public.work_items (client_id, status_type, due_at);
create index if not exists work_items_process_idx
  on public.work_items (process_id, status_type);
create index if not exists work_items_open_idx
  on public.work_items (due_at) where status_type in ('open', 'custom');
create index if not exists work_items_list_idx
  on public.work_items (clickup_list_id);
create index if not exists work_items_parent_idx
  on public.work_items (parent_clickup_id) where parent_clickup_id is not null;

/*
 * Assignees are their own table because ClickUp allows several and "my queue"
 * is wrong the moment a two-person task shows for only one of them.
 *
 * member_id is nullable: 15 of the 91 people in that workspace are client
 * guests who have no org_members row and should not get one. Their name is
 * kept so the item still reads correctly.
 */
create table if not exists public.work_item_assignees (
  work_item_id uuid not null references public.work_items(id) on delete cascade,
  clickup_user_id text not null,
  member_id uuid references public.org_members(id) on delete set null,
  name text,
  primary key (work_item_id, clickup_user_id)
);

create index if not exists work_item_assignees_member_idx
  on public.work_item_assignees (member_id);

-- ---------------------------------------------------------------------------
-- Sync runs

/*
 * What the last sync did. Shown on the page: a mirror that quietly stopped
 * updating three weeks ago is worse than no mirror, because people trust it.
 */
create table if not exists public.work_sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  lists_seen integer not null default 0,
  items_seen integer not null default 0,
  items_written integer not null default 0,
  unmatched_clients integer not null default 0,
  error text
);

create index if not exists work_sync_runs_recent_idx
  on public.work_sync_runs (started_at desc);

-- ---------------------------------------------------------------------------
-- Who may read it

insert into public.org_permissions (key, name, description) values
  ('work.view', 'View ClickUp work',
   'See mirrored ClickUp tasks on client, finance and personal screens.')
on conflict (key) do nothing;

/*
 * Everybody who works here, because the point of the mirror is that work stops
 * being invisible. Narrowing it would rebuild the problem it exists to solve.
 */
insert into public.org_role_permissions (role_id, permission_key)
select r.id, 'work.view' from public.org_roles r
on conflict do nothing;

create or replace function public.work_can_view()
returns boolean language sql stable set search_path to 'public', 'pg_catalog'
as $function$
  select public.is_factur_user()
     and (public.has_permission('work.view') or public.has_permission('org.manage'));
$function$;

alter table public.work_processes enable row level security;
alter table public.work_items enable row level security;
alter table public.work_item_assignees enable row level security;
alter table public.work_sync_runs enable row level security;

do $$
declare t text;
begin
  foreach t in array array['work_processes', 'work_items', 'work_item_assignees', 'work_sync_runs']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format(
      'create policy %I on public.%I for select using (public.work_can_view())', t || '_read', t);
  end loop;
end $$;

/*
 * No insert, update or delete policy anywhere above, and that is the point.
 * The sync runs on the service key; nothing reached through a signed-in session
 * can write here. If a write path is ever wanted it should arrive as its own
 * migration with its own argument, not by loosening this one.
 */

-- ---------------------------------------------------------------------------
-- The twelve

insert into public.work_processes (slug, name, kind, position, match_prefixes) values
  ('finance-requests',   'Finance Requests',        'client',   10, array['finance request']),
  ('client-onboarding',  'Client Onboarding',       'client',   20, array['client onboarding', 'onboarding']),
  ('client-offboarding', 'Client Offboarding',      'client',   30, array['client offboarding', 'offboarding']),
  ('service-delivery',   'Service Delivery',        'client',   40, array['service delivery']),
  ('website-changes',    'Website Change Requests', 'client',   50, array['website change']),
  ('website',            'Website',                 'client',   60, array['website']),
  ('brand',              'Brand',                   'client',   70, array['brand']),
  ('targeting',          'Targeting',               'client',   80, array['targeting']),
  ('tool-setup',         'Outbound Tool Setup',     'client',   90, array['linkedin, heyreach', 'heyreach']),
  ('content',            'Content',                 'client',  100, array['blog &', 'linkedin', 'content']),
  ('ideas-issues',       'Ideas & Issues',          'client',  110, array['client ideas', 'ideas /']),
  ('quarterly-projects', 'Quarterly Projects',      'client',  120, array['quarterly project', 'seo', 'tactics'])
on conflict (slug) do nothing;
