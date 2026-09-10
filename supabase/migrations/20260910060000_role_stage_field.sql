/*
 * Which progress field a role reads.
 *
 * A pursuit carries two of them and they belong to different jobs. Prospecting
 * Lead Status is the prospector's ladder -- No Contact, Attempting, Lead
 * Handoff -- and it stops mattering the moment the lead is handed over. Stage
 * is the deal's own ladder, Pipeline Hot: Quoting and the rest, and it means
 * nothing to somebody still trying to get a first reply. Showing both to
 * everybody has meant every screen asks its reader to work out which column is
 * theirs, every time.
 *
 * So the role says. It is a setting rather than a rule in the code because the
 * answer is an operating decision, not a fact about the software: who counts as
 * prospecting and who counts as delivery changes when the org does, and it
 * should change in Settings rather than in a migration.
 *
 * The defaults follow the services the roles already sit in. Factur Sales,
 * Outsourced Prospecting and Lead Generation prospect, so they get lead status.
 * Service Delivery works deals, so it gets stage. Leadership and the
 * unattached roles -- admins, the data team, finance -- get both, since their
 * job is looking at other people's work and they need whichever ladder the
 * person they are looking at is on.
 */

alter table public.org_roles
  add column if not exists stage_field text not null default 'both';

alter table public.org_roles
  drop constraint if exists org_roles_stage_field_check;

alter table public.org_roles
  add constraint org_roles_stage_field_check
  check (stage_field in ('stage', 'lead_status', 'both'));

comment on column public.org_roles.stage_field is
  'Which progress field this role sees on a pursuit: stage (the deal ladder), lead_status (the prospecting ladder), or both.';

update public.org_roles r
set stage_field = case
  when s.name in ('Factur Sales', 'Outsourced Prospecting', 'Lead Generation') then 'lead_status'
  when s.name = 'Service Delivery' then 'stage'
  else 'both'
end
from public.org_services s
where s.id = r.service_id;

/* prospector has no service but is exactly what its name says. */
update public.org_roles set stage_field = 'lead_status'
where slug = 'prospector' and service_id is null;


/*
 * What the person in front of us should see.
 *
 * Roles are additive, so somebody who is both a prospector and a strategist
 * gets both ladders rather than whichever role happened to sort first -- the
 * union is the only answer that never hides something a person needs. Anyone
 * with no role at all falls back to both, because a blank screen is worse than
 * a busy one.
 */
create or replace function public.my_stage_fields()
returns table (show_stage boolean, show_lead_status boolean)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with mine as (
    select r.stage_field
    from public.org_members m
    join public.org_assignments a on a.member_id = m.id
    join public.org_roles r on r.id = a.role_id
    where m.active and m.auth_user_id = auth.uid() and r.active
  )
  select
    coalesce(bool_or(stage_field in ('stage', 'both')), true),
    coalesce(bool_or(stage_field in ('lead_status', 'both')), true)
  from mine;
$function$;

comment on function public.my_stage_fields() is
  'Which of the two progress ladders the viewer''s roles say they read. Additive across roles; both when they hold none.';

revoke all on function public.my_stage_fields() from public, anon;
grant execute on function public.my_stage_fields() to authenticated, service_role;
