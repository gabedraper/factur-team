/**
 * node --experimental-strip-types lib/gaib/repair.test.ts
 *
 * Pinned down because the failure it prevents is permanent and silent: one
 * interrupted turn and every later message in that conversation is refused,
 * with an error that blames the conversation rather than explaining it.
 */
import { repairDanglingToolCalls as repair } from "./repair.ts";

let failed = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.log(`FAIL ${label}\n  got  ${JSON.stringify(got)}`); }
  else console.log(`ok   ${label}`);
}

const call = (id: string) => ({ type: "tool_use", id, name: "query_data", input: {} });
const result = (id: string) => ({ type: "tool_result", tool_use_id: id, content: "fine" });

// Every call answered: untouched.
const healthy = [
  { role: "user", content: "hello" },
  { role: "assistant", content: [call("a")] },
  { role: "user", content: [result("a")] },
];
check("a complete turn is left alone", repair(structuredClone(healthy)).length, 3);

// The real case: a call, then a plain typed message.
const broken = [
  { role: "assistant", content: [call("a")] },
  { role: "user", content: "any update?" },
];
const fixed = repair(structuredClone(broken));
check("a dangling call gets an answer", fixed.length, 3);
check("the answer comes before the typed message",
  (fixed[1].content as { type: string }[])[0].type, "tool_result");
check("it is marked as failed",
  (fixed[1].content as { is_error?: boolean }[])[0].is_error, true);
check("what they typed still follows", fixed[2].content, "any update?");

// A call left at the very end, with nothing after it at all.
const trailing = [{ role: "assistant", content: [call("z")] }];
const trailingFixed = repair(structuredClone(trailing));
check("a call at the end gets an answer", trailingFixed.length, 2);
check("that answer is a tool result",
  (trailingFixed[1].content as { type: string }[])[0].type, "tool_result");

// Two calls, only one answered.
const partial = [
  { role: "assistant", content: [call("a"), call("b")] },
  { role: "user", content: [result("a")] },
];
const partialFixed = repair(structuredClone(partial));
check("only the unanswered one is filled",
  (partialFixed[1].content as { tool_use_id: string }[]).map((b) => b.tool_use_id).sort(),
  ["a", "b"]);

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
