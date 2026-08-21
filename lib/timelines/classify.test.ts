/**
 * Run with: node --experimental-strip-types lib/timelines/classify.test.ts
 *
 * Every Prospecting Lead Status below was taken from live data -- the current
 * value on the opportunity and every value the change history moves through.
 * If Salesforce gains a new one, this is where it will show up as "other".
 */
import { prospectingBucket, prospectingOutcomeFor, classify } from "./classify.ts";

let failed = 0;
function check(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { failed++; console.log(`FAIL ${label}\n  got  ${g}\n  want ${w}`); }
  else console.log(`ok   ${label}`);
}

// value -> lane colour bucket. Every bucket named here has a --st-* colour.
const buckets: [string, string][] = [
  ["LTFU", "ltfu"],
  ["Pipeline - Warm", "warm"],
  ["Pipeline - Warm SDR", "warm"],
  ["Pipeline - Cold", "cold"],
  ["No Fit Ever - Account", "dead"],
  ["No Fit Ever - Contact", "dead"],
  ["Lost Follow Up", "dead"],
  ["Pipeline - Selling", "hot"],
  ["Closing", "hot"],
  ["Customer", "generated"],
  ["Relationship", "other"],
];
for (const [status, bucket] of buckets) {
  check(`bucket: ${status}`, prospectingBucket(status), bucket);
}

// The label is always the Salesforce value, untouched. What a lead going quiet
// changes is the colour and which bucket it is counted in, not what it is
// called -- the sales team reads this field in Salesforce all day.
for (const [status] of buckets) {
  check(`label is verbatim: ${status}`, prospectingOutcomeFor(status, "", 1, null).label, status);
  check(`still verbatim when quiet: ${status}`, prospectingOutcomeFor(status, "", 90, null).label, status);
}

check("open and quiet counts as gone quiet",
  prospectingOutcomeFor("Pipeline - Selling", "", 40, null).key, "cold");
check("open and active does not",
  prospectingOutcomeFor("Pipeline - Selling", "", 1, null).key, "hot");
check("a dead end is not 'gone quiet', it is finished",
  prospectingOutcomeFor("No Fit Ever - Account", "", 90, null).key, "dq_company");
check("nor is a customer",
  prospectingOutcomeFor("Customer", "", 90, null).key, "won");

// The handful of sales-team records that never entered the prospecting
// pipeline still have a Stage, and should read from it rather than blank out.
check("blank status falls back to Stage",
  prospectingOutcomeFor(null, "Prospecting: Warm Referral", 1, null).label, "Referred on");

// The change history the lane is drawn from.
check("status change is recognised",
  classify({ id: "1", subject: "Field Change Prospecting Lead Status: Closing", tasksubtype: null, calltype: null }),
  ["status_change", "Closing"]);
check("a cleared status is not a change to nothing",
  classify({ id: "2", subject: "Field Change Prospecting Lead Status:", tasksubtype: null, calltype: null })[0],
  "other");

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
