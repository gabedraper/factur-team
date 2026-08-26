/*
 * NPS: the survey emails, when each goes out, and what was sent.
 *
 * The same shape as collections -- a ladder of steps, a queue that says who is
 * due which one, and a log of what actually went out -- because it is the same
 * job. Three things differ, and they are the whole design:
 *
 * 1. The episode is a send, not a client. collections_client_state exists
 *    because arrears are a running condition with no natural start; an NPS
 *    invitation has one, and it is the nps_sends row. So the ladder hangs off
 *    that and needs no separate state table.
 *
 * 2. A reply ends the ladder, the way a cleared balance does. That is what
 *    responded_at already records, so nothing new is needed to stop chasing
 *    someone who has answered.
 *
 * 3. There is no single sender. Collections all comes from one mailbox; a
 *    survey comes from the client's own team lead, so `send_as` is resolved per
 *    row rather than held in settings.
 */

insert into public.org_permissions (key, name, description, category, position)
values ('nps.send', 'Send NPS surveys',
        'Write the survey emails, set when they go out, and send them.',
        'Clients', 3)
on conflict (key) do nothing;

-- A team lead runs their own clients' surveys, so they get it alongside admins.
insert into public.org_role_permissions (role_id, permission_key)
select r.id, 'nps.send' from public.org_roles r
where r.name in ('App Administrator', 'Team Lead')
on conflict (role_id, permission_key) do nothing;

/* The ladder. One row per email in the sequence. */
create table if not exists public.nps_steps (
  id uuid primary key default gen_random_uuid(),
  position integer not null,
  /*
   * Days after the invitation went out. The first step is the invitation
   * itself and sits at 0 -- there is nothing to count from until it is sent,
   * which is exactly what the queue keys on.
   */
  days_after_send integer not null check (days_after_send >= 0),
  subject text not null,
  body text not null,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by text
);

create unique index if not exists nps_steps_position_idx on public.nps_steps (position);

/*
 * What was actually sent, kept whole -- the template can be rewritten tomorrow
 * and this is the wording the client received.
 */
create table if not exists public.nps_sequence_sent (
  id uuid primary key default gen_random_uuid(),
  send_id uuid not null references public.nps_sends(id) on delete cascade,
  step_id uuid references public.nps_steps(id) on delete set null,
  step_position integer,
  to_email text not null,
  from_email text not null,
  subject text not null,
  body text not null,
  mode text not null check (mode in ('semi', 'full')),
  gmail_draft_id text,
  rfc_message_id text,
  sent_at timestamptz not null default now(),
  sent_by text
);

create index if not exists nps_sequence_sent_send_idx
  on public.nps_sequence_sent (send_id, sent_at desc);

-- One row per step per invitation. The queue already excludes what has been
-- sent; this makes a double-send impossible rather than merely unlikely.
create unique index if not exists nps_sequence_sent_once_idx
  on public.nps_sequence_sent (send_id, step_id);

create table if not exists public.nps_settings (
  id boolean primary key default true check (id),
  mode text not null default 'semi' check (mode in ('semi', 'full')),
  updated_at timestamptz not null default now(),
  updated_by text
);

insert into public.nps_settings (id) values (true) on conflict (id) do nothing;

alter table public.nps_steps enable row level security;
alter table public.nps_sequence_sent enable row level security;
alter table public.nps_settings enable row level security;

-- Reading is open to anyone who can already see client health; writing goes
-- through the server, which checks nps.send first. Nobody edits from the browser.
do $$
declare t text;
begin
  foreach t in array array['nps_steps', 'nps_sequence_sent', 'nps_settings'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (public.is_factur_user()
                and (public.has_permission(''clients.health'')
                     or public.has_permission(''nps.send'')
                     or public.has_permission(''org.manage'')))',
      t || '_read', t);
  end loop;
end $$;

/*
 * A ladder to start from, switched off.
 *
 * Off because wording that goes to a client should be read by a person once
 * before it goes anywhere, and because turning these on is what starts mail
 * moving -- that should be a decision, not a side effect of deploying.
 *
 * The gaps are deliberately short. An NPS reminder is only useful while the
 * quarter it asks about is still the quarter they are living in.
 */
insert into public.nps_steps (position, days_after_send, subject, body, active)
select * from (values
  (1, 0,
   'How are we doing, {{contact}}?',
   E'Hi {{contact}},\n\nOne question, and it takes a few seconds:\n\nHow likely are you to recommend Factur to a friend or colleague?\n\n{{scale}}\n\nWhatever you pick, there is a box on the next page if you want to tell me why. I read all of them.\n\nThanks,\n{{sender}}',
   false),
  (2, 4,
   'Quick one, {{contact}}',
   E'Hi {{contact}},\n\nJust in case my last note got buried -- one click, no form:\n\n{{scale}}\n\nIf now is not a good time, ignore this and I will not chase again.\n\nThanks,\n{{sender}}',
   false),
  (3, 10,
   'Last one from me',
   E'Hi {{contact}},\n\nI will leave it here -- but if you have thirty seconds, it genuinely shapes what we do next quarter:\n\n{{scale}}\n\nEither way, thank you for working with us.\n\n{{sender}}',
   false)
) as v(position, days_after_send, subject, body, active)
where not exists (select 1 from public.nps_steps);
