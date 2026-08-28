/*
 * Agents as records rather than as code.
 *
 * Gaib started as one constant in one file. Adding a second assistant meant a
 * deploy, and deciding who could talk to it meant an if-statement. Both of
 * those are the wrong shape for something that should be tuned by the person
 * who runs the company rather than by whoever is editing the repo that week.
 *
 * So: an agent is a row. Its instructions, the tools it holds, and the roles
 * allowed to open it are all editable in Settings. What stays in code is the
 * part that must not be editable from a database -- what each tool actually
 * does, and the ceiling on what the coding agent may ship unreviewed.
 */

-- ---------------------------------------------------------------------------
-- The agents themselves
-- ---------------------------------------------------------------------------

create table if not exists public.gaib_agents (
  id uuid primary key default gen_random_uuid(),
  -- Stable across renames, because sessions and tools refer to it.
  slug text not null unique,
  name text not null,
  -- One line in the hub list, so somebody can tell two agents apart without
  -- opening either.
  tagline text,
  /*
   * What this agent is for and how it behaves, in prose.
   *
   * Appended to a fixed preamble that lives in code -- the preamble carries the
   * rules that hold for every agent no matter what anyone types here, including
   * how to treat text it reads from mail and documents. An agent's own
   * instructions can shape its manner and its subject; they cannot loosen that.
   */
  instructions text not null default '',
  model text not null default 'claude-opus-5',
  effort text not null default 'medium' check (effort in ('low', 'medium', 'high', 'xhigh', 'max')),

  enabled boolean not null default true,
  -- The one the button in the sidebar opens. Exactly one, enforced below.
  is_default boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Two default agents would make "which one does the button open" a coin toss.
create unique index if not exists gaib_agents_one_default
  on public.gaib_agents ((is_default)) where is_default;

/*
 * Which tools an agent holds.
 *
 * The tool name is a key into a registry in code, not a description of
 * behaviour -- a row here grants an agent a capability that already exists and
 * has already been written and reviewed. Inventing a name that the registry
 * does not know grants nothing; it is ignored.
 *
 * Every tool also declares its own permission requirement in code. A row here
 * is therefore a ceiling, not a grant: an agent may hold search_my_email and
 * still return nothing to somebody whose Google account it cannot read.
 */
create table if not exists public.gaib_agent_tools (
  agent_id uuid not null references public.gaib_agents(id) on delete cascade,
  tool text not null,
  primary key (agent_id, tool)
);

/*
 * Who may open it. No rows means everybody.
 *
 * "Everybody" is the default because the first agent is a feedback assistant
 * that is useless if half the company cannot reach it. Restriction is opt-in,
 * for the agents that come later and look at narrower things.
 */
create table if not exists public.gaib_agent_roles (
  agent_id uuid not null references public.gaib_agents(id) on delete cascade,
  role_id uuid not null references public.org_roles(id) on delete cascade,
  primary key (agent_id, role_id)
);

-- Sessions belong to an agent, so a transcript can be read back knowing which
-- one said it. Null means the original Gaib, from before there were others.
alter table public.gaib_sessions
  add column if not exists agent_id uuid references public.gaib_agents(id) on delete set null;

-- ---------------------------------------------------------------------------
-- The coding agent's dials
-- ---------------------------------------------------------------------------

/*
 * One row. What the person running the company can turn down.
 *
 * Deliberately only a floor-lowering mechanism. The code keeps its own maximum
 * for each of these and takes whichever is stricter, and the protected-path
 * list here can only add paths, never remove them. That asymmetry is the whole
 * point: someone who reached this table should still not be able to widen what
 * an automated agent may push to production, and every widening remains a code
 * change that a person reviews.
 */
create table if not exists public.gaib_coding_settings (
  id boolean primary key default true check (id),
  -- Off to begin with. The first weeks are for watching what it would have
  -- done, not for finding out afterwards.
  auto_ship boolean not null default false,
  max_files integer not null default 6,
  max_lines integer not null default 250,
  extra_protected_paths text[] not null default '{}',
  updated_at timestamptz not null default now()
);

insert into public.gaib_coding_settings (id) values (true) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Reading data as the person who asked
-- ---------------------------------------------------------------------------

/*
 * The query an agent runs on somebody's behalf.
 *
 * security invoker, and that word is the entire security model. The function
 * executes as the signed-in person, so every row level security policy in the
 * database applies exactly as it does when they click around the app. An agent
 * cannot read anything its user could not already read, and nothing here has
 * to be kept in step with the app's permissions because it *is* the app's
 * permissions.
 *
 * The checks below are not that boundary. They stop an agent wandering into
 * raw staging tables and filling a conversation with noise, and they stop a
 * runaway query taking the database with it. Useful, but the reason this is
 * safe is the two words at the top of this paragraph.
 */
create or replace function public.gaib_query(p_sql text)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  lowered text := lower(regexp_replace(p_sql, '\s+', ' ', 'g'));
  target text;
  result jsonb;
  ctes text[] := '{}';
  allowed constant text[] := array[
    -- People and structure
    'org_members', 'org_roles', 'org_teams', 'org_services', 'org_assignments',
    'org_permissions', 'org_role_permissions', 'profiles', 'reps', 'google_people',
    -- Clients
    'org_clients', 'org_client_assignments', 'client_history', 'client_contacts',
    'client_aliases', 'client_nps', 'client_quickbooks_links',
    -- Money
    'qb_invoices_raw', 'qb_payments_raw', 'qb_ar_aging_raw', 'qb_customers_raw',
    'collections_client_state', 'collections_steps', 'collections_sent',
    -- Salesforce
    'sf_clients_raw', 'sf_opportunities_raw', 'sf_users_raw', 'sf_orders_raw',
    'sf_tasks_raw', 'sf_events_raw', 'sf_opp_stage_changes_raw',
    -- Performance
    'raw_activities', 'deal_activities', 'metric_snapshots', 'timeline_summaries',
    -- Surveys and sequences
    'nps_campaigns', 'nps_sends', 'nps_send_team', 'sequences', 'sequence_runs',
    -- Talent
    'tal_people', 'tal_jobs', 'tal_companies', 'tal_candidates', 'tal_activities',
    'tal_person_jobs', 'tal_person_educations', 'tal_placements', 'tal_applications',
    'tal_workflow_stages', 'tal_workflows', 'tal_lists', 'tal_list_members',
    -- Learning
    'courses', 'modules', 'lessons', 'enrollments', 'lesson_progress', 'certificates'
  ];
begin
  if lowered !~ '^ ?(select|with) ' then
    raise exception 'Only SELECT is allowed here.';
  end if;

  -- One statement. A semicolon is the only way to smuggle a second one past
  -- the check above, so it is refused outright rather than parsed.
  if position(';' in trim(trailing ';' from trim(p_sql))) > 0 then
    raise exception 'Only one statement at a time.';
  end if;

  if lowered ~ '\m(insert|update|delete|drop|alter|grant|revoke|truncate|copy|vacuum|call)\M' then
    raise exception 'Only SELECT is allowed here.';
  end if;

  -- Functions that reach outside the database, or that can be used to sit on a
  -- connection until something times out.
  if lowered ~ '(pg_sleep|dblink|pg_read_file|pg_ls_dir|lo_import|lo_export|pg_stat_file)' then
    raise exception 'That function is not available.';
  end if;

  /*
   * Every table the query names has to be on the list.
   *
   * Read off the words following from and join, which is crude and errs on the
   * strict side: an alias or a subquery keyword that is not a table will fail
   * the check and the agent will be told to rephrase. Being told to rephrase is
   * a cost worth paying for a rule that is short enough to read in full.
   */
  /*
   * Names introduced by a WITH clause are tables for the length of the query.
   * Without this, every common table expression looked like a table nobody had
   * heard of, and the most natural way to write an aggregate was refused. They
   * smuggle nothing: whatever the expression selects from is still checked.
   */
  select coalesce(array_agg(m[1]), '{}')
    into ctes
    from regexp_matches(lowered, '([a-z_][a-z0-9_]*) as \(', 'g') m;

  for target in
    select (regexp_matches(lowered, '(?:from|join) ([a-z_][a-z0-9_.]*)', 'g'))[1]
  loop
    target := replace(target, 'public.', '');
    if not (target = any (allowed)) and not (target = any (ctes)) then
      raise exception 'Table "%" is not available to agents.', target;
    end if;
  end loop;

  -- A query that will not finish is a query nobody is waiting for any more.
  set local statement_timeout = '8s';

  /*
   * The cap belongs inside, around the rows. Outside, it lands on the single
   * aggregated row and silently does nothing -- the worst kind of limit, one
   * that reads as present and is not.
   */
  execute format(
    'select coalesce(jsonb_agg(row_to_json(t)), ''[]''::jsonb) from (select * from (%s) q limit 200) t',
    p_sql
  ) into result;

  return result;
end;
$$;

revoke all on function public.gaib_query(text) from public, anon;
grant execute on function public.gaib_query(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.gaib_agents enable row level security;
alter table public.gaib_agent_tools enable row level security;
alter table public.gaib_agent_roles enable row level security;
alter table public.gaib_coding_settings enable row level security;

-- Everyone signed in can see which agents exist; only org.manage writes, and
-- every write goes through the server with the service role anyway.
drop policy if exists gaib_agents_read on public.gaib_agents;
create policy gaib_agents_read on public.gaib_agents
  for select to authenticated using (public.is_factur_user());

drop policy if exists gaib_agent_tools_read on public.gaib_agent_tools;
create policy gaib_agent_tools_read on public.gaib_agent_tools
  for select to authenticated using (public.is_factur_user());

drop policy if exists gaib_agent_roles_read on public.gaib_agent_roles;
create policy gaib_agent_roles_read on public.gaib_agent_roles
  for select to authenticated using (public.is_factur_user());

drop policy if exists gaib_coding_settings_read on public.gaib_coding_settings;
create policy gaib_coding_settings_read on public.gaib_coding_settings
  for select to authenticated
  using (public.is_factur_user() and public.has_permission('org.manage'));

create or replace function public.gaib_touch_agent()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists gaib_agents_touch on public.gaib_agents;
create trigger gaib_agents_touch
  before update on public.gaib_agents
  for each row execute function public.gaib_touch_agent();

-- ---------------------------------------------------------------------------
-- Gaib, as a row
-- ---------------------------------------------------------------------------

insert into public.gaib_agents (slug, name, tagline, instructions, is_default)
values (
  'gaib',
  'Gaib',
  'Asks how the app is going, answers questions about it and the business.',
  '',
  true
)
on conflict (slug) do nothing;

insert into public.gaib_agent_tools (agent_id, tool)
select a.id, t.tool
  from public.gaib_agents a
 cross join (values
   ('search_tickets'), ('raise_ticket'),
   ('describe_data'), ('query_data'),
   ('search_my_email'), ('read_my_email'),
   ('search_my_chat'), ('search_my_drive')
 ) as t(tool)
 where a.slug = 'gaib'
on conflict do nothing;
