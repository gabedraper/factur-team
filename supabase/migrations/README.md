# Database migrations

The live schema for this app lives in the Supabase project
`ripnymdxplmoflpwmqwl`. Migrations here are named to match the versions
recorded in `supabase_migrations.schema_migrations`, so the CLI treats them as
already applied.

Only the 2026-08-19 security migrations are checked in so far. The 23 earlier
migrations (2026-08-10 and 2026-08-11) exist in the remote project but not yet
in this repo -- pull them down with:

```
supabase link --project-ref ripnymdxplmoflpwmqwl
supabase db pull
```

## Access rules, in short

- `is_factur_user()` is the single source of truth: the signed-in email must be
  on `facturmfg.com` or `bethefactur.com`. It mirrors `src/lib/allowed-domains.ts`.
  **Change both together.**
- The six `sf_*_raw` staging tables are readable only by Factur users, and
  writable by nobody through the API -- the nightly pipeline writes via
  credentials that bypass RLS.
- The leaderboard views and `get_hustle_leaderboard_by_source()` stay
  `SECURITY DEFINER` on purpose: they aggregate across all reps, while
  `raw_activities` is row-restricted to the viewer's own rows. They carry the
  domain gate inline instead.
- `ensure_staging_rls()` runs nightly from `nightly_maintenance()` and reasserts
  the staging-table policies. Any change to those policies must be made there
  too, or it will be overwritten within a day.

## Org structure

`org_services` → `org_teams` → `org_roles`, with `org_members` assigned via
`org_assignments`, and permissions on roles as capability keys checked by
`has_permission()`.

Three things about it that are easy to get wrong:

- **Allocation is not permission.** `org_assignments.allocation` records that
  someone is 60% OBDM and 40% OSDR. It weights targets and comparisons only —
  permissions are the union of someone's roles, because you cannot grant 40% of
  a page. A deferred constraint trigger refuses allocations summing past 100
  across service roles; manager and app-admin carry no service and are excluded,
  since they describe visibility rather than how someone spends their week.
- **Teams have two shapes.** `kind = 'pod'` is people working a group of clients
  together; `kind = 'group'` is an umbrella over people who work individually.
  The seeded one-per-service rows are groups.
- **Coverage is separate from membership.** `org_client_coverage` says who
  covers a client — a pod or an individual, never both. `client_id` is the
  Salesforce `Client__c` id, the same value `Opportunity.Client__c` carries, so
  it joins straight to timeline and scoreboard data. Query
  `org_client_coverage_people` rather than the base table; it resolves pods to
  their members.
