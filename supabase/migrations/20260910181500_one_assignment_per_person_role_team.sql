/*
 * Nobody holds the same role on the same team twice.
 *
 * Six people carried App Administrator twice over, all six being the ones
 * whose old profiles.role was 'admin' -- a backfill that ran a second time.
 * Permissions are a set, so it changed nothing about what anyone could do; it
 * just made every count and every list of somebody's roles wrong.
 *
 * The reason it could happen is that team_id is null for a role held outside
 * any team, and a plain unique index lets nulls repeat. Two indexes instead:
 * one for assignments that name a team, one for those that do not.
 *
 * The delete runs on its own. Doing it in the same transaction as the index
 * fails with "cannot CREATE INDEX because it has pending trigger events".
 */
delete from public.org_assignments a
 using public.org_assignments keep
 where a.member_id = keep.member_id
   and a.role_id = keep.role_id
   and a.team_id is not distinct from keep.team_id
   and a.id > keep.id;

create unique index if not exists org_assignments_unique_in_team
  on public.org_assignments (member_id, role_id, team_id)
  where team_id is not null;

create unique index if not exists org_assignments_unique_no_team
  on public.org_assignments (member_id, role_id)
  where team_id is null;
