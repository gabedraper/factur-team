/*
 * Market coverage joins the nightly job.
 *
 * Both rebuilds depend on things this function has already refreshed by the
 * time they run -- sync_clients_from_salesforce() settles the client list, and
 * the markets themselves come from client_attributes -- so they go last.
 *
 * Order matters between the two as well: the totals pass reads nothing from the
 * per-market rows, but it writes the '(all)' row into the same table, and
 * running it first would leave that row a day behind whenever the market maps
 * change.
 *
 * The Census and FRED loaders are deliberately NOT here. County Business
 * Patterns publishes once a year and FRED once a month; re-downloading either
 * nightly would be traffic spent to rewrite identical rows. Those stay manual,
 * which is also when someone should be looking at whether a new vintage moved
 * anything.
 */
create or replace function public.nightly_maintenance()
returns void
language plpgsql
security definer
set search_path = public
as $$
BEGIN
  PERFORM public.ensure_staging_rls();
  PERFORM public.refresh_raw_activities();
  PERFORM public.refresh_deal_activities();
  PERFORM public.deactivate_departed_reps();
  PERFORM public.sync_managers();
  PERFORM public.sync_clients_from_salesforce();
  PERFORM public.rebuild_client_market_coverage();
  PERFORM public.rebuild_client_market_totals();
END;
$$;
