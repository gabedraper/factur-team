/** node --experimental-strip-types lib/timelines/stats.test.ts */
import { median } from "./stats.ts";

let failed = 0;
function check(label: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failed++; console.log(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
  } else console.log(`ok   ${label}`);
}

check("odd count takes the middle", median([3, 1, 2]), 2);
check("even count takes the lower of the two middles", median([1, 2, 3, 4]), 2);
check("unsorted input is sorted first", median([9, 1, 5]), 5);
check("single value", median([7]), 7);
check("nothing to average", median([]), null);

// The point of the null handling: a set where most leads were never replied to
// must not report a median reply time of zero.
check("nulls are skipped, not counted as zero", median([null, null, 10, 20, 30]), 20);
check("all null means no answer", median([null, null]), null);
check("undefined is treated like null", median([undefined, 4, 6]), 4);
check("a real zero still counts", median([0, 0, 5]), 0);

// Sorting must be numeric: the default sort is lexicographic and would put
// 100 before 9.
check("sorts numerically, not as text", median([9, 100, 80]), 80);

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
