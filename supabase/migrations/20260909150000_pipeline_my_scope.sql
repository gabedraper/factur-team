/*
 * Whose target companies am I looking at, and how should they be stacked?
 *
 * Three shapes of the same screen, decided by where the viewer sits rather than
 * by a setting:
 *
 *   a rep      -- their own clients, one list
 *   a lead     -- grouped by the person under them who holds the client
 *   an admin   -- grouped by team lead, then account manager, then client
 *
 * "Lead" is not a permission, it is a fact: somebody reports to you. That is
 * already how my_client_ids() decides what you can see -- it walks
 * manager_member_id recursively and returns every client anyone in your circle
 * holds a role on -- so deriving the shape the same way keeps the two in step.
 * A rep promoted to lead gets the grouped view the moment somebody is pointed
 * at them, with nothing to configure.
 *
 * A caveat that matters more than it should: over half the clients with live
 * pipeline have nobody on them at all. Of 903, only 389 have an account
 * manager, 151 a team lead, and 486 have none of account manager, team lead or
 * member. sdr_id is empty on every client in the org. So the admin view's top
 * two levels are mostly one large Unassigned group, and that is a reporting of
 * the data rather than a fault in the screen -- the grouping is built to say so
 * plainly instead of hiding it in a bucket that looks like a bug.
 */

create or replace function public.pipeline_my_scope()
returns table (level text, member_id uuid, member_name text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    case
      /* org.manage alone cannot separate a manager from a team lead here: all
         seven people who have direct reports hold it, so using it by itself
         gave Darryl and Noah the whole company's grouping instead of their own
         team's. Sitting at the top of the reporting tree is the honest test,
         and today exactly one person does. */
      when m.manager_member_id is null and public.has_permission('org.manage')
        then 'admin'
      when exists (
        select 1 from public.org_members r
        where r.manager_member_id = m.id and r.active
      ) then 'lead'
      else 'rep'
    end,
    m.id,
    m.full_name
  from public.org_members m
  where m.active and m.auth_user_id = auth.uid()
  limit 1;
$function$;

comment on function public.pipeline_my_scope() is
  'Where the viewer sits: rep, lead (somebody reports to them) or admin (org.manage and nobody above them). Decides how the target company list is grouped, not what it contains -- my_client_ids() already does that.';


revoke all on function public.pipeline_my_scope() from public, anon;
grant execute on function public.pipeline_my_scope() to authenticated, service_role;
