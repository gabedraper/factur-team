-- Rooms where client talk is fine.
--
-- The default for a shared space is that Gaib keeps clients, money and
-- anyone's own mail out of it, because everyone in the room reads the answer.
-- The testing room is the whole company's own people talking about their own
-- clients, so that rule gets in the way there. Money and personal mail, chat
-- and files stay private everywhere.
alter table public.gaib_rooms add column if not exists clients_ok boolean not null default false;

update public.gaib_rooms set clients_ok = true where space_name = 'spaces/AAQAoLyfiM8';
