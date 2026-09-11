-- Gaib on Managed Agents.
--
-- The chat engine answers inside one web request: a dozen tool calls and five
-- minutes, then it is cut off. Managed Agents runs the same Gaib in a sandbox
-- Anthropic hosts, for as long as a task takes, and reaches back into the app
-- for everything that touches company data through /api/gaib/mcp.
--
-- One row per Managed Agents session. The token is how the MCP endpoint knows
-- who a tool call is for: it is minted per session, stored in an Anthropic
-- vault for that session only, and held here as a hash.

alter table public.gaib_agents
  add column if not exists engine text not null default 'messages'
    check (engine in ('messages', 'managed')),
  -- Tried on these people before everyone, whatever engine says.
  add column if not exists worker_emails text[] not null default '{}',
  add column if not exists worker_agent_id text,
  add column if not exists worker_environment_id text,
  -- What the Managed Agents agent was last built from, so it is only
  -- re-published when the instructions, voice or model actually change.
  add column if not exists worker_config_hash text,
  -- Per task, in cents. Holders of gaib.ship get the larger one.
  add column if not exists worker_budget_cents integer not null default 1000,
  add column if not exists worker_budget_cents_ship integer not null default 5000;

create table if not exists public.gaib_workers (
  id uuid primary key default gen_random_uuid(),
  gaib_session_id uuid not null references public.gaib_sessions(id) on delete cascade,
  user_id uuid not null,
  email text not null,
  -- private: the person's own access. room: only what the whole room may see.
  mode text not null check (mode in ('private', 'room')),
  managed_session_id text unique,
  vault_id text,
  token_hash text not null unique,
  -- Where the answer goes. Null for the app, which reads the transcript.
  reply_space text,
  reply_thread text,
  status text not null default 'starting'
    check (status in ('starting', 'running', 'idle', 'ended', 'failed')),
  -- processed_at of the newest event already handled.
  events_seen_until timestamptz,
  -- The user message the current turn is answering, so its reply is posted once.
  turn_started_at timestamptz,
  replied_at timestamptz,
  gifs jsonb not null default '[]',
  error text,
  created_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  ended_at timestamptz
);

create index if not exists gaib_workers_live
  on public.gaib_workers (status) where status in ('starting', 'running');
create index if not exists gaib_workers_session
  on public.gaib_workers (gaib_session_id, created_at desc);

-- Everything Gaib did through the app on somebody's behalf, and whether it worked.
create table if not exists public.gaib_worker_actions (
  id bigint generated always as identity primary key,
  worker_id uuid not null references public.gaib_workers(id) on delete cascade,
  user_id uuid not null,
  tool text not null,
  input jsonb,
  ok boolean not null,
  result_preview text,
  created_at timestamptz not null default now()
);

create index if not exists gaib_worker_actions_user
  on public.gaib_worker_actions (user_id, created_at desc);

-- Service role only. Nothing in a browser has any business reading tokens.
alter table public.gaib_workers enable row level security;
alter table public.gaib_worker_actions enable row level security;
