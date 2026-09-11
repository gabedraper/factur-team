-- The daily test's thread, so anything Gaib says about it later lands under
-- the post rather than as a new message the room has to connect back.
alter table public.gaib_room_tests add column if not exists thread_name text;
