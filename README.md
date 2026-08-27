# Factur Team

The internal site for Factur staff: training, sales leaderboards, and (soon)
lead timelines. One Next app, one Google sign-in, one database.

Live at **team.facturmfg.com**. Sign-in is restricted to `@bethefactur.com` and
`@facturmfg.com` Google accounts.

## Sections

| Path | What it is |
| --- | --- |
| `/learner`, `/instructor`, `/manager`, `/admin` | Training: courses, modules, lessons, certificates |
| `/leaderboard` | Course-completion board |
| `/scoreboard/{hustle-points,deals,retention}` | Sales leaderboards, from Salesforce |
| `/admin/weights` | Scoring weights behind the sales boards |
| `/talent/*` | Recruiting: people, companies, jobs, pipelines, placements |
| `/careers`, `/portal/{token}` | Public: the job board and the hiring-manager share links |

Note the two boards are different things: `/leaderboard` ranks training
progress, `/scoreboard` ranks selling.

## Talent

An applicant tracker and recruiting CRM, modelled on Loxo. Every table is
prefixed `tal_`. The idea it is built around: there is **one Person record**,
and being a candidate is something that happens to a person on a job rather
than a different kind of row. A `tal_candidates` row is the join of a person
and a job, and it is where the stage lives -- the same person can sit in three
pipelines at three different stages.

Three permissions gate it, granted in Settings -> Roles: `talent.view`,
`talent.recruit`, `talent.admin`. `Recruiter & People Operations` and
`App Administrator` hold them out of the box.

Two things worth knowing before changing anything here:

- **`moveCandidate` in `actions/talent-jobs.ts` is the only path that may
  change a stage.** A database trigger writes the history row, the action
  writes the timeline note, and reaching for `stage_id` directly skips both.
  Time-in-stage and stage-to-stage conversion are read from that history, not
  from the current board.
- **`tal_integrations` is the switch every outside service is read through.**
  A feature that needs Gmail, a people-data provider or the Claude API checks
  its row and renders `NotConnected` rather than failing quietly. No credential
  is ever stored there -- keys belong in environment variables. See
  `/settings/talent?tab=integrations` for what is and is not wired up.

The public routes (`/careers`, `/portal/{token}`) are deliberately absent from
`protectedPrefixes` in `middleware.ts`, and reach the database as `anon`
through five `security definer` functions and nothing else. A policy on
`tal_jobs` generous enough to serve the careers page would leak confidential
searches, which is why there isn't one.

## Running it

```bash
npm install
cp .env.local.example .env.local   # then fill in the keys
npm run dev                        # http://localhost:3001
```

Keys come from Supabase project `ripnymdxplmoflpwmqwl` (Settings -> API keys).
`SUPABASE_SERVICE_ROLE_KEY` wants a modern `sb_secret_...` key. Every
`localhost` sign-in address must also be listed under Authentication -> URL
Configuration, or Google will refuse to send you back.

## Access rules

One rule governs everything: `public.is_factur_user()` in the database, which
mirrors `lib/scoreboard/allowed-domains.ts` in the app. **Change both together.**

- Signing in with a non-Factur Google account produces a session but no
  profile, because `handle_new_user()` only creates one for allowed domains.
  Middleware treats "no profile" as the signal to sign out and redirect to
  `/unauthorized`.
- `lms_initial_roles` maps email to LMS role and is read at first sign-in. The
  admin Users screen writes to it.
- `handle_new_user()` also links the account to its `reps` row. Both jobs share
  one trigger because both apps wanted the name `on_auth_user_created`.

## Database

Migrations live in `supabase/migrations/` and target `ripnymdxplmoflpwmqwl`.

`ensure_staging_rls()` runs nightly from `nightly_maintenance()` and reasserts
the policies on the `sf_*_raw` Salesforce tables. Change those policies there as
well, or the nightly run will overwrite you.

`supabase/legacy-lms-project/` is the retired project's history, kept for
reference only. Do not apply it.
