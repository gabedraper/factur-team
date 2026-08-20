# Opportunity Timelines — handoff

The data pipeline is **done and verified**. What remains is app code: port the
classifier, build the route. Written 2026-08-19.

## What already works

Two Coupler sources on the existing dataflow `32e79f15-7a56-4018-9493-5fe58138e8d4`
("Factur Scoreboard — Salesforce to Supabase"), running on its hourly schedule:

| Source name | Table | Rows |
|---|---|---|
| Opportunity timelines — leads | `public.sf_opp_leads_raw` | 5,240 |
| Opportunity timelines — activity | `public.sf_opp_tasks_raw` | 96,641 |

Both are scoped to a **30-day rolling window**. Leads additionally require
`LastActivityDate != null`, which drops bulk-created records that were never
worked (23,475 -> 5,240). `sf_opp_tasks_raw` is filtered with
`What.Type = 'Opportunity'`, so every row has a `whatid` that joins to a lead.

Why these are separate tables rather than extra columns on the scoreboard's
`sf_tasks_raw`: that source filters `WHERE ActivityDate = LAST_N_DAYS:7`, and
stage-change Tasks carry a **null ActivityDate** — so it can never see them.
Filtering on `CreatedDate` instead is what makes the stage history available.
Changing the scoreboard's own source would have altered its numbers.

Columns that the old sync lacked and this one has: `createddate` (a **timestamp**,
so sub-day precision survives), `whatid`, `calltype`, `stagename`.

## Where the logic lives

`~/lead-timeline` (repo `gabedraper/opportunity-timelines`, private) is the
working prototype: one self-contained `index.html` plus `build.py`.

- `build.py` holds the product: `classify()` maps a Task subject onto an event
  kind, `stage_bucket()` / `stage_spans()` turn stage-change Tasks into the
  coloured lane segments, and the metrics block computes first-touch, reply
  time, and the week-one counters. These rules are tested against real data --
  port them as they are.
- `index.html`'s `<script>` is the renderer: vanilla DOM + SVG, keyed entirely
  off `DATA.leads`. It needs the same JSON shape `build.py` emits, which is
  documented in that repo's README.

## Steps left

1. Port `classify()`, `stage_bucket()`, `stage_spans()` and the metrics into a
   server module that reads the two tables above and returns the `leads` shape.
2. Add `app/(dashboard)/timelines/`, mirroring the `/scoreboard` port: server
   component queries, client component renders the lanes.
3. Delete `build.py` and the static file once the route reads live data.

## Watch out for

- **RLS.** Coupler drops and recreates each `sf_*_raw` table on every load,
  taking RLS with it. `ensure_staging_rls()` restores it and now includes both
  new tables (migration `20260819234500`). But the dataflow runs hourly 9-18
  while `nightly_maintenance()` runs nightly, so these tables sit unprotected
  for much of the working day. Worth calling `ensure_staging_rls()` at the end
  of each load rather than once a night.
- **The 30-day window bounds the product.** A lead older than 30 days is not in
  `sf_opp_leads_raw` at all. That suits the two goal views (first 24h, first
  week); it does not suit "show me this lead's whole history".
- **The data is customer PII** -- named contacts, their employers, client names,
  and real email subject lines. It belongs behind the app's existing login and
  must never reach a public route.
