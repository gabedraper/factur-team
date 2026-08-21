/**
 * Statistics for the headline tiles. No imports, so it can be run on its own.
 */

/**
 * The lower median of the values that are actually there.
 *
 * A null means "this lead has no answer" -- no first touch, no reply -- not a
 * zero. Counting those as zero would report a median reply time of nothing on a
 * set where most leads were never replied to at all.
 */
export function median(values: (number | null | undefined)[]): number | null {
  const present = values
    .filter((v): v is number => v !== null && v !== undefined)
    .sort((a, b) => a - b);
  return present.length ? present[Math.floor((present.length - 1) / 2)] : null;
}
