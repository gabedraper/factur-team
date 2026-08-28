/**
 * There is no test runner in this project, so this file runs itself:
 *
 *   node --experimental-strip-types lib/gaib/danger.test.ts
 *
 * This is the one part of Gaib worth pinning down by hand. Everything else
 * fails visibly -- a broken chat does not answer, a broken ticket does not
 * appear. A guard that silently stops matching keeps returning "safe" and
 * nothing looks wrong until an agent has already pushed to main.
 */
import { checkDiff, AUTO_MAX_FILES, AUTO_MAX_LINES } from "./danger.ts";

let failed = 0;
function check(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { failed++; console.log(`FAIL ${label}\n  got  ${g}\n  want ${w}`); }
  else console.log(`ok   ${label}`);
}

const safe = (paths: string[], lines = 10) => checkDiff(paths, lines).safe;

// The ordinary case the auto lane exists for.
check("plain component edit is safe", safe(["components/talent/board.tsx"]), true);
check("a page edit is safe", safe(["app/(dashboard)/talent/page.tsx"]), true);
check("a safe action is safe", safe(["actions/courses.ts"]), true);

// Directory globs.
check("migration blocked", safe(["supabase/migrations/20260101_x.sql"]), false);
check("google lib blocked", safe(["lib/google/chat.ts"]), false);
check("public careers blocked", safe(["app/careers/[slug]/page.tsx"]), false);
check("portal blocked", safe(["app/portal/[token]/page.tsx"]), false);

// Parentheses in a route group must not be read as a regex group.
check("auth route group blocked", safe(["app/(auth)/login/page.tsx"]), false);
check("dashboard route group still safe", safe(["app/(dashboard)/settings/page.tsx"]), true);

// Exact files, and near-misses that must NOT match.
check("middleware blocked", safe(["middleware.ts"]), false);
check("lib/org.ts blocked", safe(["lib/org.ts"]), false);
check("lib/org-roles.ts blocked", safe(["lib/org-roles.ts"]), false);
check("a different lib file is safe", safe(["lib/utils.ts"]), true);
check("nested middleware is not the middleware", safe(["components/middleware.ts"]), true);

// Single-star inside a segment.
check("nps action blocked", safe(["actions/nps-sequence.ts"]), false);
check("nps.ts blocked", safe(["actions/nps.ts"]), false);
check("npm-ish name not caught by nps*", safe(["actions/progress.ts"]), true);

// Gaib must never be able to edit its own rails.
check("gaib lib blocked", safe(["lib/gaib/danger.ts"]), false);
check("gaib api blocked", safe(["app/api/gaib/chat/route.ts"]), false);
check("workflow blocked", safe([".github/workflows/gaib.yml"]), false);

// Size limits, independent of path.
const many = Array.from({ length: AUTO_MAX_FILES + 1 }, (_, i) => `components/a${i}.tsx`);
check("too many files blocked", safe(many), false);
check("exactly the limit is fine", safe(many.slice(0, AUTO_MAX_FILES)), true);
check("too many lines blocked", safe(["components/a.tsx"], AUTO_MAX_LINES + 1), false);
check("exactly the line limit is fine", safe(["components/a.tsx"], AUTO_MAX_LINES), true);

// The reason has to name the file, because it is what lands on the ticket.
const verdict = checkDiff(["supabase/migrations/x.sql"], 5);
check("reason names the path",
  verdict.safe === false && verdict.reason.includes("supabase/migrations/x.sql"), true);

// A safe file alongside a dangerous one is still dangerous.
check("mixed diff blocked", safe(["components/ok.tsx", "lib/org.ts"]), false);

// ---------------------------------------------------------------------------
// Overrides from Settings. The whole point is that they only ever tighten.
// ---------------------------------------------------------------------------

const withOpts = (paths: string[], lines: number, o: Parameters<typeof checkDiff>[2]) =>
  checkDiff(paths, lines, o).safe;

check("settings can lower the file cap",
  withOpts(["a.tsx", "b.tsx", "c.tsx"], 10, { maxFiles: 2 }), false);
check("settings cannot raise the file cap",
  withOpts(Array.from({ length: AUTO_MAX_FILES + 1 }, (_, i) => `c${i}.tsx`), 10,
    { maxFiles: 999 }), false);
check("settings can lower the line cap",
  withOpts(["a.tsx"], 100, { maxLines: 50 }), false);
check("settings cannot raise the line cap",
  withOpts(["a.tsx"], AUTO_MAX_LINES + 1, { maxLines: 99999 }), false);
check("settings can add a protected path",
  withOpts(["components/talent/board.tsx"], 10,
    { extraPaths: ["components/talent/**"] }), false);
check("added paths do not remove the built-in ones",
  withOpts(["lib/org.ts"], 10, { extraPaths: ["nothing/**"] }), false);
check("overrides absent behaves as before",
  withOpts(["components/ok.tsx"], 10, {}), true);

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
