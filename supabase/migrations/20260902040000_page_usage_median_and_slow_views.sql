/*
 * Two more numbers, so p95 can be read honestly.
 *
 * Sorting by p95 puts the noisiest rows first. At ten views the 95th
 * percentile is very nearly the slowest single observation, so a page three
 * people opened once, one of which was a cold start, outranks a page fifteen
 * people wait four seconds for every day. Today the top of the table was
 * /scoreboard/hustle-points/[id]/activities at 18.2s p95 -- with a median of
 * 1.4s across ten views.
 *
 *   median_ms   what a typical visit costs. Read next to p95, the pair says
 *               whether a page is uniformly slow or occasionally slow.
 *   slow_views  visits over three seconds. Volume-weighted by construction,
 *               which is what the ordering should be: twenty-four people
 *               waiting is a bigger problem than one person waiting longer.
 */
drop function if exists page_usage_stats(integer);

create function page_usage_stats(p_days integer default 30)
returns table (
  path text,
  views bigint,
  people bigint,
  route_ms integer,
  load_ms integer,
  median_ms integer,
  p95_ms integer,
  slow_views bigint,
  last_seen timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    v.path,
    count(*) as views,
    count(distinct v.member_id) as people,
    -- Arrivals and moves are not comparable, so they are averaged apart.
    round(avg(v.duration_ms) filter (where v.kind = 'route'))::integer as route_ms,
    round(avg(v.duration_ms) filter (where v.kind = 'load'))::integer as load_ms,
    percentile_cont(0.5) within group (order by v.duration_ms)::integer as median_ms,
    -- The slow tail, which is the thing people actually notice.
    percentile_cont(0.95) within group (order by v.duration_ms)::integer as p95_ms,
    -- Three seconds is the threshold the table already paints red.
    count(*) filter (where v.duration_ms >= 3000) as slow_views,
    max(v.occurred_at) as last_seen
  from page_views v
  where v.occurred_at >= now() - make_interval(days => p_days)
  group by v.path;
$$;

comment on function page_usage_stats(integer) is
  'Per-page view counts and timings. security invoker, so the caller''s RLS on page_views decides what they may read.';
