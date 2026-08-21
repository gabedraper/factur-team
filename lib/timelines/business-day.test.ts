/** node --experimental-strip-types lib/timelines/business-day.test.ts */
import { hoursUntilEndOfDay, parseUtc, formatBusinessDateTime, formatBusinessDate } from "./business-day.ts";

let failed = 0;
function check(label: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failed++; console.log(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
  } else console.log(`ok   ${label}`);
}
const round = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100);

/*
 * The bug this all exists for: Coupler stores UTC in a column with no zone, so
 * the value arrives as "2026-08-21 23:00:26". Plain `new Date` on that reads it
 * as the *reader's* local time, which in Central dated every activity five
 * hours into the future -- an email "sent" at 8:14 PM when it was 6:44 PM.
 */
check("a bare timestamp is read as UTC",
  parseUtc("2026-08-21 23:00:26").toISOString(), "2026-08-21T23:00:26.000Z");
check("with a T separator too",
  parseUtc("2026-08-21T23:00:26").toISOString(), "2026-08-21T23:00:26.000Z");
check("an explicit Z is left alone",
  parseUtc("2026-08-21T23:00:26Z").toISOString(), "2026-08-21T23:00:26.000Z");
check("an explicit offset is left alone",
  parseUtc("2026-08-21T18:00:26-05:00").toISOString(), "2026-08-21T23:00:26.000Z");

// The screenshot that started this: 23:00 UTC is 6:00 PM Central, not 11:00 PM.
check("shown in company time, not the reader's",
  formatBusinessDateTime("2026-08-21 23:00:26"), "Aug 21, 6:00 PM");
check("winter, when Central is an hour further from UTC",
  formatBusinessDateTime("2026-01-21 23:00:26"), "Jan 21, 5:00 PM");
// Late UTC is still the previous day in Central -- the date has to move too.
check("a UTC timestamp after midnight is still the day before in Central",
  formatBusinessDate("2026-08-22T03:00:00Z"), "Aug 21, 2026");
check("bad input formats to nothing rather than 'Invalid Date'",
  formatBusinessDateTime("not a date"), "");

// Summer: Chicago is UTC-5 (CDT). 14:00Z is 9am there, eight hours to 5pm.
check("summer morning", round(hoursUntilEndOfDay("2026-08-21T14:00:00Z")), 8);
// Winter: Chicago is UTC-6 (CST). The same 14:00Z is 8am there, so nine hours.
// Getting this wrong by an hour for half the year is the whole point of asking
// the platform for the wall clock instead of subtracting a fixed offset.
check("winter morning, one hour more", round(hoursUntilEndOfDay("2026-01-21T14:00:00Z")), 9);

// Exactly 5pm Central is the boundary itself: the window is over, not zero-wide.
check("summer 5pm exactly", hoursUntilEndOfDay("2026-08-21T22:00:00Z"), null);
check("winter 5pm exactly", hoursUntilEndOfDay("2026-01-21T23:00:00Z"), null);

// After hours: nothing to draw, rather than a line behind the lead's own start.
check("evening arrival has no same-day window",
  hoursUntilEndOfDay("2026-08-22T02:00:00Z"), null);
check("just before 5pm still counts",
  round(hoursUntilEndOfDay("2026-08-21T21:30:00Z")), 0.5);

// Midnight must read as hour 0, not hour 24 -- h23 vs h24 formatting.
check("early hours give a full working day",
  round(hoursUntilEndOfDay("2026-08-21T05:00:00Z")), 17);

// A timestamp with no zone marker is not this function's job to guess about,
// but it must not return a wild number.
check("unparseable input returns null", hoursUntilEndOfDay("not a date"), null);

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
