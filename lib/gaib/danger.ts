/*
 * What a fix is not allowed to touch on its own.
 *
 * Gaib reads a complaint and proposes a lane. That judgement is useful and it
 * is not a safety mechanism -- it is a language model's opinion about code it
 * has not written yet. The actual rule is here, it is a list of paths, and it
 * runs against the diff the agent really produced rather than against anyone's
 * intention. A fix that set out to change a button label and ended up inside a
 * migration loses its auto lane at that moment, silently and without argument.
 *
 * The list is deliberately blunt. Every entry is something where a wrong change
 * is either invisible until it has already done harm (permissions, money) or
 * reaches somebody outside the company before a person could catch it (sending
 * mail, the public pages). Being blunt costs a few pull requests that did not
 * need to be pull requests. The alternative costs something that cannot be got
 * back.
 */

export type Guard = { pattern: string; why: string };

export const DANGER: Guard[] = [
  /*
   * The agent's own rails. First on the list because it is the only entry that
   * protects the rest of the list: an agent that can edit this file can grant
   * itself anything below it, and it would do so with an entirely reasonable
   * commit message.
   */
  { pattern: "lib/gaib/**", why: "Gaib's own rules" },
  { pattern: "app/api/gaib/**", why: "Gaib's own endpoints" },
  { pattern: ".github/**", why: "the workflow that runs the agent" },

  // Schema. Reversible only in the sense that a second migration exists.
  { pattern: "supabase/**", why: "database schema and policies" },

  // Who is allowed in and what they can see. Failures here are quiet.
  { pattern: "middleware.ts", why: "route protection" },
  { pattern: "lib/supabase/**", why: "session and service-role clients" },
  { pattern: "app/(auth)/**", why: "sign-in" },
  { pattern: "app/auth/**", why: "sign-in callback" },
  { pattern: "lib/org.ts", why: "permissions" },
  { pattern: "lib/org-roles.ts", why: "role definitions" },
  { pattern: "lib/roles.ts", why: "role definitions" },
  { pattern: "actions/auth.ts", why: "sign-in" },
  { pattern: "actions/admin.ts", why: "granting access" },
  { pattern: "actions/org.ts", why: "granting access" },

  // Money, and the numbers people are measured by.
  { pattern: "actions/billing.ts", why: "billing" },
  { pattern: "actions/collections.ts", why: "chasing customers for money" },
  { pattern: "lib/collections/**", why: "chasing customers for money" },
  { pattern: "actions/quickbooks-links.ts", why: "accounting links" },
  { pattern: "lib/scoreboard/**", why: "how people are scored" },
  { pattern: "actions/scoreboard.ts", why: "how people are scored" },

  /*
   * Anything that can put words in front of somebody outside the company.
   * A cosmetic change to a template is still a change to what a customer
   * receives, and it arrives before anyone has looked at it.
   */
  { pattern: "lib/email/**", why: "outbound email" },
  { pattern: "lib/google/**", why: "reaching Google on staff's behalf" },
  { pattern: "lib/ingest/**", why: "reading staff mail and chat" },
  { pattern: "lib/sequences.ts", why: "automated sending" },
  { pattern: "actions/sequences.ts", why: "automated sending" },
  { pattern: "actions/nps*.ts", why: "customer surveys" },
  { pattern: "lib/nps/**", why: "customer surveys" },
  { pattern: "actions/talent-mail.ts", why: "outbound email to candidates" },
  { pattern: "actions/talent-engage.ts", why: "outbound contact with candidates" },

  // Pages a customer or candidate can reach without signing in.
  { pattern: "app/careers/**", why: "public careers site" },
  { pattern: "app/portal/**", why: "customer portal" },
  { pattern: "app/nps/**", why: "public survey pages" },

  // Build and dependency changes, which fail in ways a green build won't show.
  { pattern: "package.json", why: "dependencies" },
  { pattern: "package-lock.json", why: "dependencies" },
  { pattern: "next.config.mjs", why: "build configuration" },
  { pattern: "tsconfig.json", why: "build configuration" },
];

/*
 * A fix that is large is not a small fix, whatever it touched.
 *
 * These two numbers catch the case the path list cannot: a change that stayed
 * entirely inside safe files and still rewrote half the application. There is
 * nothing magic about the values -- they are set where a diff stops being
 * something a person could check at a glance, because that is the only
 * property that matters for shipping without one.
 */
export const AUTO_MAX_FILES = 6;
export const AUTO_MAX_LINES = 250;

/** A glob with `*` (within a segment) and `**` (across segments). */
function toRegExp(pattern: string): RegExp {
  const META = ".+^${}()|[]\\?";
  let out = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "*" && pattern[i + 1] === "*") {
      // `a/**/b` crosses any number of directories, including none.
      if (pattern[i + 2] === "/") {
        out += "(?:[^/]+/)*";
        i += 3;
      } else {
        out += ".*";
        i += 2;
      }
    } else if (ch === "*") {
      out += "[^/]*";
      i += 1;
    } else {
      out += META.includes(ch) ? `\\${ch}` : ch;
      i += 1;
    }
  }
  return new RegExp(`^${out}$`);
}

const COMPILED = DANGER.map((g) => ({ ...g, re: toRegExp(g.pattern) }));

export type GuardVerdict =
  | { safe: true }
  | { safe: false; reason: string };

/**
 * Whether a diff may ship without a person looking at it.
 *
 * `paths` are repo-relative, as `git diff --name-only` gives them. Returns the
 * reason rather than a bare false, because the reason is what goes on the
 * ticket and what the person reviewing it reads first.
 */
export function checkDiff(
  paths: string[],
  changedLines: number
): GuardVerdict {
  const hits: string[] = [];
  for (const path of paths) {
    const hit = COMPILED.find((g) => g.re.test(path));
    if (hit) hits.push(`${path} (${hit.why})`);
  }
  if (hits.length) {
    return {
      safe: false,
      reason: `Touches protected paths: ${hits.join("; ")}`,
    };
  }
  if (paths.length > AUTO_MAX_FILES) {
    return {
      safe: false,
      reason: `Changes ${paths.length} files, over the ${AUTO_MAX_FILES} allowed without review`,
    };
  }
  if (changedLines > AUTO_MAX_LINES) {
    return {
      safe: false,
      reason: `Changes ${changedLines} lines, over the ${AUTO_MAX_LINES} allowed without review`,
    };
  }
  return { safe: true };
}
