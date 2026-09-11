#!/usr/bin/env node
/**
 * The design system, enforced.
 *
 * CLAUDE.md asks nicely. This fails the build. Without it every count below
 * grows while the retrofit is shrinking it -- and several sessions, including
 * automated ones, commit to this repo.
 *
 * It is a RATCHET, not a ban. There are dozens of old violations, and a check
 * that failed on all of them would block every deploy on day one. So:
 *
 *   - a file already in the baseline may keep its current count, and no more
 *   - a file not in the baseline may have none
 *   - a count that goes down is celebrated, and `--update` locks it in so it
 *     cannot creep back
 *
 * New work must comply. Old work can only get better.
 *
 * A genuine exception -- the login page is deliberately single-theme and uses
 * literal colours -- is marked on the line, or the line above, with
 *   design-ok: <why>
 * The reason is required. An exception nobody can explain is just a violation.
 *
 *   node scripts/design-check.mjs            check (runs in prebuild)
 *   node scripts/design-check.mjs --update   accept current counts as baseline
 *   node scripts/design-check.mjs --update <file>...
 *                                            the same, for those files only --
 *                                            safe while other sessions have
 *                                            unfinished work in the folder
 *   node scripts/design-check.mjs --report   per-rule totals, no failure
 *   node scripts/design-check.mjs --staged   only what the next commit holds
 *                                            (the pre-commit hook)
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = new URL("..", import.meta.url).pathname;
const BASELINE = join(ROOT, "scripts", "design-baseline.json");

/*
 * Each rule says what it catches and what to use instead -- the second half is
 * the part that matters, because an error that only says "no" teaches nothing.
 */
