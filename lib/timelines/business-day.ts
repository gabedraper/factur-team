/**
 * Where the working day ends, for judging whether a first touch was same-day.
 * No imports, so it can be run on its own.
 */
export const END_OF_DAY_HOUR = 17;
export const BUSINESS_TZ = "America/Chicago";

/**
 * Hours from a lead arriving until 5pm Central that same day.
 *
 * Read off the wall clock in Chicago rather than by arithmetic on UTC offsets,
 * so this needs no knowledge of when daylight saving starts or ends -- the
 * platform's own timezone data answers it.
 *
 * Null when the lead arrived at or after 5pm: there was no same-day window for
 * anyone to miss, and drawing the line behind the lead's own start would claim
 * there was.
 */
export function hoursUntilEndOfDay(created: string): number | null {
  // formatToParts throws on an invalid date rather than returning nonsense, and
  // this runs inside the lane drawing -- one bad timestamp would take the whole
  // board down instead of costing one line.
  const when = new Date(created);
  if (Number.isNaN(when.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(when);

  const at = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? NaN);
  const hour = at("hour"), minute = at("minute");
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;

  const hours = END_OF_DAY_HOUR - (hour + minute / 60);
  return hours > 0 ? hours : null;
}
