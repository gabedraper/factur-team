/*
 * The activity counts client health needs, worked out once an hour instead of
 * on every page load.
 *
 * This is the third time /clients/health has gone over the statement timeout,
 * and each time the immediate cause was the same: a 230,000-row index-only
 * scan of raw_activities, and a visibility map stale enough to send thousands
 * of those rows to the heap. Vacuuming fixes it for a day or two and then the
 * inserts catch up again -- the table is written to continuously, so there is
 * always a window, and tightening the autovacuum threshold only shortens it.
 *
 * Chasing the vacuum was treating the symptom. The page does not need a live
 * count: these are rolling thirty and sixty day totals, and an hour of lag is
 * invisible in them. Twenty thousand precomputed rows read instead of a
 * quarter of a million scanned takes the cost from seconds to milliseconds,
 * and takes it off the vacuum's timing entirely.
 */

create table if not exists client_activity_counts (
  account_id text primary key,
  recent bigint not null,
  prior bigint not null,
  computed_at timestamptz not null default now()
);

alter table client_activity_counts enable row level security;

drop policy if exists client_activity_counts_read on client_activity_counts;
create policy client_activity_counts_read on client_activity_counts
  for select to authenticated using (public.is_factur_user());

create or replace function public.refresh_client_activity_counts()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  /*
   * Rebuilt whole rather than merged. It is twenty thousand rows over a
   * sixty-day window that slides every day, so most of them change anyway,
   * and a delete-and-insert inside one transaction is both simpler and
   * cheaper than working out which counts moved.
   */
  create temp table _counts on commit drop as
    select account_id,
           count(*) filter (where activity_date >= current_date - 30) as recent,
           count(*) filter (where activity_date >= current_date - 60
                              and activity_date <  current_date - 30) as prior
    from raw_activities
    where activity_date >= current_date - 60 and account_id is not null
    group by account_id;

  delete from client_activity_counts;
  insert into client_activity_counts (account_id, recent, prior, computed_at)
    select account_id, recent, prior, now() from _counts;
end;
$$;

comment on function public.refresh_client_activity_counts() is
  'Rebuilds the 30/60-day activity counts client health reads. Hourly; an hour of lag is invisible in a rolling monthly total.';

select public.refresh_client_activity_counts();
