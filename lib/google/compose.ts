import { randomUUID } from "crypto";
import { tokenFor } from "./auth";

/**
 * Putting a collections email into Brenolene's mailbox, as either a draft or a
 * sent message.
 *
 * The Message-ID is written here rather than left to Gmail. When the billing
 * ingest later collects the sent copy out of her mailbox it keys on that same
 * id, so the chase we recorded and the email that went out are one row in the
 * feed instead of two.
 */

export type Outgoing = {
  /** The mailbox it goes out from, and the person it appears to come from. */
  from: string;
  fromName: string | null;
  /** Gmail accepts several, comma separated -- QuickBooks often holds two. */
  to: string;
  /** The client's own account manager and team lead. Empty for none. */
  cc?: string | null;
  subject: string;
  body: string;
  /*
   * An HTML alternative. Optional, and when it is absent this builds exactly
   * the single-part text/plain message it always did -- collections passes no
   * html and its mail is byte-for-byte unchanged.
   *
   * NPS needs it: the survey is eleven numbered links, and a row of buttons is
   * the difference between one click and a wall of URLs. `body` stays the
   * plain-text alternative for clients that will not render HTML, so it has to
   * make sense on its own.
   */
  html?: string | null;
  /*
   * Files to hang off the message. Absent or empty and the MIME built below is
   * byte-for-byte what it always was, so nothing that already sends changes.
   *
   * The A/R ladder needs it: three of Breno's rungs promise "your full
   * statement of account" in the body, and an email that says "attached" with
   * nothing attached is worse than one that never mentioned it.
   */
  attachments?: Attachment[] | null;
};

export type Attachment = {
  filename: string;
  /** Almost always application/pdf here. */
  contentType: string;
  content: Buffer;
};

export type Placed = {
  rfcMessageId: string;
  draftId: string | null;
  gmailId: string;
};

/** Non-ASCII in a header has to be encoded or Gmail mangles it. */
function header(value: string): string {
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function mime(message: Outgoing, rfcMessageId: string): string {
  const from = message.fromName
    ? `${header(message.fromName)} <${message.from}>`
    : message.from;

  const cc = message.cc?.trim();
  const html = message.html?.trim();
  const files = (message.attachments ?? []).filter((a) => a.content?.length);

  const headers = [
    `From: ${from}`,
    `To: ${message.to}`,
    // Omitted rather than sent empty; a bare "Cc:" is a malformed header.
    ...(cc ? [`Cc: ${cc}`] : []),
    `Subject: ${header(message.subject)}`,
    `Message-ID: ${rfcMessageId}`,
    "MIME-Version: 1.0",
  ];

  const plain = [
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(message.body, "utf8").toString("base64"),
  ];

  if (!html && files.length === 0) {
    return Buffer.from([...headers, ...plain].join("\r\n"), "utf8").toString("base64url");
  }

  /*
   * multipart/alternative: the same message twice, plain text first. Order is
   * not decorative -- a reader is expected to show the last part it can
   * render, so HTML must come second or everyone sees the plain version.
   *
   * The boundary is derived from the Message-ID, which is already unique per
   * message, so it cannot collide with anything in the body.
   */
  const boundary = `factur-${rfcMessageId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 32)}`;

  // The readable message: plain alone, or plain and HTML as alternatives.
  const readable = html
    ? [
        `Content-Type: multipart/alternative; boundary="alt-${boundary}"`,
        "",
        `--alt-${boundary}`,
        ...plain,
        "",
        `--alt-${boundary}`,
        'Content-Type: text/html; charset="UTF-8"',
        "Content-Transfer-Encoding: base64",
        "",
        Buffer.from(html, "utf8").toString("base64"),
        "",
        `--alt-${boundary}--`,
      ]
    : plain;

  if (files.length === 0) {
    return Buffer.from([...headers, ...readable].join("\r\n"), "utf8").toString("base64url");
  }

  /*
   * multipart/mixed wrapping the readable part, then the files. Nesting rather
   * than flattening matters: a reader picks one of the alternatives to show and
   * lists the rest as attachments, so a flat structure would offer the client a
   * choice between the plain text and the PDF.
   *
   * Base64 is wrapped at 76 characters. Unwrapped lines are legal in principle
   * and rejected in practice by enough mail servers to be worth the two lines
   * it costs to do properly.
   */
  const wrap = (b64: string) => (b64.match(/.{1,76}/g) ?? []).join("\r\n");

  const parts = files.flatMap((f) => [
    `--mix-${boundary}`,
    `Content-Type: ${f.contentType}; name="${f.filename.replace(/["\r\n]/g, "")}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${f.filename.replace(/["\r\n]/g, "")}"`,
    "",
    wrap(f.content.toString("base64")),
    "",
  ]);

  const lines = [
    ...headers,
    `Content-Type: multipart/mixed; boundary="mix-${boundary}"`,
    "",
    `--mix-${boundary}`,
    ...readable,
    "",
    ...parts,
    `--mix-${boundary}--`,
  ];

  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

/**
 * A 403 here means the scope was never granted, which is a setup step rather
 * than a fault, so it is named as one. Anything else is passed through.
 */
async function post<T>(url: string, token: string, payload: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    if (res.status === 403 || res.status === 401) {
      throw new Error(
        "Google has not granted this app permission to write mail as that " +
          "person. A Workspace admin needs to add the gmail.compose scope to " +
          "the service account's domain-wide delegation — see " +
          "docs/google-workspace-ingest.md."
      );
    }
    throw new Error(`Gmail ${res.status}: ${detail}`);
  }
  return res.json() as Promise<T>;
}

function newMessageId(from: string): string {
  const domain = from.split("@")[1] ?? "facturmfg.com";
  return `<collections-${randomUUID()}@${domain}>`;
}

/** Leaves it in her Drafts for her to read and send herself. */
export async function draftAs(message: Outgoing): Promise<Placed> {
  const token = await tokenFor("compose", message.from);
  const rfcMessageId = newMessageId(message.from);

  const created = await post<{ id: string; message: { id: string } }>(
    "https://gmail.googleapis.com/gmail/v1/users/me/drafts",
    token,
    { message: { raw: mime(message, rfcMessageId) } }
  );

  return { rfcMessageId, draftId: created.id, gmailId: created.message.id };
}

/** Sends it there and then. Only ever reached in full-auto. */
export async function sendAs(message: Outgoing): Promise<Placed> {
  const token = await tokenFor("compose", message.from);
  const rfcMessageId = newMessageId(message.from);

  const sent = await post<{ id: string }>(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    token,
    { raw: mime(message, rfcMessageId) }
  );

  return { rfcMessageId, draftId: null, gmailId: sent.id };
}
