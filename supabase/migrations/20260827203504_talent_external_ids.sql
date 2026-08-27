/*
 * Where a record came from, when it came from somewhere else.
 *
 * A migration out of another system has to be re-runnable: it will be stopped
 * by a rate limit, a timeout or a bad row, and the fix is always to run it
 * again. Without the source id on the row there is no way to tell an update
 * from a duplicate, and the second run doubles the database.
 *
 * Deliberately a generic pair rather than a `loxo_id` column -- tal_activities
 * already carries exactly this shape, and the next import will not be Loxo.
 * Plain unique constraints, not partial indexes, so they can be used as an
 * ON CONFLICT target. Postgres treats NULLs as distinct, so the hand-typed
 * rows that have no source id are unaffected.
 */
do $$
declare t text;
begin
  foreach t in array array[
    'tal_people', 'tal_companies', 'tal_jobs', 'tal_candidates',
    'tal_deals', 'tal_interviews', 'tal_documents', 'tal_placements'
  ] loop
    execute format('alter table public.%I add column if not exists external_source text', t);
    execute format('alter table public.%I add column if not exists external_id text', t);
    execute format(
      'alter table public.%I drop constraint if exists %I', t, t || '_external_key');
    execute format(
      'alter table public.%I add constraint %I unique (external_source, external_id)',
      t, t || '_external_key');
  end loop;
end $$;

/*
 * The stage a candidate sat in over in the old system, kept as text.
 *
 * An import cannot invent a stage that does not exist in the new workflow, and
 * quietly dropping people into the first column would destroy the one thing the
 * pipeline is for. The importer maps what it can and records the original here
 * either way, so a mismatch is visible rather than silent.
 */
alter table public.tal_candidates
  add column if not exists external_stage text;
