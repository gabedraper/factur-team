/**
 * There is no test runner in this project, so this file runs itself:
 *
 *   node --experimental-strip-types lib/sort.test.ts
 *
 * Worth keeping because the rules it pins down are the ones that look right
 * until you try them -- blanks staying at the bottom when the sort flips, ties
 * not shuffling, and zero counting as a value rather than an empty cell.
 */
import { sortRows, nextSort, compare } from "./sort.ts";

let failed = 0;
function check(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { failed++; console.log(`FAIL ${label}\n  got  ${g}\n  want ${w}`); }
  else console.log(`ok   ${label}`);
}

const names = [{ n: "carol" }, { n: "Alice" }, { n: null }, { n: "bob" }, { n: "" }];
check("text asc, blanks last",
  sortRows(names, (r) => r.n, "asc").map((r) => r.n), ["Alice", "bob", "carol", null, ""]);
check("text desc, blanks STILL last",
  sortRows(names, (r) => r.n, "desc").map((r) => r.n), ["carol", "bob", "Alice", null, ""]);

const nums = [{ v: 10 }, { v: 2 }, { v: null }, { v: 0 }];
check("numbers sort numerically, not as text",
  sortRows(nums, (r) => r.v, "asc").map((r) => r.v), [0, 2, 10, null]);
check("zero is a value, not a blank",
  sortRows(nums, (r) => r.v, "desc").map((r) => r.v), [10, 2, 0, null]);

check("booleans: false before true",
  sortRows([{ b: true }, { b: false }], (r) => r.b, "asc").map((r) => r.b), [false, true]);

check("'Phase 10' after 'Phase 9'",
  sortRows([{ s: "Phase 10" }, { s: "Phase 9" }], (r) => r.s, "asc").map((r) => r.s),
  ["Phase 9", "Phase 10"]);

// Ties keep their incoming order in both directions.
const ties = [{ id: 1, g: "a" }, { id: 2, g: "a" }, { id: 3, g: "a" }];
check("ties are stable asc", sortRows(ties, (r) => r.g, "asc").map((r) => r.id), [1, 2, 3]);
check("ties are stable desc", sortRows(ties, (r) => r.g, "desc").map((r) => r.id), [1, 2, 3]);

const src = [{ n: "b" }, { n: "a" }];
sortRows(src, (r) => r.n, "asc");
check("input array is not mutated", src.map((r) => r.n), ["b", "a"]);

check("first click -> asc", nextSort(null, "name"), { key: "name", dir: "asc" });
check("second click -> desc", nextSort({ key: "name", dir: "asc" }, "name"), { key: "name", dir: "desc" });
check("third click -> off", nextSort({ key: "name", dir: "desc" }, "name"), null);
check("different column starts at asc",
  nextSort({ key: "name", dir: "desc" }, "role"), { key: "role", dir: "asc" });

check("case does not split names", Math.sign(compare("alice", "Alice")), 0);

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
