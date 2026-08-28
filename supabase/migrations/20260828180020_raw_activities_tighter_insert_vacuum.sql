/*
 * Vacuum raw_activities more often, on the insert count rather than the dead
 * row count.
 *
 * The August settings assumed dead rows were the trigger, which they are when
 * the hourly refresh rewrites unchanged rows. They are not what broke
 * /clients/health today: dead rows sat at 0.6%, well under any threshold,
 * while the inserts since the last vacuum had left enough pages not-all-
 * visible to turn an index-only scan into 28,634 heap fetches. The scan reads
 * 240,000 rows, so a small number of dirtied pages is expensive out of
 * proportion to how few rows changed.
 *
 * insert_scale_factor was already 0.02 -- about 6,400 rows on a table this
 * size, and evidently a wide enough window to do the damage. Halving it, with
 * the threshold stated rather than left to the default, roughly halves how
 * stale the map can get. Vacuum only touches pages that changed, so running it
 * twice as often is not twice the work.
 */

alter table public.raw_activities set (
  autovacuum_vacuum_insert_scale_factor = 0.01,
  autovacuum_vacuum_insert_threshold = 1000
);

alter table public.deal_activities set (
  autovacuum_vacuum_insert_scale_factor = 0.01,
  autovacuum_vacuum_insert_threshold = 1000
);
