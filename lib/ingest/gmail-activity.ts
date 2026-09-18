import { createServiceClient } from "@/lib/supabase/server";
import { tokenFor } from "@/lib/google/auth";
import { collectText, type GmailPart } from "@/lib/google/gmail";

/*
 * Every Factur mailbox, both directions, bodies kept.
 *
 * The billing ingest reads a narrow subject search from a short list of
 * mailboxes and stores a snippet. This reads everything with an outside party
 * on it from every mailbox the app knows, and keeps the text, because the
 * point is to see what was said to a prospect and later to mine it.
 *
 * Each mailbox carries a Gmail history cursor. The first pass sweeps the last
 * BACKFILL_DAYS; after that each run asks Gmail only for what changed since
 * the cursor, which is a handful of calls a minute rather than a search. A
 * cursor Gmail no longer honours (they expire after about a week of silence)
 * falls back to a short sweep.
 *
 * One email, many mailboxes. The sender's copy and every internal recipient's
 * copy carry the same Message-ID, so the message is stored once, keyed on
 * that, with a row per mailbox copy so the body can be re-fetched from
 * whichever mailbox holds it.
 *
 * Left out on purpose: mail with nobody outside the company on it (two
 * colleagues talking), drafts, spam, chats, and Gmail's promotions, social and
 * forum categories. Flip WANTED_QUERY and isInternal() if that changes.
 */

export const OUR_DOMAINS = new Set(["facturmfg.com", "bethefactur.com"]);
const BACKFILL_DAYS = 14;
const FALLBACK_DAYS = 3;
const BACKFILL_CAP = 1500;
const BODY_CAP = 100_000;
const FETCH_BATCH = 12;
const WANTED_QUERY = "-in:chats -in:drafts -in:spam -in:trash -category:promotions -category:social -category:forums";
const UNWANTED_LABELS = new Set(["DRAFT", "SPAM", "TRASH", "CHAT", "CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_FORUMS"]);

export type MailboxReport = {
  mailbox: string;
  mode: "backfill" | "history" | "fallback" | "skipped";
  listed: number;
  fetched: number;
  stored: number;
  landed: number;
  problem: string | null;
  ms: number;
};

type Mailbox = { email: string; member_id: string | null; history_id: string | null; last_synced_at: string | null };

type Parsed = {
  rfcId: string;
  gmailId: string;
  threadId: string;
  occurredAt: Date;
  subject: string | null;
  snippet: string | null;
  fromEmail: string | null;
  fromName: string | null;
  to: string[];
  cc: string[];
  externals: string[];
  direction: "inbound" | "outbound" | "internal";
  labels: string[];
  inReplyTo: string | null;
  attachments: string[];
  bodyText: string;
};

function domainOf(email: string): string {
  return email.split("@")[1]?.toLowerCase() ?? "";
}

function addresses(value: string | null): string[] {
  if (!value) return [];
  return Array.from(value.matchAll(/[\w.+-]+@[\w-]+\.[\w.-]+/g)).map((m) => m[0].toLowerCase());
}

/** "Jane Doe <jane@x.com>" -> "Jane Doe"; a bare address -> null. */
function displayName(value: string | null): string | null {
  if (!value) return null;
  const m = value.match(/^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/);
  return m ? m[1].trim() || null : null;
}

async function gmail<T>(token: string, path: string, allow404 = false): Promise<T | null> {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404 && allow404) return null;
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gmail ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

async function listIds(token: string, query: string, cap: number): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const page = await gmail<{ messages?: { id: string }[]; nextPageToken?: string }>(
      token,
      `messages?q=${encodeURIComponent(query)}&maxResults=500${pageToken ? `&pageToken=${pageToken}` : ""}`
    );
    for (const m of page?.messages ?? []) ids.push(m.id);
    pageToken = page?.nextPageToken;
  } while (pageToken && ids.length < cap);
  return ids.slice(0, cap);
}

