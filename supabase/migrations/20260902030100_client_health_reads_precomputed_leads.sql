/*
 * Point client health at the precomputed lead counts.
 *
 * Done as a text replacement on the function's own definition rather than by
 * retyping it. get_client_health() is five kilobytes of scoring logic and a
 * hand-copy is how a score changes by accident -- the same reason the activity
 * half was swapped this way on 2026-08-31.
 *
 * Raises if the block is not found, so a failed match is a failed migration
 * rather than a silent no-op that leaves the scan in place.
 */
do $$
declare
  src text;
  old_block text := '  leads as (
    select client__c as client_key,
           count(*) filter (where createddate >= now() - interval ''30 days'') as recent,
           count(*) filter (where createddate >= now() - interval ''60 days''
                              and createddate <  now() - interval ''30 days'') as prior,
           count(*) filter (where stagename ilike ''%Quot%''
                              and stagename not ilike ''%No Quote%'') as quoted,
           count(*) filter (where stagename ilike ''%No Quote%'') as no_quoted,
           count(*) as total, count(contact_title__c) as with_title
    from sf_opp_leads_raw where client__c is not null group by client__c
  ),';
  new_block text := '  leads as (
    -- Precomputed hourly by refresh_client_lead_counts. Scanning all 90,476
    -- rows of sf_opp_leads_raw here cost 2.6s of an 8s statement timeout, on
    -- a Coupler table that is dropped and recreated on every sync.
    select client_key, recent, prior, quoted, no_quoted, total, with_title
    from client_lead_counts
  ),';
begin
  select pg_get_functiondef(p.oid) into src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_client_health';

  if position(old_block in src) = 0 then
    raise exception 'get_client_health no longer contains the expected leads block; not changing it blind';
  end if;

  execute replace(src, old_block, new_block);
end;
$$;
