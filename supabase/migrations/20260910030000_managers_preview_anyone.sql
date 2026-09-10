/*
 * A manager may preview anyone, not only their own people.
 *
 * The reporting-line restriction added a moment ago was wrong about the job.
 * Managers cover for each other, look into work that is not theirs, and get
 * asked what a screen looks like for someone three teams away -- and answering
 * that is the whole reason the tool exists. Scoping it to direct reports made
 * it useless in exactly the cases someone reaches for it.
 *
 * It was also nearly inert: five of the six team leads hold app-admin, which
 * skipped the restriction entirely, so it bound one person out of forty-seven.
 * A rule that stops one person and inconveniences no one else is not a security
 * boundary, it is a trip hazard.
 *
 * So the line is drawn in one place only, where it belongs: are you a manager,
 * a team lead or an admin? Everyone else cannot preview at all, and that is the
 * part that actually mattered -- before this, any signed-in person could pass a
 * colleague's id straight to my_client_ids() over the API and read their book.
 *
 * p_target still earns its place by having to be a real, active member, so a
 * stale cookie pointing at someone who has left grants nothing.
 */

create or replace function public.can_preview_as(p_target uuid default null)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1
    from public.org_members m
    join public.org_assignments a on a.member_id = m.id
    join public.org_roles r on r.id = a.role_id
    where m.active
      and m.auth_user_id = auth.uid()
      and r.slug in ('ceo', 'app-admin', 'exec', 'manager',
                     'financial-manager', 'service-delivery-manager')
  )
  and (
    p_target is null
    or exists (select 1 from public.org_members t where t.id = p_target and t.active)
  );
$function$;

comment on function public.can_preview_as(uuid) is
  'May the signed-in person view the app as p_target? Managers, team leads and admins may preview any active member; everyone else, nobody.';
