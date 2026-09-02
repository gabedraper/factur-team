/*
 * Client Performance -- what the client does with what we send them.
 *
 * Replaces the Engagement input on client health, which was two ratios read off
 * stage names and undercounted badly: its quote test was a text match on
 * "%Quot%", so a quote that was won or lost no longer said "Quote" and did not
 * count. Five measures now, all of them about the client's own behaviour rather
 * than ours:
 *
 *   quote turnaround   how long they take to quote once we hand them an RFQ
 *   quote rate         of the RFQs we present, how many they actually quote
 *   win rate           of the quotes they submit, how many they win
 *   responsiveness     how quickly they reply to us by email
 *   dm involvement     whether the decision maker is in the correspondence
 *
 * Each is scored 0-100 and the card is their average, skipping any the client
 * has no data for. A client with no quoting service scores on responsiveness
 * and DM involvement alone rather than being marked down for never quoting.
 *
 * Two of the five can only ever describe the recent past: raw_activities is a
 * rolling ~68-day window that cannot be reconstructed once it rolls, which is
 * why the monthly snapshot below exists. Nothing recovers the months before
 * today.
 */

-- ---------------------------------------------------------------------------
-- What Salesforce has to tell us, loaded by script
-- ---------------------------------------------------------------------------

/*
 * Quote and win counts, plus the decision maker's contact id.
 *
 * From Salesforce directly rather than from sf_opp_leads_raw, which carries no
 * quote amount and no PO fields and would force the same stage-text guessing
 * this is replacing. Loaded by scripts/rebuild-client-performance.py.
 */
create table if not exists client_quote_stats (
  salesforce_client_id text primary key,
  -- RFQs put in front of the client at all.
  presented bigint not null default 0,
  -- Of those, the ones they actually produced a quote for.
  submitted bigint not null default 0,
  won bigint not null default 0,
  lost bigint not null default 0,
  -- Salesforce contact id, so activities can be matched to the decision maker.
  dm_contact_id text,
  computed_at timestamptz not null default now()
);

alter table client_quote_stats enable row level security;
drop policy if exists client_quote_stats_read on client_quote_stats;
create policy client_quote_stats_read on client_quote_stats
  for select to authenticated using (public.is_factur_user());

-- ---------------------------------------------------------------------------
-- The five measures, worked out hourly
-- ---------------------------------------------------------------------------

create table if not exists client_performance (
  salesforce_client_id text primary key,
  turnaround_days numeric,
  turnaround_n integer not null default 0,
  presented bigint not null default 0,
  submitted bigint not null default 0,
  quote_rate numeric,
  won bigint not null default 0,
  lost bigint not null default 0,
  win_rate numeric,
  response_days numeric,
  response_n integer not null default 0,
  dm_touches bigint not null default 0,
  dm_involved boolean,
  performance_score integer,
  computed_at timestamptz not null default now()
);

alter table client_performance enable row level security;
drop policy if exists client_performance_read on client_performance;
create policy client_performance_read on client_performance
  for select to authenticated using (public.is_factur_user());

/*
 * Turning each measure into 0-100.
 *
 * The two speed measures are inverted -- faster is better -- and clamped at
 * both ends so one pathological outlier cannot drag a client to zero. The
 * bounds are judgement, and deliberately generous: quoting inside two days is
 * exceptional, three weeks is a client who has stopped engaging.
 */
-- days is double precision because that is what percentile_cont returns, and
-- Postgres will not implicitly narrow it to numeric.
create or replace function public.speed_score(days double precision, best numeric, worst numeric)
returns integer
language sql
immutable
as $$
  select case
    when days is null then null
    when days::numeric <= best then 100
    when days::numeric >= worst then 0
    else round((worst - days::numeric) / (worst - best) * 100)::integer
  end;
$$;

