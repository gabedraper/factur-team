/*
 * How many companies each client is working, per stage, counted ahead of time.
 *
 * The landing screen wants one number per band per client. Counting that live
 * takes 12.8 seconds -- an account's band is the furthest any of its pursuits
 * has reached, so the roll-up has to touch all 726,000 opportunity rows and
 * fold them twice, once to the company and again to the client. The API role's
 * statement timeout is 8 seconds, so live counting does not merely run slow, it
 * fails outright.
 *
 * So it is computed on a schedule and read as a table. Fifteen minutes of
 * staleness against a sync that lands every three is a fair trade for a screen
 * that opens instantly: nobody watches a stage count tick over, they scan it to
 * decide where to spend the morning.
 *
 * No policies on the table on purpose. Nothing reads it directly -- it is
 * reached only through pipeline_my_clients(), which is security definer and
 * scopes to my_client_ids() the same way every other pipeline read does. RLS on
 * with no policy means a direct select returns nothing, which is what should
 * happen to a table that has no business being queried from the browser.
 */

create table if not exists public.pipeline_client_stage_counts (
  client_id     uuid not null references public.org_clients(id) on delete cascade,
  target_stage  text not null,
  companies     bigint not null,
  refreshed_at  timestamptz not null default now(),
  primary key (client_id, target_stage)
);

alter table public.pipeline_client_stage_counts enable row level security;
revoke all on table public.pipeline_client_stage_counts from public, anon, authenticated;

/*
 * The inverse of target_account_stage_rank(). The roll-up carries the rank
 * because max() over an integer is cheap and max() over a band name is not, so
 * the name has to be recovered at the end.
 */
create or replace function public.target_account_stage_by_rank(p_rank integer)
returns text
language sql
immutable
parallel safe
as $function$
  select case p_rank
    when 7 then 'Closing'
    when 6 then 'Opportunity Found'
    when 5 then 'Qualifying'
    when 4 then 'Long-Term Follow Up'
    when 3 then 'Engaged'
    when 2 then 'Engaging'
    when 1 then 'Cold Target'
    else 'Closed'
  end;
$function$;

create or replace function public.refresh_pipeline_client_stage_counts()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n integer;
begin
  create temp table _stage_counts on commit drop as
  with acct as (
    select o.client_id,
           o.account_id,
           max(target_account_stage_rank(target_account_stage(o.stage))) as rnk
    from public.opportunities o
    where o.account_id is not null
    group by 1, 2
  )
  select client_id,
         target_account_stage_by_rank(rnk) as target_stage,
         count(*)::bigint                  as companies
  from acct
  group by 1, 2;

  /* One transaction, so readers see the old counts until the new ones land
     rather than an empty table mid-refresh. */
  delete from public.pipeline_client_stage_counts;
  insert into public.pipeline_client_stage_counts (client_id, target_stage, companies, refreshed_at)
  select client_id, target_stage, companies, now() from _stage_counts;
  get diagnostics n = row_count;

  return n;
end;
$function$;

comment on function public.refresh_pipeline_client_stage_counts() is
  'Recounts target companies per client per stage. Too slow to run inside a request; scheduled instead.';

revoke all on function public.refresh_pipeline_client_stage_counts() from public, anon, authenticated;

/*
 * Quarter past and quarter to, away from the top of the hour where the client
 * health and lead-count jobs already cluster.
 */
select cron.schedule(
  'pipeline-stage-counts',
  '13,43 * * * *',
  $cron$
  select public.run_once(
    'pipeline-stage-counts',
    'select public.refresh_pipeline_client_stage_counts()'
  );
  $cron$
);
