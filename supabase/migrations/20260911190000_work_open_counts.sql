/*
 * Open task counts per list and per process, counted where the rows are.
 *
 * Both were computed by pulling every open row to the server and counting there,
 * which the API's 1,000-row cap turns into a silent undercount: the Client
 * Onboarding process alone has 1,679 open tasks. A count is one number per
 * group, so it belongs in SQL.
 */
create or replace function public.work_open_counts_by_list(p_list_ids text[])
returns table (list_clickup_id text, open bigint)
language sql stable security definer set search_path to 'public'
as $function$
  select w.clickup_list_id, count(*)
  from public.work_items w
  where w.clickup_list_id = any (p_list_ids)
    and w.status_type in ('open', 'custom')
  group by 1;
$function$;

/* Hidden spaces are passed in, so the count agrees with what the viewer sees. */
create or replace function public.work_open_counts_by_process(p_hidden_spaces text[])
returns table (process_id uuid, open bigint)
language sql stable security definer set search_path to 'public'
as $function$
  select w.process_id, count(*)
  from public.work_items w
  where w.process_id is not null
    and w.status_type in ('open', 'custom')
    and not (coalesce(w.space_clickup_id, '') = any (coalesce(p_hidden_spaces, '{}')))
  group by 1;
$function$;
