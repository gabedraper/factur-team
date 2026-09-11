/*
 * Access at the level ClickUp actually decides it: the list.
 *
 * A list is visible to a person when ClickUp lists them as able to open it,
 * through work_people's link between their ClickUp account and them. A folder
 * or space is visible when at least one list inside it is -- which is how the
 * ClickUp sidebar behaves for someone shared a single list in a space they are
 * otherwise not in.
 *
 * A list with no access rows is hidden from everyone. That covers a list whose
 * access was never read as well as one nobody may see, and it is the safe way
 * to be wrong: a missing row hides a list rather than exposing one.
 *
 * Like work_hidden_space_ids, these return the set to hide, which for most
 * people is small.
 */

create or replace function public.work_visible_list_ids(p_member uuid)
returns setof text
language sql stable security definer set search_path to 'public'
as $function$
  select distinct a.list_clickup_id
  from public.work_list_access a
  join public.work_people p on p.clickup_user_id = a.clickup_user_id
  where p.member_id = p_member;
$function$;

create or replace function public.work_hidden_list_ids(p_member uuid)
returns setof text
language sql stable security definer set search_path to 'public'
as $function$
  select c.clickup_id
  from public.work_containers c
  where c.kind = 'list'
    and c.clickup_id not in (select public.work_visible_list_ids(p_member));
$function$;

create or replace function public.work_hidden_container_ids(p_member uuid)
returns setof text
language sql stable security definer set search_path to 'public'
as $function$
  with visible as (
    select c.clickup_id, c.parent_clickup_id, c.space_clickup_id
    from public.work_containers c
    where c.kind = 'list'
      and c.clickup_id in (select public.work_visible_list_ids(p_member))
  )
  select c.clickup_id
  from public.work_containers c
  where (c.kind = 'list'   and c.clickup_id not in (select clickup_id from visible))
     or (c.kind = 'folder' and c.clickup_id not in (select parent_clickup_id from visible where parent_clickup_id is not null))
     or (c.kind = 'space'  and c.clickup_id not in (select space_clickup_id from visible where space_clickup_id is not null));
$function$;
