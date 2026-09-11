/*
 * What one person may see of the mirror, decided in one place.
 *
 * Three cases, from ClickUp:
 *
 *   owner or admin  -- everything. ClickUp does not list them on every list
 *                      (Gabe is on 888 of 1,036) but they can open every one;
 *                      the token that reads the mirror is one of them.
 *   anyone else     -- the lists ClickUp says they can open, from
 *                      work_list_access: inherited, through a group, or shared
 *                      one list at a time.
 *   no ClickUp link -- public spaces only. Agreed 2026-09-11: nothing private
 *                      leaks, and nobody new opens the app to a blank page.
 *
 * Returned as the sets to hide, two-tier: whole spaces the person sees nothing
 * in, then the folders and lists hidden inside spaces they do see. Measured
 * across the 36 people it applies to: at most 15 spaces, and a median of one
 * exception list (max 73) -- small enough to pass as a filter.
 *
 * One row of arrays rather than rows of ids, deliberately. The API returns at
 * most 1,000 rows, and a truncated hide-list fails in the dangerous direction:
 * it exposes what it dropped. An array is one value and cannot be cut short.
 *
 * A person with two ClickUp accounts -- it happens -- gets the union of both.
 */
create or replace function public.work_access_for(p_member uuid)
returns table (see_all boolean, hidden_spaces text[], hidden_folders text[], hidden_lists text[])
language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  v_users text[];
  v_admin boolean;
begin
  select array_agg(p.clickup_user_id), coalesce(bool_or(p.role in (1, 2)), false)
    into v_users, v_admin
  from public.work_people p
  where p.member_id = p_member;

  if v_admin then
    return query select true, '{}'::text[], '{}'::text[], '{}'::text[];
    return;
  end if;

  if v_users is null then
    return query select false,
      coalesce((select array_agg(s.clickup_id) from public.work_containers s
                where s.kind = 'space' and s.private), '{}'::text[]),
      '{}'::text[], '{}'::text[];
    return;
  end if;

  return query
  with vis as (
    select distinct c.clickup_id, c.parent_clickup_id, c.space_clickup_id
    from public.work_list_access a
    join public.work_containers c on c.clickup_id = a.list_clickup_id and c.kind = 'list'
    where a.clickup_user_id = any (v_users)
  )
  select false,
    coalesce((select array_agg(s.clickup_id) from public.work_containers s
              where s.kind = 'space'
                and s.clickup_id not in (select v.space_clickup_id from vis v where v.space_clickup_id is not null)),
             '{}'::text[]),
    coalesce((select array_agg(f.clickup_id) from public.work_containers f
              where f.kind = 'folder'
                and f.space_clickup_id in (select v.space_clickup_id from vis v)
                and f.clickup_id not in (select v.parent_clickup_id from vis v where v.parent_clickup_id is not null)),
             '{}'::text[]),
    coalesce((select array_agg(l.clickup_id) from public.work_containers l
              where l.kind = 'list'
                and l.space_clickup_id in (select v.space_clickup_id from vis v)
                and l.clickup_id not in (select v.clickup_id from vis v)),
             '{}'::text[]);
end;
$function$;

/* The process counts learn list exceptions too, so the number beside a
 * process agrees with the board it opens. */
drop function if exists public.work_open_counts_by_process(text[]);
create or replace function public.work_open_counts_by_process(
  p_hidden_spaces text[], p_hidden_lists text[] default '{}')
returns table (process_id uuid, open bigint)
language sql stable security definer set search_path to 'public'
as $function$
  select w.process_id, count(*)
  from public.work_items w
  where w.process_id is not null
    and w.status_type in ('open', 'custom')
    and not (coalesce(w.space_clickup_id, '') = any (coalesce(p_hidden_spaces, '{}')))
    and not (coalesce(w.clickup_list_id, '') = any (coalesce(p_hidden_lists, '{}')))
  group by 1;
$function$;