/** Message ids added since the cursor, or null when Gmail no longer has that history. */
async function historyIds(token: string, since: string): Promise<string[] | null> {
  const ids = new Set<string>();
  let pageToken: string | undefined;
  do {
    const page = await gmail<{
      history?: { messagesAdded?: { message: { id: string; labelIds?: string[] } }[] }[];
      nextPageToken?: string;
    }>(
      token,
      `history?startHistoryId=${since}&historyTypes=messageAdded&maxResults=500${pageToken ? `&pageToken=${pageToken}` : ""}`,
      true
    );
    if (page === null) return null;
    for (const h of page.history ?? []) {
      for (const a of h.messagesAdded ?? []) {
        if ((a.message.labelIds ?? []).some((l) => UNWANTED_LABELS.has(l))) continue;
        ids.add(a.message.id);
      }
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return [...ids];
}

function attachmentNames(part: GmailPart | undefined, out: string[] = []): string[] {
  if (!part) return out;
  const name = (part as { filename?: string }).filename;
  if (name) out.push(name);
  for (const p of part.parts ?? []) attachmentNames(p, out);
  return out;
}

async function fetchFull(token: string, id: string): Promise<Parsed | null> {
  const m = await gmail<{
    id: string; threadId: string; internalDate: string; snippet?: string; labelIds?: string[];
    payload?: GmailPart & { headers?: { name: string; value: string }[] };
  }>(token, `messages/${id}?format=full`, true);
  if (!m) return null;

  const labels = m.labelIds ?? [];
  if (labels.some((l) => UNWANTED_LABELS.has(l))) return null;

  const header = (name: string) =>
    m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;

  const rfcId = header("Message-ID");
  if (!rfcId) return null;

  const from = addresses(header("From"))[0] ?? null;
  const to = addresses(header("To"));
  const cc = addresses(header("Cc"));
  const all = Array.from(new Set([from, ...to, ...cc].filter((a): a is string => !!a)));
  const externals = all.filter((a) => !OUR_DOMAINS.has(domainOf(a)));
  const direction: Parsed["direction"] =
    externals.length === 0 ? "internal" : from && OUR_DOMAINS.has(domainOf(from)) ? "outbound" : "inbound";

  return {
    rfcId: rfcId.trim(),
    gmailId: m.id,
    threadId: m.threadId,
    occurredAt: new Date(Number(m.internalDate)),
    subject: header("Subject"),
    snippet: m.snippet?.slice(0, 400) ?? null,
    fromEmail: from,
    fromName: displayName(header("From")),
    to,
    cc,
    externals,
    direction,
    labels,
    inReplyTo: header("In-Reply-To"),
    attachments: attachmentNames(m.payload),
    bodyText: collectText(m.payload).slice(0, BODY_CAP),
  };
}

/** The person this email counts for: the sender when it is ours, else the first internal recipient, else the mailbox. */
function memberEmailFor(p: Parsed, mailbox: string): string {
  if (p.direction === "outbound" && p.fromEmail) return p.fromEmail;
  const internal = [...p.to, ...p.cc].find((a) => OUR_DOMAINS.has(domainOf(a)));
  return internal ?? mailbox;
}

async function syncMailbox(db: ReturnType<typeof createServiceClient>, box: Mailbox): Promise<MailboxReport> {
  const started = Date.now();
  const report: MailboxReport = { mailbox: box.email, mode: "skipped", listed: 0, fetched: 0, stored: 0, landed: 0, problem: null, ms: 0 };

  try {
    const token = await tokenFor("gmail", box.email);
    /* The cursor for next time is read before listing, so anything that
       arrives during this run is seen again next run rather than lost. */
    const profile = await gmail<{ historyId: string }>(token, "profile");
    const nextCursor = profile?.historyId ?? null;

    let ids: string[];
    if (!box.history_id) {
      report.mode = "backfill";
      ids = await listIds(token, `${WANTED_QUERY} newer_than:${BACKFILL_DAYS}d`, BACKFILL_CAP);
    } else {
      const fromHistory = await historyIds(token, box.history_id);
      if (fromHistory === null) {
        report.mode = "fallback";
        ids = await listIds(token, `${WANTED_QUERY} newer_than:${FALLBACK_DAYS}d`, BACKFILL_CAP);
      } else {
        report.mode = "history";
        ids = fromHistory;
      }
    }
    report.listed = ids.length;

    /* Copies already stored from this mailbox are not fetched again. */
    const known = new Set<string>();
    for (let i = 0; i < ids.length; i += 500) {
      const { data } = await db.from("email_message_copies").select("gmail_id").eq("mailbox", box.email).in("gmail_id", ids.slice(i, i + 500));
      for (const r of (data ?? []) as { gmail_id: string }[]) known.add(r.gmail_id);
    }
    const wanted = ids.filter((id) => !known.has(id));

    const parsed: Parsed[] = [];
    for (let i = 0; i < wanted.length; i += FETCH_BATCH) {
      const batch = await Promise.all(wanted.slice(i, i + FETCH_BATCH).map((id) => fetchFull(token, id)));
      for (const p of batch) if (p) parsed.push(p);
    }
    report.fetched = parsed.length;

    const keep = parsed.filter((p) => p.direction !== "internal");

    for (let i = 0; i < keep.length; i += 50) {
      const slice = keep.slice(i, i + 50);
      /* First writer wins on the message itself; every mailbox records its copy. */
      const { error: e1 } = await db.from("email_messages").upsert(
        slice.map((p) => ({
          rfc822_id: p.rfcId,
          subject: p.subject,
          snippet: p.snippet,
          body_text: p.bodyText,
          from_email: p.fromEmail,
          from_name: p.fromName,
          to_emails: p.to,
          cc_emails: p.cc,
          external_emails: p.externals,
          direction: p.direction,
          member_email: memberEmailFor(p, box.email),
          occurred_at: p.occurredAt.toISOString(),
          in_reply_to: p.inReplyTo,
          attachment_names: p.attachments,
          labels: p.labels,
          first_mailbox: box.email,
        })),
        { onConflict: "rfc822_id", ignoreDuplicates: true }
      );
      if (e1) throw new Error(`email_messages: ${e1.message}`);
      const { error: e2 } = await db.from("email_message_copies").upsert(
        slice.map((p) => ({ rfc822_id: p.rfcId, mailbox: box.email, gmail_id: p.gmailId, thread_id: p.threadId })),
        { onConflict: "mailbox,gmail_id", ignoreDuplicates: true }
      );
      if (e2) throw new Error(`email_message_copies: ${e2.message}`);
      report.stored += slice.length;
    }

    /* On the feed, one event per email; the resolver takes it from there. */
    for (let i = 0; i < keep.length; i += 10) {
      await Promise.all(keep.slice(i, i + 10).map(async (p) => {
        const { error } = await db.rpc("land_activity_event", {
          p_source: "gmail",
          p_external_id: p.rfcId,
          p_event_type: p.direction === "inbound" ? "message:received" : "message:sent",
          p_payload: {
            rfc822_id: p.rfcId,
            gmail_id: p.gmailId,
            thread_id: p.threadId,
            mailbox: box.email,
            member_email: memberEmailFor(p, box.email),
            subject: p.subject,
            snippet: p.snippet,
            from_email: p.fromEmail,
            from_name: p.fromName,
            to: p.to,
            cc: p.cc,
            external_emails: p.externals,
            direction: p.direction,
            date: p.occurredAt.toISOString(),
            labels: p.labels,
            has_attachments: p.attachments.length > 0,
            in_reply_to: p.inReplyTo,
          },
          p_ready: true,
          p_member_email: memberEmailFor(p, box.email),
        });
        if (error) throw new Error(`land_activity_event: ${error.message}`);
        report.landed += 1;
      }));
    }

    await db.from("gmail_mailboxes").update({
      history_id: nextCursor,
      last_synced_at: new Date().toISOString(),
      last_run_messages: keep.length,
      last_error: null,
      backfilled_through: box.history_id ? undefined : new Date(Date.now() - BACKFILL_DAYS * 86400000).toISOString(),
    }).eq("email", box.email);
  } catch (e) {
    report.problem = e instanceof Error ? e.message : "Unknown error";
    await db.from("gmail_mailboxes").update({ last_error: report.problem, last_synced_at: new Date().toISOString() }).eq("email", box.email);
  }

  report.ms = Date.now() - started;
  return report;
}

/**
 * Walk mailboxes, least-recently-synced first, until the time budget is
 * spent. A run that gets through everything in its budget is the steady
 * state; a backfill takes several runs, each picking up where the last left
 * the least-recent mailbox.
 */
export async function syncGmailActivity(opts: { budgetMs: number; only?: string[] }): Promise<MailboxReport[]> {
  const db = createServiceClient();
  const started = Date.now();

  let q = db.from("gmail_mailboxes")
    .select("email, member_id, history_id, last_synced_at")
    .eq("enabled", true)
    .order("last_synced_at", { ascending: true, nullsFirst: true });
  if (opts.only?.length) q = q.in("email", opts.only);
  const { data, error } = await q;
  if (error) throw new Error(`gmail_mailboxes: ${error.message}`);

  const reports: MailboxReport[] = [];
  for (const box of (data ?? []) as Mailbox[]) {
    if (Date.now() - started > opts.budgetMs) break;
    reports.push(await syncMailbox(db, box));
  }
  return reports;
}
