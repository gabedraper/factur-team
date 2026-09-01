/*
 * Keep the planner's picture of the Coupler tables honest.
 *
 * Coupler drops and recreates its tables on every sync. Two jobs already exist
 * to repair what that wipes -- ensure_staging_rls() and seal_exposed_tables(),
 * both every ten minutes -- but nothing put back the two things a big read
 * depends on: current statistics, and a visibility map fresh enough for an
 * index-only scan to stay index-only.
 *
 * Without them the Client Health query degrades quietly. On 2026-09-01 it
 * degraded past the 8s statement_timeout for `authenticated` and the page
 * started returning 500s: raw_activities had not been analysed in over a day,
 * its heaviest scan was doing 17,529 heap fetches, and that one CTE alone took
 * 1.9s of a budget the whole query has to fit inside. A vacuum halved both --
 * 8,036 fetches, 0.94s -- and the full function came back to 2.2s.
 *
 * Hourly rather than nightly because Coupler syncs through the day, and this is
 * cheap at these sizes (287k and 90k rows). Scheduled at :45 to keep out of the
 * way of refresh_client_activity_counts at :35 and enrol_for_role_training at
 * :50.
 *
 * VACUUM cannot run inside a function -- it is disallowed in a transaction
 * block -- so this is a cron command in its own right rather than another line
 * in nightly_maintenance().
 */
select cron.schedule(
  'vacuum-coupler-tables',
  '45 * * * *',
  $$vacuum (analyze) public.raw_activities, public.sf_opp_leads_raw, public.sf_opportunities_raw, public.sf_clients_raw$$
);
