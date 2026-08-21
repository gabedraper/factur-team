/**
 * Reading Salesforce timestamps, and where the working day ends. No imports, so
 * it can be run on its own.
 */
export const END_OF_DAY_HOUR = 17;

/** Everything is shown in the company's own time, not the reader's. */
export const BUSINESS_TZ = "America/Chicago";

/**
 * Coupler writes `timestamp without time zone` holding UTC, so the values come
 * back as "2026-08-21 23:00:26" with nothing to say which zone that is -- and
 * `new Date` on a bare timestamp reads it as the *reader's* local time. In
 * Central that dated every activity five hours into the future, which is how it
 * surfaced: an email "sent" at 8:14 PM when it was only 6:44 PM.
 */
export function parseUtc(value: string): Date {
  return new Date(/[Zz]|[+-]\d{2}:?\d{2}$/.test(value) ? value : value.replace(" ", "T") + "Z");
}

/** "Aug 21, 3:14 PM" in company time. */
export function formatBusinessDateTime(value: string): string {
  const when = parseUtc(value);
  if (Number.isNaN(when.getTime())) return "";
  return when.toLocaleString("en-US", {
    timeZone: BUSINESS_TZ, month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

/** "Aug 21, 2026" in company time. */
export function formatBusinessDate(value: string): string {
  const when = parseUtc(value);
  if (Number.isNaN(when.getTime())) return "";
  return when.toLocaleDateString("en-US", {
    timeZone: BUSINESS_TZ, day: "numeric", month: "short", year: "numeric",
  });
}

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
  const when = parseUtc(created);
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
