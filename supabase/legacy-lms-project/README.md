# Retired: the old LMS Supabase project

These are the migrations for Supabase project `esadbpqlskiwjijhghys`, which the
LMS used before it moved onto the shared project. They are kept for reference
only -- do not apply them anywhere.

Two things they get wrong about the world as it now is:

- `002_role_courses.sql` was never actually applied to that database. The
  learner dashboard reads `role_courses` and falls back to an empty list on
  error, so every learner saw an empty page. Assume this project's live schema
  drifted from these files in other ways too.
- `004` installs a trigger named `on_auth_user_created` and drops any existing
  trigger of that name first. On the shared project that name is also used for
  linking a sign-in to its sales rep, so applying this file there would
  silently break rep linking.

The live equivalents live in `../migrations/`.
