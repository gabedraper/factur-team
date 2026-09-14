-- Company memory: one searchable index of everything Factur has written down.
--
-- Gaib used to reach each source live and one at a time: the asker's own
-- mailbox, their own Drive, the handbook. This is the other approach -- every
-- document, chat message, record and note broken into passages and kept in
-- one table, so one search finds the answer wherever it was said.
--
-- Who may read a passage travels with it. `audience` is the list of staff
-- addresses allowed to see it, or '*' for the whole company. A Drive file is
-- readable by whoever it was fetched as; a chat message by whoever is in the
-- space; Salesforce and ClickUp by everyone. The search filters on the asker
-- before ranking, so nothing outside their own reach is ever scored.
--
-- Search is full-text today. `embedding` is here for search by meaning once an
-- embedding key exists; until then it stays null and the index is unused.

create extension if not exists vector with schema extensions;

create table if not exists public.memory_passages (
  id bigint generated always as identity primary key,
  -- drive, chat, email, salesforce, clickup, smartsheet
  source text not null,
  -- The source's own id for the document, thread or record.
  source_id text not null,
  chunk int not null default 0,
  title text,
  url text,
  -- Who wrote it, where that is known.
  author text,
  body text not null,
  tsv tsvector generated always as (to_tsvector('english', coalesce(title, '') || ' ' || body)) stored,
  embedding extensions.vector(1024),
  audience text[] not null default '{}',
  occurred_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (source, source_id, chunk)
);

create index if not exists memory_passages_tsv on public.memory_passages using gin (tsv);
create index if not exists memory_passages_audience on public.memory_passages using gin (audience);
create index if not exists memory_passages_source on public.memory_passages (source, occurred_at desc);

-- Where each feeder has got to, per source and per account it reads as.
create table if not exists public.memory_sync (
  source text not null,
  account text not null,
  cursor text,
  last_run_at timestamptz,
  last_error text,
  passages int not null default 0,
  primary key (source, account)
);

alter table public.memory_passages enable row level security;
alter table public.memory_sync enable row level security;

/**
 * Search the memory as one person.
 *
 * SECURITY DEFINER because the table has no policies of its own: every read
 * comes through here with the reader's address, and the audience filter is
 * applied before anything is ranked. In a room `p_company_only` narrows it
 * to passages the whole company may see.
 */
create or replace function public.memory_search(
  p_query text,
  p_reader text,
  p_limit int default 8,
  p_sources text[] default null,
  p_company_only boolean default false
)
returns table (
  source text,
  title text,
  url text,
  author text,
  passage text,
  occurred_at timestamptz,
  rank real
)
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  with q as (
    select websearch_to_tsquery('english', coalesce(p_query, '')) as tsq
  )
  select p.source, p.title, p.url, p.author, p.body, p.occurred_at,
         ts_rank_cd(p.tsv, q.tsq) as rank
  from public.memory_passages p, q
  where q.tsq is not null
    and q.tsq <> ''::tsquery
    and p.tsv @@ q.tsq
    and (p_sources is null or p.source = any(p_sources))
    and (
      '*' = any(p.audience)
      or (not p_company_only and lower(p_reader) = any(p.audience))
    )
  order by rank desc, p.occurred_at desc nulls last
  limit greatest(1, least(coalesce(p_limit, 8), 30));
$$;

revoke all on function public.memory_search(text, text, int, text[], boolean) from public;
grant execute on function public.memory_search(text, text, int, text[], boolean) to service_role;

-- Every ten minutes, a few accounts at a time, so the first pull spreads out
-- over hours rather than one request that never finishes.
select cron.schedule(
  'memory-sync',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://team.facturmfg.com/api/memory/sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-gaib-secret', (select value from public.gaib_secrets where name = 'deliver')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 290000
  );
  $$
);
