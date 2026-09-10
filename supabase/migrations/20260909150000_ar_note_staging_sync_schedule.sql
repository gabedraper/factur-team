/*
 * Record every Coupler landing.
 *
 * Piggybacks on the job that already reapplies staging RLS every ten minutes,
 * because both exist for the same reason: Coupler drops and recreates these
 * tables, and something has to notice. Without this the ladder cannot tell a
 * quiet Monday from a pipeline that stopped on Friday, and it blocks every
 * send rather than risk chasing somebody who has paid.
 */
select cron.alter_job(
  5,
  command := 'select public.ensure_staging_rls(); select public.note_staging_sync();'
);
