-- Instructions given to the builder after a ticket was raised.
--
-- The ticket body is what the reporter said; this is what the person deciding
-- said afterwards -- "do it, but as a checkbox", "leave the source alone". A
-- list, newest last, so a second instruction does not erase the first. The
-- builder reads the whole ticket row, so these travel with it on every run.
alter table public.gaib_tickets
  add column if not exists directions jsonb not null default '[]'::jsonb;