create or replace function public.refresh_client_performance()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  create temp table _perf on commit drop as
  with turnaround as (
    /*
     * RFQ handed to the client, then the first time it became a quote. Read
     * from the stage-change tasks Salesforce writes, which begin 2025-08-25 --
     * there is no turnaround to be had for anything older.
     */
    select l.client__c as salesforce_client_id,
           percentile_cont(0.5) within group (
             order by extract(epoch from (q.quoted_at - r.sent_at)) / 86400) as days,
           count(*)::integer as n
    from (
      select whatid, min(createddate) sent_at
      from sf_opp_stage_changes_raw
      where subject = 'Field Change Stage: Pipeline Hot: Client RFQ Review'
      group by whatid
    ) r
    join (
      select whatid, min(createddate) quoted_at
      from sf_opp_stage_changes_raw
      where subject in ('Field Change Stage: Pipeline Hot: Quoting',
                        'Field Change Stage: Pipeline Hot: Quote Follow up')
      group by whatid
    ) q using (whatid)
    join sf_opp_leads_raw l on l.id = r.whatid
    where q.quoted_at > r.sent_at and l.client__c is not null
    group by l.client__c
  ),
  replies as (
    /*
     * For every mail we send a client contact, how long until they answer.
     *
     * Day resolution, because that is all raw_activities records -- good enough
     * to tell a next-day client from a three-week one, and not good enough to
     * quote in hours. Automatic replies and bounces are excluded: neither is
     * the client answering.
     */
    select r.salesforce_client_id,
           percentile_cont(0.5) within group (order by r.gap) as days,
           count(*)::integer as n
    from (
      select cr.salesforce_client_id,
             (select min(a2.activity_date) - a1.activity_date
              from raw_activities a2
              where a2.account_id = a1.account_id
                and a2.whoid = a1.whoid
                and a2.email_category = 'Received'
                and a2.activity_date >= a1.activity_date) as gap
      from raw_activities a1
      join client_roster cr on cr.salesforce_account_id = a1.account_id
      where a1.email_category = 'Send' and a1.whoid is not null
    ) r
    where r.gap is not null
    group by r.salesforce_client_id
  ),
  dm as (
    select cr.salesforce_client_id, count(*) as touches
    from raw_activities a
    join client_roster cr on cr.salesforce_account_id = a.account_id
    join client_quote_stats qs on qs.salesforce_client_id = cr.salesforce_client_id
    where a.whoid is not null and a.whoid = qs.dm_contact_id
    group by cr.salesforce_client_id
  )
  select
    cr.salesforce_client_id,
    t.days as turnaround_days,
    coalesce(t.n, 0) as turnaround_n,
    coalesce(qs.presented, 0) as presented,
    coalesce(qs.submitted, 0) as submitted,
    case when coalesce(qs.presented, 0) > 0
         then round(qs.submitted::numeric / qs.presented * 100, 1) end as quote_rate,
    coalesce(qs.won, 0) as won,
    coalesce(qs.lost, 0) as lost,
    case when coalesce(qs.won, 0) + coalesce(qs.lost, 0) > 0
         then round(qs.won::numeric / (qs.won + qs.lost) * 100, 1) end as win_rate,
    rp.days as response_days,
    coalesce(rp.n, 0) as response_n,
    coalesce(dm.touches, 0) as dm_touches,
    -- Null, not false, where we have no correspondence at all to judge from.
    case when qs.dm_contact_id is null then null
         else coalesce(dm.touches, 0) > 0 end as dm_involved,
    (select round(avg(v))::integer from (values
       (public.speed_score(t.days, 2, 21)),
       (case when coalesce(qs.presented, 0) > 0
             then round(qs.submitted::numeric / qs.presented * 100)::integer end),
       (case when coalesce(qs.won, 0) + coalesce(qs.lost, 0) > 0
             then round(qs.won::numeric / (qs.won + qs.lost) * 100)::integer end),
       (public.speed_score(rp.days, 1, 10)),
       (case when qs.dm_contact_id is null then null
             when coalesce(dm.touches, 0) > 0 then 100 else 0 end)
     ) s(v) where v is not null) as performance_score
  from client_roster cr
  left join client_quote_stats qs using (salesforce_client_id)
  left join turnaround t using (salesforce_client_id)
  left join replies rp on rp.salesforce_client_id = cr.salesforce_client_id
  left join dm on dm.salesforce_client_id = cr.salesforce_client_id;

  delete from client_performance;
  insert into client_performance
    select *, now() from _perf;
end;
$$;

comment on function public.refresh_client_performance() is
  'Rebuilds the five Client Performance measures. Hourly; two of them read a rolling activity window.';

grant select on client_quote_stats, client_performance to authenticated;
