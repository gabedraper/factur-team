/** node --experimental-strip-types lib/timelines/business-day.test.ts */
import { hoursUntilEndOfDay } from "./business-day.ts";

let failed = 0;
function check(label: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failed++; console.log(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
  } else console.log(`ok   ${label}`);
}
const round = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100);

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
