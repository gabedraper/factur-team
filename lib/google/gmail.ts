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
  // Subject only, deliberately.
  //
  // Gmail's default search reads the whole message, which pulled in any sales
  // email that happened to mention a payment somewhere -- an NDA covering note
  // for a client's prospect arrived looking like a collections thread. Billing
  // correspondence nearly always says so in its subject: "Factur Invoice
  // 104223", "Payment for the month of July", "Quick check-in on outstanding
  // invoices". Precision matters more than reach here, because a trail with
  // sales email in it cannot be trusted about money.
  'subject:(invoice OR invoices OR payment OR payments OR "past due" OR ' +
  'remittance OR receivable OR overdue OR "outstanding balance" OR ' +
  'collections OR "credit hold") ' +
  // Sales paperwork that carries a billing word in its subject.
  '-subject:"PO Won" -subject:"Lead Generated" -subject:"Deal Won" ' +
  '-subject:NDA -subject:RFQ -subject:quote -subject:quoting -subject:proposal ' +
  // A bracketed prefix is task tooling, not money: "[Overdue] Weekly Data
  // Request // Nippon Tungsten" is a late report, not a late payment. It reads
  // as A/R to a keyword and to nothing else.
  '-subject:"[Overdue]" -subject:"[Due]" -subject:"[Reminder]" ' +
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
 * Messages matching a search, from one person's mailbox.
 *
 * `cap` exists because a mailbox can hold thousands of matches and this runs
 * inside a request. It is a deliberate ceiling rather than an accident, and the
 * caller reports when it is hit -- silently truncating would read as "nothing
 * more to find".
 *
 * The search is a parameter because there is now more than one caller: billing
 * wants subject-matched invoice chasing, talent wants everything recent so it
 * can match participants against the candidate database itself. Both want the
 * same paging, batching and header handling, and neither should own a second
 * copy of it.
 */
export async function fetchMail(
  actAs: string,
  query: string,
  sinceDays: number,
  cap = 600
): Promise<{ messages: GmailMessage[]; matching: number; hitCap: boolean }> {
  const token = await tokenFor("gmail", actAs);
  const q = encodeURIComponent(`${query} newer_than:${sinceDays}d`);

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

/**
 * Billing-looking messages, which is what this file was originally only for.
 * Kept as its own name so collections and the billing ingest read the same as
 * they always did.
 */
export async function fetchBillingMail(
  actAs: string,
  sinceDays: number,
  cap = 600
): Promise<{ messages: GmailMessage[]; matching: number; hitCap: boolean }> {
  return fetchMail(actAs, BILLING_QUERY, sinceDays, cap);
}

/*
 * Everything a recruiter exchanged with the outside world.
 *
 * Deliberately broad where the billing query is deliberately narrow. Billing
 * has to be precise because a trail with sales email in it cannot be trusted
 * about money; talent has the opposite problem -- it does not know in advance
 * which address matters, so it takes the lot and matches participants against
 * the candidate database afterwards. Nothing is stored unless a message has a
 * person in it.
 */
export const TALENT_QUERY = "-in:chats -in:drafts -category:promotions -category:social";

/**
 * One message, in full, for an assistant answering a question about it.
 *
 * fetchMail above deliberately never pulls a body: it builds a trail, and a
 * trail does not need the correspondence. This does the opposite job -- somebody
 * has asked about one specific message and wants to know what it said -- so it
 * fetches that one message and returns the text without storing any of it.
 *
 * `actAs` is always the person asking. There is no version of this that reads
 * somebody else's mailbox, and there should not be: the service account can
 * technically open any mailbox in the domain, so the restraint has to live at
 * every call site rather than in Google's answer.
 */
export async function fetchBody(
  actAs: string,
  messageId: string,
  cap = 8000
): Promise<{ subject: string | null; from: string | null; date: string | null; text: string }> {
  const token = await tokenFor("gmail", actAs);
  const msg = await call<{
    payload?: GmailPart;
    internalDate?: string;
  }>(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=full`,
    token
  );

  const headers = msg.payload?.headers ?? [];
  const header = (name: string) =>
    headers.find((h) => h.name.toLowerCase() === name)?.value ?? null;

  const text = collectText(msg.payload).slice(0, cap);
  return {
    subject: header("subject"),
    from: header("from"),
    date: header("date"),
    text: text || "(no readable text in this message)",
  };
}

type GmailPart = {
  mimeType?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string };
  parts?: GmailPart[];
};

/**
 * The plain-text half of a message.
 *
 * Gmail nests alternatives arbitrarily deep, so this walks the whole tree and
 * prefers text/plain. HTML is taken only when there is nothing else, with the
 * tags stripped -- a marketing email with no plain part is still readable that
 * way, and unreadable otherwise.
 */
function collectText(part: GmailPart | undefined): string {
  if (!part) return "";
  const decode = (d?: string) =>
    d ? Buffer.from(d.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8") : "";

  if (part.mimeType === "text/plain" && part.body?.data) return decode(part.body.data);

  if (part.parts?.length) {
    const joined = part.parts.map(collectText).filter(Boolean).join("\n");
    if (joined.trim()) return joined;
  }

  if (part.mimeType === "text/html" && part.body?.data) {
    return decode(part.body.data)
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return "";
}
