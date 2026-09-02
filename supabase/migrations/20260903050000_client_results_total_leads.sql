/*
 * Client Results counts every lead generated for a client.
 *
 * The Leads column counted only opportunities delivered to the client, about
 * a sixth of the truth. Same correction the Lead Flow card got: a lead is any
 * sales lead generated for the client, and where each one ends up is a
 * question for the stage-to-stage conversion tracking that comes later.
 *
 * Applied as a delta by scripts/backfill-total-leads.py rather than a rebuild,
 * so appointments, quotes and POs are untouched -- they still mean what they
 * meant, and nothing Gabe has already checked moved underneath him.
 *
 *   leads   75,182 -> 443,271
 *   quotes  12,454 (unchanged)
 *   POs      5,044 (unchanged)
 *   appts    2,540 (unchanged)
 *
 * Still excluded, and each one a single line to reverse:
 *
 *   Cold Call List, Pipeline Cold, DQ Company, DQ Contact -- list entries and
 *   disqualifications, matching what sf_opp_leads_raw holds.
 *
 *   Cold Outreach (4,741) -- arrives in round bulk chunks, two clients with
 *   exactly 1,000 in one month. That is a list being loaded, not leads being
 *   generated, and counting it would put false spikes on a few clients.
 *
 *   Eight rare stages totalling 271 rows over eight years. 0.06%.
 *
 * Extra leads for a client-month with no existing row are attributed to the
 * service that did most for that client, the same rule the quote and PO
 * evidence overlays use.
 */
select 1;