const RULES = [
  {
    id: "bare-table",
    test: /<table[\s>]/,
    fix: "Use <Table> from @/components/ui/table, wrapped in <TableScroll>.",
  },
  {
    id: "raw-shadow",
    // Tailwind's own shadows are tuned for a white page and stay black in dark
    // mode, where there is nothing darker to cast onto.
    test: /\bshadow-(?:sm|md|lg|xl|2xl)\b/,
    fix: "Use shadow-raised, shadow-overlay or shadow-modal -- they are defined per theme.",
  },
  {
    id: "bg-white",
    test: /\bbg-white\b/,
    fix: "Use bg-card or bg-background. White is wrong in dark mode.",
  },
  {
    id: "hex-colour",
    // A literal colour inside a class name: bg-[#fff], text-[#323cd0].
    test: /\b(?:bg|text|border|ring|fill|stroke|from|to|via)-\[#[0-9a-fA-F]{3,8}\]/,
    fix: "Use a colour token (bg-primary, text-muted-foreground...). Literals ignore the theme.",
  },
  {
    id: "card-recipe",
    test: /\brounded-(?:md|lg) border bg-card\b/,
    fix: "Use <Surface> from @/components/ui/surface. Sections carry no border.",
  },
  {
    id: "hand-h1",
    test: /<h1\s+className=/,
    fix: "Use <PageHeader> from @/components/ui/page-header.",
  },
];

/*
 * Where the rules do not apply: the primitives are what define these patterns,
 * and the reference page exists to show them. Everything else is checked.
 */
const EXEMPT = [
  "components/ui/",
  "app/(dashboard)/settings/design/",
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

const mode = process.argv[2];
const STAGED = mode === "--staged";

function git(...args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

/*
 * The files to check, as [path, read]. Normally that is the working folder.
 * With --staged it is only what the commit being made will contain: several
 * sessions share this folder, and one session's unfinished file must not
 * refuse another session's commit. Untracked files are skipped, and a file
 * with unstaged edits is read as it stands in the index.
 */
function sources() {
  if (!STAGED) {
    return ["app", "components"]
      .flatMap((base) => (existsSync(join(ROOT, base)) ? walk(join(ROOT, base)) : []))
      .map((file) => [relative(ROOT, file).split(sep).join("/"), () => readFileSync(file, "utf8")]);
  }
  const unstaged = new Set(git("diff", "--name-only", "-z").split("\0"));
  return git("ls-files", "-z", "--", "app/*.tsx", "components/*.tsx")
    .split("\0")
    .filter(Boolean)
    .map((rel) => [rel, () => (unstaged.has(rel) ? git("show", `:${rel}`) : readFileSync(join(ROOT, rel), "utf8"))]);
}

function scan() {
  const counts = {};
  for (const [rel, read] of sources()) {
    if (EXEMPT.some((e) => rel.startsWith(e))) continue;

    const lines = read().split("\n");
    lines.forEach((line, i) => {
      // An exception needs a reason. "design-ok" alone does not count.
      const marked = /design-ok:\s*\S/.test(line) || /design-ok:\s*\S/.test(lines[i - 1] ?? "");
      if (marked) return;
      for (const rule of RULES) {
        if (rule.test.test(line)) {
          counts[rel] ??= {};
          counts[rel][rule.id] = (counts[rel][rule.id] ?? 0) + 1;
        }
      }
    });
  }
  return counts;
}

const now = scan();

if (mode === "--report") {
  const totals = {};
  for (const rules of Object.values(now)) {
    for (const [id, n] of Object.entries(rules)) totals[id] = (totals[id] ?? 0) + n;
  }
  const files = {};
  for (const rules of Object.values(now)) for (const id of Object.keys(rules)) files[id] = (files[id] ?? 0) + 1;
  console.log("Design violations still in the app\n");
  for (const r of RULES) {
    console.log(`  ${r.id.padEnd(14)} ${String(totals[r.id] ?? 0).padStart(4)} uses in ${String(files[r.id] ?? 0).padStart(3)} files`);
  }
  process.exit(0);
}

const only = mode === "--update" ? process.argv.slice(3) : [];

if (mode === "--update") {
  /*
   * With file names, only those entries change and only downwards: it locks in
   * a retrofit without rescanning anybody else's half-finished edits into the
   * baseline. A file that has gone or come clean loses its entry.
   */
  let next = now;
  if (only.length) {
    const prev = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : {};
    next = { ...prev };
    for (const f of only) {
      if (!prev[f]) continue;
      const lowered = Object.fromEntries(
        Object.entries(prev[f])
          .map(([id, n]) => [id, Math.min(n, now[f]?.[id] ?? 0)])
          .filter(([, n]) => n > 0),
      );
      if (Object.keys(lowered).length) next[f] = lowered;
      else delete next[f];
    }
  }
  // Sorted so the baseline diffs cleanly and a shrinking count is easy to see.
  const sorted = Object.fromEntries(
    Object.keys(next).sort().map((f) => [f, Object.fromEntries(Object.entries(next[f]).sort())]),
  );
  writeFileSync(BASELINE, JSON.stringify(sorted, null, 2) + "\n");
  const n = Object.values(sorted).reduce((a, r) => a + Object.values(r).reduce((x, y) => x + y, 0), 0);
  console.log(`Baseline written: ${n} existing violations across ${Object.keys(sorted).length} files.`);
  process.exit(0);
}

function loadBaseline() {
  // A commit is checked against the baseline it will carry, not the one on disk.
  if (STAGED) {
    try {
      return JSON.parse(git("show", ":scripts/design-baseline.json"));
    } catch {
      return {};
    }
  }
  return existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : {};
}

const baseline = loadBaseline();
const worse = [];
let improved = 0;

for (const [file, rules] of Object.entries(now)) {
  for (const [id, n] of Object.entries(rules)) {
    const allowed = baseline[file]?.[id] ?? 0;
    if (n > allowed) worse.push({ file, id, n, allowed });
  }
}
for (const [file, rules] of Object.entries(baseline)) {
  for (const [id, allowed] of Object.entries(rules)) {
    if ((now[file]?.[id] ?? 0) < allowed) improved++;
  }
}

if (worse.length) {
  const byId = Object.fromEntries(RULES.map((r) => [r.id, r]));
  console.error("\nDesign check failed -- new code has to use the shared components.\n");
  for (const w of worse) {
    const what = w.allowed ? `${w.n} uses, baseline allows ${w.allowed}` : `${w.n} new`;
    console.error(`  ${w.file}\n    ${w.id} (${what})\n    → ${byId[w.id].fix}\n`);
  }
  console.error("A genuine exception can be marked on the line with  design-ok: <reason>");
  console.error("See CLAUDE.md and /settings/design.\n");
  process.exit(1);
}

if (improved) {
  console.log(`Design check passed. ${improved} count${improved === 1 ? "" : "s"} went down --`);
  console.log(`run  npm run design:update -- <the files you changed>  to lock that in so it cannot come back.`);
} else {
  console.log("Design check passed.");
}
