/*
 * The guard, from the workflow's point of view.
 *
 *   git diff --name-only HEAD | node --experimental-strip-types lib/gaib/guard-cli.ts <changed-lines>
 *
 * Prints {"safe":true} or {"safe":false,"reason":"..."} and nothing else, so
 * the workflow can read it with jq without having to care how the rule works.
 *
 * This file sits in lib/gaib deliberately. Everything under that path is on the
 * protected list, which means the agent cannot rewrite the thing that judges
 * it -- put this in scripts/ and a sufficiently determined fix could widen its
 * own permission on the way past, with a diff that looked like tidying up.
 */
import { checkDiff } from "./danger.ts";

const changedLines = Number(process.argv[2] ?? "0");

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  const paths = input.split("\n").map((l) => l.trim()).filter(Boolean);

  // No paths means nothing was changed. That is not "safe to ship", it is a
  // run that did nothing, and the workflow has to be able to tell them apart.
  if (!paths.length) {
    console.log(JSON.stringify({ safe: false, reason: "The agent changed nothing." }));
    return;
  }

  console.log(JSON.stringify(checkDiff(paths, changedLines)));
});
