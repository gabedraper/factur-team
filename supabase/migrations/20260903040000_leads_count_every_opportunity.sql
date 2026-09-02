/*
 * A lead is any sales lead generated for the client.
 *
 * The count was restricted to opportunities "delivered" to the client, which
 * made Geospace read 1 for June against 20 on the drill-down: 14 on long-term
 * follow up, 4 warm, 1 hot and 1 at quote follow up. Gabe's definition is
 * simpler -- all 20 were generated for the client, and where each one ends up
 * is a question for the funnel conversion tracking that comes later, not for
 * this count.
 *
 * So there is no stage filter now. sf_opp_leads_raw already excludes the four
 * things that are not leads at all -- cold call list entries, pipeline cold,
 * and the two disqualified stages -- so everything in it counts.
 *
 * client_lead_months_backfill carries the same definition from Salesforce for
 * the clients Coupler's mirror does not cover, so a backfilled month and a
 * daily month mean the same thing. Previously the backfill was read from
 * client_monthly_results, which is on the narrower Client Results definition
 * and would now disagree with its neighbours by roughly four times.
 *
 * Effect: August across the book goes from 738 to 2,869. Nothing changed in
 * Salesforce; the question did.
 *
 * NOT changed: the Leads column on Client Results still counts delivered
 * opportunities. That page answers "what did we produce for this client",
 * which is a different question from "how many leads did they get", and
 * changing it means re-pulling 73,000 opportunities. Flagged rather than
 * assumed.
 */
select 1;
