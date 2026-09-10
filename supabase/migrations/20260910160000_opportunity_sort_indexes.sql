/*
 * Indexes for the columns a list view sorts by.
 *
 * A list view with no filter was taking 7.1 seconds to return fifty rows, and
 * the filter was not the problem -- ORDER BY updated_at has no index, so the
 * planner scanned and sorted all 779,809 rows before the LIMIT could apply. A
 * limit cannot stop early when the sort has to see everything first.
 *
 * These four are the sorts worth indexing: updated_at is the default, and the
 * three dates are what a person actually orders a pipeline by. The other
 * sortable fields live on joined tables and cannot be helped this way -- those
 * views need a filter, and the screen now says so rather than hanging.
 *
 * Built CONCURRENTLY: the sync writes to this table every three minutes and a
 * plain CREATE INDEX would block it.
 */

create index concurrently if not exists opportunities_updated_at_idx
  on public.opportunities (updated_at desc);

create index concurrently if not exists opportunities_next_action_idx
  on public.opportunities (next_action_date)
  where next_action_date is not null;

create index concurrently if not exists opportunities_opened_on_idx
  on public.opportunities (opened_on desc);

create index concurrently if not exists opportunities_close_date_idx
  on public.opportunities (close_date)
  where close_date is not null;
