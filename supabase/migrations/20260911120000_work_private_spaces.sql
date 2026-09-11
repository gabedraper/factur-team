/*
 * Respect ClickUp's private spaces.
 *
 * Fifteen of the twenty-three spaces are private over there -- Finance, People
 * Ops, Team $, the one-to-one workspaces -- each visible to between one and
 * eight people. The mirror reads through a single personal API token, which
 * sees all of them, and then showed all of them to everyone holding work.view,
 * which is every role. Compensation tasks were browsable by the whole company.
 *
 * So each space now carries whether it is private and who its members are, and
 * every read path filters on it. Membership is by email, matched to the viewer's
 * org_members row, because that is the one identifier both systems agree on.
 *
 * The token owner is added to every private space's members at sync time. That
 * is not a bypass: the token can see those spaces in ClickUp, so its owner can,
 * and hiding them here would only make the mirror disagree with ClickUp in the
 * other direction.
 *
 * Space-level only. ClickUp can also restrict individual folders and lists; the
 * API does not return those memberships alongside the tree, so they are a
 * known gap rather than a silent one.
 */

alter table public.work_containers
  add column if not exists private boolean not null default false,
  add column if not exists member_emails text[];

/* Which space an item lives in, as an id rather than a name -- names are not
 * unique and are not what access is decided on. */
alter table public.work_items
  add column if not exists space_clickup_id text;

create index if not exists work_items_space_idx on public.work_items (space_clickup_id);

update public.work_items w
set space_clickup_id = c.space_clickup_id
from public.work_containers c
where c.kind = 'list' and c.clickup_id = w.clickup_list_id
  and w.space_clickup_id is distinct from c.space_clickup_id;

/*
 * Private spaces this viewer is not a member of. The set to hide, not the set to
 * show: an empty result is the common case and costs nothing to apply.
 */
create or replace function public.work_hidden_space_ids(p_email text)
returns setof text
language sql stable security definer set search_path to 'public'
as $function$
  select c.clickup_id
  from public.work_containers c
  where c.kind = 'space'
    and c.private
    and not (lower(coalesce(p_email, '')) = any (
      select lower(e) from unnest(coalesce(c.member_emails, '{}')) as e
    ));
$function$;
