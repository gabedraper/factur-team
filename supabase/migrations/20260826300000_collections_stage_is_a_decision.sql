/*
 * Collections stage: two states the money decides, two a person does.
 *
 * Current and Past Due follow from the ageing report and nobody should have to
 * keep them up to date by hand. Service Paused and Sent to Collections are
 * decisions -- somebody stopped the work, somebody handed the debt to an
 * agency -- and no amount of reading invoices will reveal them.
 *
 * So the column holds only the decisions. Null means "read it off the money",
 * which is also what clears when a client pays: the stage falls back to Current
 * on its own rather than sitting on a decision nobody remembered to undo.
 *
 * The board widens with it. "Current -- nothing past due" cannot be a stage on
 * a list that only contains the past due, so the board now carries anything
 * with an unpaid invoice: 25 customers owing $139,205 that is not late yet,
 * alongside the 78 owing $615,059 that is. The past-due figures are worked out
 * with filters rather than by excluding rows, so a client whose money is all
 * within terms appears with zeroes instead of vanishing.
 *
 * The board function itself is recorded in the applied migration of the same
 * name; it is reproduced here in full.
 */
alter table public.collections_client_state
  add column if not exists stage text
    check (stage is null or stage in ('service_paused', 'sent_to_collections'));

alter table public.collections_client_state
  add column if not exists stage_set_by text,
  add column if not exists stage_set_at timestamptz;
