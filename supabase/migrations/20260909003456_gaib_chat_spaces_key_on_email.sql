-- Let Gaib reach somebody who has no app account yet.
--
-- The table was keyed on the app account because everybody Gaib talked to had
-- one. That is not true of the people who most need reaching: twelve members of
-- staff have never signed in, and inviting them to sign in is exactly the
-- message worth sending. Chat itself only ever needed their Google address.
--
-- So the address is now an identity of its own and the account is stamped on
-- when there is one -- a conversation opened before they signed in is the same
-- conversation afterwards. The primary key moves to a surrogate id because
-- either column may be absent; uniqueness is kept on both, separately.
alter table public.gaib_chat_spaces
  add column if not exists id uuid not null default gen_random_uuid(),
  add column if not exists email text;

update public.gaib_chat_spaces s
   set email = lower(m.email)
  from public.org_members m
 where m.auth_user_id = s.user_id
   and s.email is null;

alter table public.gaib_chat_spaces
  drop constraint if exists gaib_chat_spaces_pkey;

alter table public.gaib_chat_spaces
  add constraint gaib_chat_spaces_pkey primary key (id);

alter table public.gaib_chat_spaces
  alter column user_id drop not null;

create unique index if not exists gaib_chat_spaces_user_key
  on public.gaib_chat_spaces (user_id) where user_id is not null;

create unique index if not exists gaib_chat_spaces_email_key
  on public.gaib_chat_spaces (lower(email)) where email is not null;
