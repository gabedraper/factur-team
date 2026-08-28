/*
 * Reading everyone's conversations is its own permission, held by one person.
 *
 * Until now the read policy on gaib_sessions and gaib_messages said org.manage,
 * which sounded narrow and is not: three roles carry it -- App Administrator,
 * Team Lead and CEO -- covering nineteen people. Nineteen people could read any
 * conversation anybody had held with Gaib, and since Gaib can search the asker's
 * own mailbox on their behalf, a transcript can contain what was in somebody's
 * email. That was never a decision anyone made; it was org.manage being the
 * only permission to hand when the table was written.
 *
 * gaib.transcripts is granted to the CEO role and to nothing else. Tickets stay
 * on org.manage: a ticket is a work item about the app that somebody has to
 * pick up, and the queue is useless if only one person can see it. The
 * conversation that produced the ticket is a different thing.
 */

insert into public.org_permissions (key, name, description, category, position)
values (
  'gaib.transcripts',
  'Read Gaib conversations',
  'Read every conversation anyone has had with Gaib, including what they said and what it looked up for them.',
  'Administration',
  2
)
on conflict (key) do update
  set name = excluded.name,
      description = excluded.description,
      category = excluded.category,
      position = excluded.position;

-- Granted by naming the role rather than by naming a person, so it moves with
-- the job. Nobody else gets it here; adding a second holder is a deliberate
-- act in Settings, which is the point.
insert into public.org_role_permissions (role_id, permission_key)
select r.id, 'gaib.transcripts'
  from public.org_roles r
 where r.name = 'CEO'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Narrow the policies
-- ---------------------------------------------------------------------------

drop policy if exists gaib_sessions_read on public.gaib_sessions;
create policy gaib_sessions_read on public.gaib_sessions
  for select to authenticated
  using (
    public.is_factur_user()
    and (user_id = auth.uid() or public.has_permission('gaib.transcripts'))
  );

drop policy if exists gaib_messages_read on public.gaib_messages;
create policy gaib_messages_read on public.gaib_messages
  for select to authenticated
  using (
    public.is_factur_user()
    and exists (
      select 1 from public.gaib_sessions s
       where s.id = session_id
         and (s.user_id = auth.uid() or public.has_permission('gaib.transcripts'))
    )
  );
