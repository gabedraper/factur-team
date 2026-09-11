/*
 * Keeping ClickUp access current without anybody running a script.
 *
 * Reading every list's access is about 1,000 calls -- thirteen minutes paced
 * against ClickUp's limit, and far past the 300 seconds a scheduled route gets.
 * So it is done the way the agreements sync reads its archive: a small batch
 * every fifteen minutes, the lists checked longest ago first, which walks the
 * whole workspace every four or five hours. Someone added to a list in ClickUp
 * sees it here the same afternoon.
 *
 * Offset from the task sync (:00/:15/:30/:45) to :07/:22/:37/:52, so the two
 * never spend the same minute of ClickUp's rate limit.
 */

/* Lists tasks point at that the tree never recorded -- one array, one row, so
 * finding them does not mean reading every task's list id through the API. */
create or replace function public.work_orphan_list_ids()
returns text[]
language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(array_agg(distinct w.clickup_list_id), '{}')
  from public.work_items w
  where w.clickup_list_id is not null
    and not exists (select 1 from public.work_containers c
                    where c.clickup_id = w.clickup_list_id and c.kind = 'list');
$function$;

select cron.schedule('work-access-sync', '7,22,37,52 * * * *', $job$
  select net.http_post(
    url := 'https://team.facturmfg.com/api/work/access-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-gaib-secret', (select value from public.gaib_secrets where name = 'deliver')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$job$)
where not exists (select 1 from cron.job where jobname = 'work-access-sync');
