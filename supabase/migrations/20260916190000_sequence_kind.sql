/*
 * Which sequences a person may add clients to, and which run themselves.
 *
 * They were all one list, so the picker on the clients table offered
 * "Collections" and "NPS survey" beside the prewritten ones. Both of those
 * decide their own audience -- collections from how old an invoice is, NPS from
 * a campaign built for a period -- and hand-adding a client to either would
 * either do nothing or quietly compete with the process that owns it. Somebody
 * could add forty clients to Collections, believe chasing had started, and be
 * wrong.
 *
 * Three kinds, because there are three:
 *
 *   process   Runs itself off its own trigger. Its steps and wording are edited
 *             in Settings, but nobody chooses who is on it. Collections and NPS.
 *   campaign  Written in advance and used again and again -- an announcement
 *             ladder, an onboarding welcome. This is the pool the clients table
 *             offers, and the only kind a person enrols anybody into by hand.
 *   one_off   A single email written for one occasion by "Send an email". Its
 *             audience was fixed when it was written, so it is never offered as
 *             somewhere to add more people.
 *
 * Deliberately a label rather than a rule. Nothing here stops a process
 * sequence being enrolled into -- the collections and NPS rows are live config
 * their own screens read, and a check constraint that made them unwritable
 * would break those. This says what a sequence is for, and the picker believes
 * it.
 */
alter table public.sequences
  add column if not exists kind text not null default 'campaign'
    check (kind in ('process', 'campaign', 'one_off'));

comment on column public.sequences.kind is
  'process: runs itself and owns its audience. campaign: prewritten, people add '
  'clients to it. one_off: a single send whose audience was fixed when written.';

update public.sequences set kind = 'process' where slug in ('collections', 'nps');
