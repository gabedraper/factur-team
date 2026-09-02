/*
 * Activity per client per month, and a score that ranks like with like.
 *
 * The card showed one number and a comparison to last month, scored
 * min(100, recent / prior * 75). That is momentum, and it misbehaves at both
 * ends: a client going from 2 activities to 4 scored 100, while one going from
 * 200 to 190 scored 71. It rewarded noise on quiet accounts and punished steady
 * heavy ones, and it never answered the question anyone actually has, which is
 * whether a client is getting enough attention.
 *
 * The score is now a percentile rank of average monthly activity, computed
 * within the client's own service. Ranking OP against OP and OSDR against OSDR
 * matters because the services do not involve comparable amounts of work.
 *
 * Services that do not run on activity at all -- LG, Precision Marketing,
 * Website Maintenance, RG, Sales -- are excluded rather than scored badly.
 * Their clients get no activity score and an empty card, which is honest: we
 * are not measuring their activity because activity is not what they buy.
 *
 * HISTORY. raw_activities is an accumulating archive: refresh_raw_activities()
 * upserts and never deletes, so it holds everything it has ever seen from
 * Coupler's rolling window -- about ten weeks today, growing daily. Six months
 * of history will exist here in about three and a half months without anyone
 * doing anything. Nothing is backfilled; the card shows the months it has.
 */

create table if not exists client_activity_months (
  salesforce_client_id text not null
    references client_roster (salesforce_client_id) on delete cascade,
  month_start date not null,
  activities bigint not null,
  computed_at timestamptz not null default now(),
  primary key (salesforce_client_id, month_start)
);

alter table client_activity_months enable row level security;
drop policy if exists client_activity_months_read on client_activity_months;
create policy client_activity_months_read on client_activity_months
  for select to authenticated using (public.is_factur_user());

create table if not exists client_activity_rank (
  salesforce_client_id text primary key
    references client_roster (salesforce_client_id) on delete cascade,
  -- Null for a service whose clients are not measured on activity.
  service_group text,
  months_counted integer not null default 0,
  avg_per_month numeric,
  activity_score integer,
  computed_at timestamptz not null default now()
);

alter table client_activity_rank enable row level security;
drop policy if exists client_activity_rank_read on client_activity_rank;
create policy client_activity_rank_read on client_activity_rank
  for select to authenticated using (public.is_factur_user());

/*
 * Which clients are compared with which.
 *
 * SMB and Constructur variants fold into their parent, as they already do in
 * the results loader. Null means the client is not measured on activity at all.
 */
create or replace function public.activity_service_group(service text)
returns text
language sql
immutable
as $$
  select case
    when service in ('OP', 'OBDM', 'SMB - OBDM', 'Constructur - OBDM') then 'OP'
    when service in ('OSDR', 'SMB - OSDR', 'Constructur - OSDR')       then 'OSDR'
    -- No service on record is a data gap, not a statement that they get no
    -- attention, so they are ranked among themselves rather than dropped.
    when service is null then 'Unspecified'
    else null
  end;
$$;

create or replace function public.refresh_client_activity_months()
returns void
language plpgsql
security definer
set search_path = public
set statement_timeout = '10min'
as $fn$
begin
  create temp table _months on commit drop as
  select cr.salesforce_client_id,
         date_trunc('month', a.activity_date)::date as month_start,
         count(*) as activities
  from raw_activities a
  join client_roster cr on cr.salesforce_account_id = a.account_id
  where a.activity_date >= (date_trunc('month', current_date) - interval '5 months')::date
  group by 1, 2;

  delete from client_activity_months;
  insert into client_activity_months (salesforce_client_id, month_start, activities, computed_at)
    select salesforce_client_id, month_start, activities, now() from _months;

  /*
   * The current month is excluded from the average: it is part-finished and
   * would drag every client down by however much of it is left.
   */
  create temp table _rank on commit drop as
  with per_client as (
    select m.salesforce_client_id,
           public.activity_service_group(cr.primary_service) as service_group,
           count(*)::integer as months_counted,
           round(avg(m.activities), 1) as avg_per_month
    from client_activity_months m
    join client_roster cr using (salesforce_client_id)
    where m.month_start < date_trunc('month', current_date)::date
    group by 1, 2
  )
  select salesforce_client_id, service_group, months_counted, avg_per_month,
         case
           when service_group is null then null
           /*
            * A percentile needs something to be a percentile of. Under five
            * clients in a group the number would say more about the group's
            * size than the client, so it is left blank.
            */
           when count(*) over (partition by service_group) < 5 then null
           else round(percent_rank() over (
                  partition by service_group order by avg_per_month) * 100)::integer
         end as activity_score
  from per_client;

  delete from client_activity_rank;
  insert into client_activity_rank
    (salesforce_client_id, service_group, months_counted, avg_per_month, activity_score, computed_at)
    select salesforce_client_id, service_group, months_counted, avg_per_month, activity_score, now()
    from _rank;
end;
$fn$;

comment on function public.refresh_client_activity_months() is
  'Activity per client per month over the last six, and a percentile rank within the client''s service.';

select public.refresh_client_activity_months();

select cron.unschedule('client-activity-months')
where exists (select 1 from cron.job where jobname = 'client-activity-months');

-- Hourly at :55, after the activity counts at :35 have refreshed raw_activities.
select cron.schedule(
  'client-activity-months',
  '55 * * * *',
  $cron$select public.refresh_client_activity_months();$cron$
);

-- The health function returns the org_clients uuid; the months are keyed by the
-- Salesforce id. Same join the performance card needed.
create or replace view public.client_activity_months_by_client
with (security_invoker = true) as
select oc.id as client_id, m.month_start, m.activities
from public.client_activity_months m
join public.org_clients oc on oc.salesforce_client_id = m.salesforce_client_id;

grant select on public.client_activity_months_by_client to authenticated;
