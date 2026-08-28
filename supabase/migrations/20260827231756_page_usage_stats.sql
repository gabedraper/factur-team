-- Page timings, counted in the database rather than in the page.
--
-- The first version pulled every recorded view into the app and averaged them
-- there, with a hundred-thousand row ceiling to stop it getting out of hand.
-- At roughly a hundred thousand views a month that ceiling was about a month
-- away from being reached, and the failure would have been silent: a report
-- that quietly described three weeks while saying it described four.

create or replace function page_usage_stats(p_days integer default 30)
returns table (
  path text,
  views bigint,
  people bigint,
  route_ms integer,
  load_ms integer,
  p95_ms integer,
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
    -- The slow tail, which is the thing people actually notice.
    percentile_cont(0.95) within group (order by v.duration_ms)::integer as p95_ms,
    max(v.occurred_at) as last_seen
  from page_views v
  where v.occurred_at >= now() - make_interval(days => p_days)
  group by v.path;
$$;

comment on function page_usage_stats(integer) is
  'Per-page view counts and timings. security invoker, so the caller''s RLS on page_views decides what they may read.';
