/*
 * Who may not be added to a sequence.
 *
 * Enforced on the way in, by a trigger, rather than inside the two functions
 * that happen to start runs today. Those are four kilobytes of queue logic
 * each, and a rule bolted into both of them is a rule the third one forgets.
 *
 * Both default to off, so nothing that runs today changes until somebody
 * turns one on.
 */

alter table sequences
  add column if not exists skip_if_completed boolean not null default false,
  add column if not exists skip_if_active_elsewhere boolean not null default false,
  add column if not exists exit_same_domain boolean not null default false;

comment on column sequences.skip_if_completed is
  'Do not start a run for somebody who has already been through this sequence.';
comment on column sequences.skip_if_active_elsewhere is
  'Do not start a run for somebody who is part way through a different sequence.';
comment on column sequences.exit_same_domain is
  'When one person at a company replies, stop chasing the others there too.';

create or replace function public.tg_sequence_run_recipient_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  seq record;
begin
  select skip_if_completed, skip_if_active_elsewhere
    into seq
  from sequences
  where id = new.sequence_id;

  if seq is null then
    return new;
  end if;

  -- Been through this one before.
  if seq.skip_if_completed and exists (
    select 1 from sequence_runs r
    where r.sequence_id = new.sequence_id
      and r.subject_type = new.subject_type
      and r.subject_id = new.subject_id
      and r.ended_at is not null
  ) then
    return null;
  end if;

  /*
   * Part way through a different sequence.
   *
   * Two ladders chasing the same client at once is how somebody gets a
   * collections chase and a survey invitation in the same morning.
   */
  if seq.skip_if_active_elsewhere and exists (
    select 1 from sequence_runs r
    where r.sequence_id <> new.sequence_id
      and r.subject_type = new.subject_type
      and r.subject_id = new.subject_id
      and r.ended_at is null
  ) then
    return null;
  end if;

  return new;
end;
$$;

drop trigger if exists sequence_run_recipient_rules on sequence_runs;
create trigger sequence_run_recipient_rules
  before insert on sequence_runs
  for each row execute function public.tg_sequence_run_recipient_rules();
