import { tokenFor } from "./auth";

export type GmailMessage = {
  /** Gmail's own id. Per-mailbox: the same email has a different one for each recipient. */
  id: string;
  /** The sender's Message-ID header, identical in every copy. Null on the odd malformed message. */
  rfcId: string | null;
  threadId: string;
  occurredAt: Date;
  subject: string | null;
  snippet: string | null;
  from: string | null;
  participants: string[];
};

/**
 * Messages are fetched with `format=metadata`, which returns headers and Gmail's
 * own one-line snippet but never the body. That is deliberate: the trail needs
 * to know a chase happened, when, and roughly what it said -- not to hold the
 * full correspondence of eighteen people in a web application.
 */
const HEADERS = ["From", "To", "Cc", "Subject", "Date", "Message-ID"];

/** Gmail's search syntax. `-in:chats` keeps Hangouts history out of the mail results. */
export const BILLING_QUERY =
  '(invoice OR payment OR "past due" OR remittance OR receivable OR billing ' +
  'OR overdue OR statement OR collections) ' +
  // Automated notices that a purchase order was won. They name a client and an
  // amount, so they match on every keyword and read like billing, but nothing
  // about them is owed or chased. "purchase order" was dropped from the terms
  // above for the same reason.
  '-subject:"PO Won" -subject:"Lead Generated" -subject:"Deal Won" ' +
  '-in:chats -in:drafts';

function addresses(value: string | null): string[] {
  if (!value) return [];
  return Array.from(value.matchAll(/[\w.+-]+@[\w-]+\.[\w.-]+/g)).map((m) => m[0].toLowerCase());
}

async function call<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gmail ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Billing-looking messages from one person's mailbox.
 *
 * `cap` exists because a mailbox can hold thousands of matches and this runs
 * inside a request. It is a deliberate ceiling rather than an accident, and the
 * caller reports when it is hit -- silently truncating would read as "nothing
 * more to find".
 */
export async function fetchBillingMail(
  actAs: string,
  sinceDays: number,
  cap = 600
): Promise<{ messages: GmailMessage[]; matching: number; hitCap: boolean }> {
  const token = await tokenFor("gmail", actAs);
  const q = encodeURIComponent(`${BILLING_QUERY} newer_than:${sinceDays}d`);

  /*
   * Listing ids is cheap -- a hundred per request -- so the whole matching set
   * is counted even when only part of it is fetched. Reporting the fetched
   * count as though it were the total made every mailbox look like it held
   * exactly 150 messages, which said nothing about how much was being missed.
   */
  const ids: string[] = [];
  let pageToken: string | undefined;

  do {
    const url =
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=100` +
      (pageToken ? `&pageToken=${pageToken}` : "");
    const page = await call<{ messages?: { id: string }[]; nextPageToken?: string }>(url, token);
    for (const m of page.messages ?? []) ids.push(m.id);
    pageToken = page.nextPageToken;
  } while (pageToken);

  const matching = ids.length;
  const hitCap = matching > cap;
  // Gmail returns newest first, so a truncated run keeps the recent end.
  const wanted = ids.slice(0, cap);

  /*
   * Gmail has no way to ask for many messages at once, so each needs its own
   * request. Fetched twelve at a time: sequentially this was 150 round trips
   * per mailbox and the whole run was killed by the function timeout after five
   * minutes. Twelve is well inside Gmail's per-user rate limit and turns
   * minutes into seconds.
   */
  const messages: GmailMessage[] = [];
  const BATCH = 12;

  for (let i = 0; i < wanted.length; i += BATCH) {
    const batch = await Promise.all(
      wanted.slice(i, i + BATCH).map(async (id) => {
        const url =
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}` +
          `?format=metadata&${HEADERS.map((h) => `metadataHeaders=${h}`).join("&")}`;
        const m = await call<{
          id: string; threadId: string; internalDate: string; snippet?: string;
          payload?: { headers?: { name: string; value: string }[] };
        }>(url, token);

        const header = (name: string) =>
          m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;

        return {
          id: m.id,
          rfcId: header("Message-ID"),
          threadId: m.threadId,
          occurredAt: new Date(Number(m.internalDate)),
          subject: header("Subject"),
          snippet: m.snippet?.slice(0, 400) ?? null,
          from: addresses(header("From"))[0] ?? null,
          participants: Array.from(
            new Set([
              ...addresses(header("From")),
              ...addresses(header("To")),
              ...addresses(header("Cc")),
            ])
          ),
        } satisfies GmailMessage;
      })
    );
    messages.push(...batch);
  }

  return { messages, matching, hitCap };
}
