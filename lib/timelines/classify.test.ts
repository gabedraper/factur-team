/**
 * Run with: node --experimental-strip-types lib/timelines/classify.test.ts
 *
 * Every Prospecting Lead Status below was taken from live data -- the current
 * value on the opportunity and every value the change history moves through.
 * If Salesforce gains a new one, this is where it will show up as "other".
 */
import { readFileSync } from "node:fs";
import { prospectingBucket, prospectingOutcomeFor, classify, PROSPECTING_KEY } from "./classify.ts";

let failed = 0;
function check(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { failed++; console.log(`FAIL ${label}\n  got  ${g}\n  want ${w}`); }
  else console.log(`ok   ${label}`);
}

// value -> its own lane colour. Each status gets one rather than sharing a
// bucket, so a lane reads as the exact value on the record.
const buckets: [string, string][] = [
  ["Pipeline - Cold", "pls-cold"],
  ["Pipeline - Warm SDR", "pls-warm-sdr"],
  ["Pipeline - Warm", "pls-warm"],
  ["Pipeline - Selling", "pls-selling"],
  ["Closing", "pls-closing"],
  ["LTFU", "pls-ltfu"],
  ["Customer", "pls-customer"],
  ["Relationship", "pls-relationship"],
  ["Lost Follow Up", "pls-lost"],
  ["No Fit Ever - Contact", "pls-nofit-contact"],
  ["No Fit Ever - Account", "pls-nofit-account"],
];
for (const [status, bucket] of buckets) {
  check(`bucket: ${status}`, prospectingBucket(status), bucket);
}

// "Pipeline - Warm" and "Pipeline - Warm SDR" differ only by a suffix; a loose
// match on "Warm" would give them the same colour.
check("near-identical values stay apart",
  prospectingBucket("Pipeline - Warm") !== prospectingBucket("Pipeline - Warm SDR"), true);
check("an unknown value does not borrow another status's colour",
  prospectingBucket("Something New"), "pls-other");

// A colour with no CSS variable behind it draws as nothing at all, which is
// the failure mode you would not notice until a lane came out blank.
const css = readFileSync(new URL("../../app/(dashboard)/timelines/timelines.css", import.meta.url), "utf8");
for (const [, bucket] of [...PROSPECTING_KEY, ["", "pls-other"] as [string, string]]) {
  check(`--st-${bucket} is defined`, css.includes(`--st-${bucket}:`), true);
}
check("the key offers every status", PROSPECTING_KEY.length, buckets.length);

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
