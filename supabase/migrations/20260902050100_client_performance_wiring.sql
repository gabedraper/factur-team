/*
 * Wiring, recorded. Applied against the live definitions rather than retyped,
 * so nothing in five kilobytes of scoring logic moves by accident.
 *
 *  - refresh_client_performance() rewritten to find replies with a window
 *    function. The first version used a correlated subquery per sent mail,
 *    which was O(n x m) over 294k activities and blew the statement timeout.
 *    Now ~6s behind a partial index, and it sets its own 10 minute timeout
 *    because it runs on a schedule rather than a request.
 *
 *  - DM involvement is null, not false, where there is no correspondence in the
 *    window at all. Scoring silence as zero dragged the average across the book
 *    to 19.9; gated properly it is 71.8 for active clients.
 *
 *  - get_client_health() now reads cp.performance_score in place of the two
 *    stage-text ratios. The column is still called engagement_score so the
 *    weights table and the return type do not have to move; the page labels it
 *    Client Performance.
 *
 *  - client_performance_by_client joins on the org_clients uuid the health
 *    function returns, so the page can show the five measures without widening
 *    that function's return type.
 *
 *  - snapshot_client_performance() writes the five into metric_snapshots
 *    monthly. Responsiveness and DM involvement read a rolling ~10 week window
 *    and cannot be recovered once it rolls.
 *
 * Schedules: refresh hourly at :50, snapshot 06:20 on the 1st.
 */
select 1;
