import { tokenFor } from "./auth";

/**
 * When each person last used Gmail, Drive, Docs and Chat.
 *
 * The audit log next door cannot answer this. It records events, and Gmail
 * emits none -- there is no per-person Gmail activity in it to read. The usage
 * report is the only place these four sit in the same shape, which is what
 * makes one table across all of them possible.
 *
 * Google reports usage for a *date*, not a range, and each row already carries
 * a "last used" timestamp. So this is one call for one recent day, not thirty
 * calls stitched together.
 */

export type AppUsage = {
  email: string;
  gmail: string | null;
  drive: string | null;
  docs: string | null;
  chat: string | null;
  lastLogin: string | null;
};

export type UsageReport = {
  people: AppUsage[];
  /** The day Google actually had data for, which is not today. */
  date: string | null;
  /**
   * Every parameter name Google returned. Kept because the mapping below is
   * built on names that Google adds to and renames between editions, and a
   * column silently reading empty is worse than one that can be explained.
   */
  seen: string[];
  problem: string | null;
};

type Param = {
  name?: string;
  intValue?: string;
  stringValue?: string;
  datetimeValue?: string;
  boolValue?: boolean;
};

type Report = {
  entity?: { userEmail?: string };
  parameters?: Param[];
};

function value(p: Param): string | null {
  if (p.datetimeValue) return p.datetimeValue;
  if (p.stringValue) return p.stringValue;
  if (p.intValue) return p.intValue;
  if (typeof p.boolValue === "boolean") return String(p.boolValue);
  return null;
}

/*
 * Chosen by prefix rather than by exact name.
 *
 * The parameter list differs by Workspace edition and Google adds to it, so
 * pinning exact names means a column that is empty on some domains and full on
 * others with nothing to say why. First match wins, most specific first.
 *
 * Docs has no application of its own -- Google files editor activity under
 * Drive -- so it is picked out of the Drive parameters instead.
 */
const COLUMNS: Record<keyof Omit<AppUsage, "email">, string[]> = {
  gmail: ["gmail:last_interaction_time", "gmail:last_access_time", "gmail:"],
  drive: ["drive:last_interaction_time", "drive:last_access_time", "drive:"],
  docs: [
    "docs:last_interaction_time",
    "drive:num_google_documents_created",
    "drive:num_owned_google_documents_created",
  ],
  chat: ["chat:last_interaction_time", "chat:last_active_time", "chat:"],
  lastLogin: ["accounts:last_login_time"],
};

function pick(params: Param[], candidates: string[]): string | null {
  for (const want of candidates) {
    // An exact name first, so a prefix fallback never shadows a real match.
    const exact = params.find((p) => p.name === want);
    if (exact) return value(exact);
  }
  for (const want of candidates) {
    if (!want.endsWith(":")) continue;
    const near = params.find(
      (p) => p.name?.startsWith(want) && /last_(interaction|access|active)/.test(p.name)
    );
    if (near) return value(near);
  }
  return null;
}

const LAG_DAYS = 6;

export async function workspaceUsage(): Promise<UsageReport> {
  const subject = process.env.GOOGLE_ADMIN_SUBJECT;
  if (!subject) {
    return {
      people: [], date: null, seen: [],
      problem:
        "GOOGLE_ADMIN_SUBJECT is not set. The Reports API answers only for an " +
        "administrator, so this needs the address of one to act as.",
    };
  }

  let token: string;
  try {
    token = await tokenFor("usage", subject);
  } catch (e) {
    return {
      people: [], date: null, seen: [],
      problem: e instanceof Error ? e.message : "No usage token",
    };
  }

  /*
   * Walk backwards until a day has data.
   *
   * Usage reports lag by a couple of days and the exact lag moves. Asking for
   * today reliably returns an empty report, which looks identical to a domain
   * where nobody used anything -- so an empty day is treated as "not ready
   * yet" and the day before is tried instead.
   */
  let lastProblem: string | null = null;

  for (let back = 1; back <= LAG_DAYS; back += 1) {
    const day = new Date(Date.now() - back * 86_400_000).toISOString().slice(0, 10);
    const rows: Report[] = [];
    let pageToken: string | undefined;
    let failed: string | null = null;

    do {
      const url = new URL(
        `https://admin.googleapis.com/admin/reports/v1/usage/users/all/dates/${day}`
      );
      url.searchParams.set("maxResults", "1000");
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        failed = `${res.status} ${(await res.text()).slice(0, 300)}`;
        break;
      }

      const body = (await res.json()) as {
        usageReports?: Report[];
        nextPageToken?: string;
      };
      rows.push(...(body.usageReports ?? []));
      pageToken = body.nextPageToken;
    } while (pageToken);

    if (failed) {
      lastProblem = failed;
      // A refusal will not fix itself on an earlier date; only emptiness will.
      break;
    }

    if (!rows.length) continue;

    const seen = new Set<string>();
    const people = rows
      .map((r) => {
        const params = r.parameters ?? [];
        for (const p of params) if (p.name) seen.add(p.name);
        return {
          email: r.entity?.userEmail ?? "",
          gmail: pick(params, COLUMNS.gmail),
          drive: pick(params, COLUMNS.drive),
          docs: pick(params, COLUMNS.docs),
          chat: pick(params, COLUMNS.chat),
          lastLogin: pick(params, COLUMNS.lastLogin),
        };
      })
      .filter((p) => p.email);

    return { people, date: day, seen: [...seen].sort(), problem: null };
  }

  return {
    people: [], date: null, seen: [],
    problem: lastProblem ?? `No usage data in the last ${LAG_DAYS} days.`,
  };
}
