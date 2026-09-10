-- The reason a person types when closing a ticket, and getting it to the
-- person who raised it.
--
-- The rejection notice has always had a line for it -- "His reasoning: ..." --
-- filled from gaib_tickets.brief, which is the coding agent's technical
-- write-up. The reason typed on the card went only to gaib_ticket_events,
-- which no screen displays. So the reporter was shown the agent's notes
-- presented as Gabe's reasoning, or nothing at all, and the box on the card
-- was write-only.
--
-- Superseded immediately by 20260909144155, which drops the fallback to brief
-- entirely. Kept as its own step because the column is the lasting part.
alter table public.gaib_tickets
  add column if not exists decision_note text;

comment on column public.gaib_tickets.decision_note is
  'Why a person closed this, in their words. Preferred over brief when telling the reporter.';
