import { tokenFor } from "./auth";

/**
 * Who is actually using Chat.
 *
 * Not the question the comms ingest answers. That keeps only messages it could
 * attach to a client, so it cannot tell somebody who never opens Chat from
 * somebody who lives in it but only talks to colleagues -- both come back as
 * nothing at all. The domain audit log counts every message either way, which
 * is the difference between measuring adoption and measuring client contact.
 *
 * Google answers this only for an administrator, which is why it is the one
 * read in this codebase that does not act as the person being read.
 */

export type ChatActivity = {
  email: string;
  messages: number;
  lastActive: string | null;
};

export type ActivityReport = {
  people: ChatActivity[];
  from: string;
  /** True when the ceiling below was hit, so the counts are floors. */
  truncated: boolean;
  problem: string | null;
};

type Activity = {
  actor?: { email?: string };
  id?: { time?: string };
};

/*
 * A page at a time, and a ceiling on the pages.
 *
 * A busy domain holds hundreds of thousands of these, and the ingest already
 * learned what happens when a Google sweep outruns the function timeout: the
 * browser reports it as the page failing to load, which reads as a crash
 * rather than a long read. Saying the count is partial beats returning nothing.
 */
const PAGE = 1000;
const MAX_PAGES = 20;

export async function chatActivityByPerson(days = 30): Promise<ActivityReport> {
  const subject = process.env.GOOGLE_ADMIN_SUBJECT;
  const from = new Date(Date.now() - days * 86_400_000).toISOString();

  if (!subject) {
    return {
      people: [],
      from,
      truncated: false,
      problem:
        "GOOGLE_ADMIN_SUBJECT is not set. The Reports API answers only for an " +
        "administrator, so this needs the address of one to act as.",
    };
  }

  let token: string;
  try {
    token = await tokenFor("reports", subject);
  } catch (e) {
    return {
      people: [],
      from,
      truncated: false,
      problem: e instanceof Error ? e.message : "No reports token",
    };
  }

  const counts = new Map<string, { messages: number; lastActive: string | null }>();
  let pageToken: string | undefined;
  let pages = 0;

  do {
    const url = new URL(
      "https://admin.googleapis.com/admin/reports/v1/activity/users/all/applications/chat"
    );
    url.searchParams.set("startTime", from);
    url.searchParams.set("maxResults", String(PAGE));
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

    if (!res.ok) {
      // Whatever was counted before the refusal is still true, so it is kept.
      return {
        people: [...counts].map(([email, v]) => ({ email, ...v })),
        from,
        truncated: true,
        problem: `${res.status} ${(await res.text()).slice(0, 300)}`,
      };
    }

    const body = (await res.json()) as { items?: Activity[]; nextPageToken?: string };

    for (const item of body.items ?? []) {
      const email = item.actor?.email;
      if (!email) continue;
      const at = item.id?.time ?? null;
      const seen = counts.get(email);
      if (seen) {
        seen.messages += 1;
        if (at && (!seen.lastActive || at > seen.lastActive)) seen.lastActive = at;
      } else {
        counts.set(email, { messages: 1, lastActive: at });
      }
    }

    pageToken = body.nextPageToken;
    pages += 1;
  } while (pageToken && pages < MAX_PAGES);

  return {
    people: [...counts]
      .map(([email, v]) => ({ email, ...v }))
      .sort((a, b) => b.messages - a.messages),
    from,
    truncated: Boolean(pageToken),
    problem: null,
  };
}
