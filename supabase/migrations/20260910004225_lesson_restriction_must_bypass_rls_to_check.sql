/*
 * The restriction check has to see the course, or it lets everything through.
 *
 * The first version asked, inside the lessons policy, whether the lesson's
 * course was restricted -- by selecting from courses. courses has row security
 * of its own, and inside a policy that subquery runs as the person asking. A
 * restricted course is invisible to them, so the subquery found nothing,
 * `not exists` came back true, and the policy granted access to exactly the
 * lessons it was written to withhold. It failed open, and it tested clean
 * against any join through courses, because that join is hidden the same way.
 *
 * The lookup now runs as owner so it can always see the course row, and
 * answers one question: is this module's course restricted. Nothing about the
 * caller, so it leaks nothing.
 */
create or replace function public.module_is_restricted(p_module uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select exists (
    select 1
    from public.modules m
    join public.courses c on c.id = m.course_id
    where m.id = p_module and c.restricted
  );
$$;

revoke all on function public.module_is_restricted(uuid) from public;
grant execute on function public.module_is_restricted(uuid) to authenticated, service_role;

drop policy if exists "Factur users can view lessons" on public.lessons;

create policy "Factur users can view lessons"
  on public.lessons for select
  using (
    (select public.is_factur_user())
    and (
      (select public.handbook_can_read_restricted())
      or not public.module_is_restricted(module_id)
    )
  );
