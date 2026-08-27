/*
 * The careers heading and intro are configured in Settings but were only
 * readable by signed-in staff, so the public page always fell back to its
 * defaults and the configured wording never appeared to anybody it was written
 * for. This exposes exactly those three fields and nothing else on the row.
 */
create or replace function public.tal_public_careers()
returns table (heading text, intro text, enabled boolean)
language sql stable security definer set search_path to 'public', 'pg_catalog'
as $function$
  select careers_page_heading, careers_page_intro, careers_page_enabled
    from public.tal_settings where id;
$function$;

revoke all on function public.tal_public_careers() from public;
grant execute on function public.tal_public_careers() to anon, authenticated;
