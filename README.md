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

Note the two boards are different things: `/leaderboard` ranks training
progress, `/scoreboard` ranks selling.

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
