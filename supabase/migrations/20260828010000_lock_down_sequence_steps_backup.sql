/*
 * A backup table created outside a migration, and left with the default grants.
 *
 * sequence_steps_body_backup_20260827 held the full set for anon and
 * authenticated -- select, insert, update, delete and truncate -- with row
 * level security off. That made the email bodies of every sequence step
 * readable and destroyable by anyone holding the publishable key, and that key
 * ships in the browser, so "anyone" is the correct word rather than a
 * dramatisation.
 *
 * It was found by the advisor while adding the agent hub, not by anything going
 * wrong, which is the useful part: nothing in the application reads this table,
 * so nothing would ever have failed to draw attention to it.
 *
 * Locked to whoever could already see the live table rather than dropped. It is
 * seven rows identical to sequence_steps today and probably redundant, but a
 * backup whose reason for existing nobody remembers is worth keeping until
 * somebody does.
 */

alter table public.sequence_steps_body_backup_20260827 enable row level security;

/*
 * Revoked, not left to the policy alone.
 *
 * Row level security decides which rows a statement may touch. It does not
 * decide whether the statement may exist at all, and truncate is not a row
 * operation -- no policy is consulted for it. Enabling RLS and stopping there
 * would have left anon able to empty the table it could no longer read.
 */
revoke all on table public.sequence_steps_body_backup_20260827 from anon;
revoke all on table public.sequence_steps_body_backup_20260827 from authenticated;

grant select on table public.sequence_steps_body_backup_20260827 to authenticated;

drop policy if exists sequence_steps_body_backup_read
  on public.sequence_steps_body_backup_20260827;
create policy sequence_steps_body_backup_read
  on public.sequence_steps_body_backup_20260827
  for select to authenticated
  using (public.is_factur_user() and public.has_permission('org.manage'));
