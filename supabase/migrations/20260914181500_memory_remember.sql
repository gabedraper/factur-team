-- Store a batch of passages, merging each one's audience with what is there.
create or replace function public.memory_remember(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  n integer;
begin
  with incoming as (
    select
      r->>'source'                        as source,
      r->>'source_id'                     as source_id,
      coalesce((r->>'chunk')::int, 0)     as chunk,
      r->>'title'                         as title,
      r->>'url'                           as url,
      r->>'author'                        as author,
      r->>'body'                          as body,
      coalesce(
        (select array_agg(lower(x)) from jsonb_array_elements_text(r->'audience') x),
        '{}'::text[]
      )                                   as audience,
      (r->>'occurred_at')::timestamptz    as occurred_at
    from jsonb_array_elements(p_rows) r
  )
  insert into public.memory_passages
    (source, source_id, chunk, title, url, author, body, audience, occurred_at)
  select source, source_id, chunk, title, url, author, body, audience, occurred_at
  from incoming
  on conflict (source, source_id, chunk) do update
    set title       = excluded.title,
        url         = excluded.url,
        author      = coalesce(excluded.author, memory_passages.author),
        body        = excluded.body,
        occurred_at = coalesce(excluded.occurred_at, memory_passages.occurred_at),
        audience    = (
          select array_agg(distinct a)
          from unnest(memory_passages.audience || excluded.audience) a
        ),
        updated_at  = now();
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.memory_remember(jsonb) from public;
grant execute on function public.memory_remember(jsonb) to service_role;
