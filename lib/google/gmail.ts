import { tokenFor } from "./auth";

export type GmailMessage = {
  id: string;
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
const HEADERS = ["From", "To", "Cc", "Subject", "Date"];

/** Gmail's search syntax. `-in:chats` keeps Hangouts history out of the mail results. */
export const BILLING_QUERY =
  '(invoice OR payment OR "past due" OR remittance OR receivable OR billing ' +
  'OR overdue OR statement OR collections OR "purchase order") -in:chats -in:drafts';

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
  cap = 150
): Promise<{ messages: GmailMessage[]; hitCap: boolean }> {
  const token = await tokenFor("gmail", actAs);
  const q = encodeURIComponent(`${BILLING_QUERY} newer_than:${sinceDays}d`);

  const ids: string[] = [];
  let pageToken: string | undefined;

  do {
    const url =
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=100` +
      (pageToken ? `&pageToken=${pageToken}` : "");
    const page = await call<{ messages?: { id: string }[]; nextPageToken?: string }>(url, token);
    for (const m of page.messages ?? []) ids.push(m.id);
    pageToken = page.nextPageToken;
  } while (pageToken && ids.length < cap);

  const hitCap = ids.length > cap;
  const wanted = ids.slice(0, cap);

  const messages: GmailMessage[] = [];
  for (const id of wanted) {
    const url =
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}` +
      `?format=metadata&${HEADERS.map((h) => `metadataHeaders=${h}`).join("&")}`;
    const m = await call<{
      id: string; threadId: string; internalDate: string; snippet?: string;
      payload?: { headers?: { name: string; value: string }[] };
    }>(url, token);

    const header = (name: string) =>
      m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;

    messages.push({
      id: m.id,
      threadId: m.threadId,
      occurredAt: new Date(Number(m.internalDate)),
      subject: header("Subject"),
      snippet: m.snippet?.slice(0, 400) ?? null,
      from: addresses(header("From"))[0] ?? null,
      participants: Array.from(
        new Set([...addresses(header("From")), ...addresses(header("To")), ...addresses(header("Cc"))])
      ),
    });
  }

  return { messages, hitCap };
}
