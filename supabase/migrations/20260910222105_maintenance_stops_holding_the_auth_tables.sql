/*
 * nightly_maintenance() was locking every user out of the app, ten times a day.
 *
 * ensure_staging_ready() takes an AccessExclusiveLock on all 16 tables in the
 * auth schema -- users, sessions, identities, flow_state, refresh_tokens and the
 * rest -- measured directly, even though it never names one. On its own that
 * lasts a few seconds and is released at commit.
 *
 * But this function called it FIRST and then ran seven heavy rebuilds in the
 * same transaction, and a transaction keeps every lock it takes until it
 * commits. So the auth tables stayed exclusively locked for the entire
 * multi-minute run: no sign-in could create its flow_state row, no existing
 * session could be read, and Supabase's own /auth/v1/authorize returned
 * "upstream request timeout". Despite the name it runs hourly at :15 through
 * the working day (15 14-23 * * 1-5), which is when people are signing in.
 *
 * The call is simply removed. reapply-staging-rls already runs
 * ensure_staging_rls() on its own every ten minutes, so this was a second copy
 * of work already done -- and the only thing the copy added was the lock. The
 * worst case of dropping it is a rebuild running a little slower in the few
 * minutes after a Coupler sync, before the ten-minute job reindexes.
 *
 * Every other step is unchanged, copied from the live definition.
 */
create or replace function public.nightly_maintenance()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public.refresh_raw_activities();
  perform public.refresh_deal_activities();
  perform public.deactivate_departed_reps();
  perform public.sync_managers();
  perform public.sync_clients_from_salesforce();
  perform public.rebuild_client_market_coverage();
  perform public.rebuild_client_market_totals();
end;
$function$;
