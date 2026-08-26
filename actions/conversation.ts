"use server";

import { createServiceClient, createClient } from "@/lib/supabase/server";
import { myPermissions } from "@/lib/org";
import { tokenFor } from "@/lib/google/auth";

export type ConversationEntry = {
  /** Set for messages, which happened at a moment. */
  occurred_at: string | null;
  /** Set for invoices, payments and gaps, which belong to a day or a month. */
  on_date: string | null;
  kind: "message" | "invoice" | "payment" | "gap" | "collections";
  direction: "inbound" | "outbound" | "internal" | null;
  side: "us" | "client" | "internal";
  /** Which system it came from, so the line can show what kind of contact it was. */
  source: "gmail" | "google_chat" | "meet_transcript" | null;
  author: string | null;
  title: string | null;
  preview: string | null;
  invoice_no: string | null;
  service_month: string | null;
  /** On an invoice, what was billed. On a chase, whether it was drafted or sent. */
  service: string | null;
  line_description: string | null;
  unit_price: number | null;
  quantity: number | null;
  due_date: string | null;
  bill_email: string | null;
  amount: number | null;
  outstanding: number | null;
  matched_by: "domain" | "thread" | "name" | null;
  external_id: string | null;
  url: string | null;
};

async function mayRead() {
  const perms = await myPermissions();
  return perms.has("clients.health") || perms.has("org.manage");
}

export async function getConversation(clientId: string): Promise<ConversationEntry[]> {
  if (!(await mayRead())) return [];
  // The user's own connection: the function checks is_factur_user(), which
  // reads their token.
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_client_conversation", {
    p_client_id: clientId,
  });
  if (error) throw new Error(`conversation failed: ${error.message}`);
  return (data ?? []) as ConversationEntry[];
}

/**
 * The full text of one message, fetched from Gmail when someone opens it.
 *
 * Nothing longer than a preview is stored, so this is how the full view works:
 * read it at the moment it is asked for, show it, keep nothing. That way the
 * app can show any message in full without holding the correspondence of
 * eighteen people at rest.
 *
 * Read as whoever already holds a copy -- this grants no access that the
 * ingest did not already have.
 */
export async function getMessageBody(externalId: string): Promise<{
  body: string | null;
  problem: string | null;
}> {
  if (!(await mayRead())) return { body: null, problem: "Not permitted." };

  const db = createServiceClient();
  /*
   * The conversation identifies a row by its Gmail id where it has one and by
   * its own id otherwise, so both are tried -- as two queries rather than one
   * `or`, because a chat id and a Message-ID both carry punctuation that
   * PostgREST reads as filter syntax.
   */
  const cols = "source,ingested_from,external_id,participants,author_email";
  const found = await db.from("comm_messages").select(cols).eq("gmail_id", externalId).limit(1);
  const data =
    found.data?.[0] ??
    (await db.from("comm_messages").select(cols).eq("external_id", externalId).limit(1))
      .data?.[0];

  if (!data) return { body: null, problem: "That message isn't in the trail." };

  const row = data as {
    source: "gmail" | "google_chat" | "meet_transcript";
    ingested_from: string | null;
    external_id: string | null;
    participants: string[];
    author_email: string | null;
  };

  if (row.source === "google_chat") return readChat(row);
  if (row.source === "meet_transcript") return readTranscript(row);

  const { data: accounts } = await db.rpc("get_ingest_accounts");

  const readable = ((accounts ?? []) as { email: string }[]).map((a) => a.email.toLowerCase());

  /*
   * Where to read it from.
   *
   * A Gmail id only resolves in the mailbox it belongs to, so the mailbox it
   * was collected from is tried first. Messages gathered before that was
   * recorded have nothing to go on, and guessing a participant produced two
   * different lies: "no longer in that mailbox" when the guess was wrong, and
   * "nobody whose mail we read is on this" when the only participants were a
   * client and a mailbox not on the list.
   *
   * So when the source is unknown, the message is looked up by the sender's
   * Message-ID -- which is the same in every copy -- across the mailboxes we
   * can read, and whichever holds it answers.
   */
  async function locate(): Promise<{ token: string; id: string; who: string } | null> {
    if (row.ingested_from) {
      try {
        return {
          token: await tokenFor("gmail", row.ingested_from),
          id: externalId,
          who: row.ingested_from,
        };
      } catch {
        // Fall through and search instead.
      }
    }
    if (!row.external_id) return null;

    const rfc = row.external_id.replace(/[<>]/g, "");
    // Anyone on the message first, then the rest: usually one of them has it.
    const onIt = new Set(
      [...(row.participants ?? []), row.author_email ?? ""].map((p) => p.toLowerCase())
    );
    const order = [
      ...readable.filter((a) => onIt.has(a)),
      ...readable.filter((a) => !onIt.has(a)),
    ];

    for (const who of order) {
      try {
        const token = await tokenFor("gmail", who);
        const res = await fetch(
          "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=1&q=" +
            encodeURIComponent(`rfc822msgid:${rfc}`),
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!res.ok) continue;
        const found = (await res.json()) as { messages?: { id: string }[] };
        if (found.messages?.[0]?.id) return { token, id: found.messages[0].id, who };
      } catch {
        continue;
      }
    }
    return null;
  }

  const located = await locate();
  if (!located) {
    return {
      body: null,
      problem: "This message isn't in any mailbox we can read — open it in Gmail instead.",
    };
  }
  const { token, id: messageId, who } = located;

  // Remember where it was found, so the search only ever happens once.
  if (!row.ingested_from) {
    await db
      .from("comm_messages")
      .update({ ingested_from: who, gmail_id: messageId })
      .eq("source", "gmail")
      .eq("gmail_id", externalId);
  }

  try {
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) {
      return {
        body: null,
        problem:
          res.status === 404
            ? "This message is no longer in that mailbox — it may have been deleted."
            : `Gmail returned ${res.status}.`,
      };
    }

    const msg = (await res.json()) as {
      payload?: { mimeType?: string; body?: { data?: string }; parts?: unknown[] };
    };

    // A message body is a tree of parts; the plain-text one is what we want and
    // it can be nested several levels down.
    const findText = (part: unknown): string | null => {
      const p = part as {
        mimeType?: string; body?: { data?: string }; parts?: unknown[];
      };
      if (p.mimeType === "text/plain" && p.body?.data) {
        return Buffer.from(p.body.data, "base64url").toString("utf8");
      }
      for (const child of p.parts ?? []) {
        const found = findText(child);
        if (found) return found;
      }
      return null;
    };

    const body = findText(msg.payload);
    return { body: body ? body.slice(0, 20000) : null, problem: body ? null : "No plain text in this message." };
  } catch (e) {
    return { body: null, problem: e instanceof Error ? e.message : "Couldn't fetch it." };
  }
}


/** One chat line, read back as whoever collected it. */
async function readChat(row: {
  ingested_from: string | null;
  external_id: string | null;
}): Promise<{ body: string | null; problem: string | null }> {
  if (!row.ingested_from || !row.external_id) {
    return { body: null, problem: "This message can't be opened — see it in Chat instead." };
  }
  try {
    const token = await tokenFor("chat", row.ingested_from);
    const res = await fetch(`https://chat.googleapis.com/v1/${row.external_id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      return {
        body: null,
        problem: "This message is no longer in that space — open it in Chat instead.",
      };
    }
    const m = (await res.json()) as { text?: string };
    return { body: m.text ?? null, problem: m.text ? null : "This message has no text." };
  } catch (e) {
    return { body: null, problem: e instanceof Error ? e.message : "Could not read it." };
  }
}

/**
 * One meeting transcript, exported at the moment it is opened.
 *
 * A transcript is long, which is the reason none of it is stored: an hour of
 * talk about one invoice would otherwise sit in the database for every meeting
 * anyone recorded.
 */
async function readTranscript(row: {
  ingested_from: string | null;
  external_id: string | null;
}): Promise<{ body: string | null; problem: string | null }> {
  if (!row.ingested_from || !row.external_id) {
    return { body: null, problem: "This transcript can't be opened — see it in Drive instead." };
  }
  try {
    const token = await tokenFor("drive", row.ingested_from);
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${row.external_id}/export?mimeType=text/plain`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) {
      return {
        body: null,
        problem: "This transcript is no longer in Drive — it may have been deleted.",
      };
    }
    return { body: await res.text(), problem: null };
  } catch (e) {
    return { body: null, problem: e instanceof Error ? e.message : "Could not read it." };
  }
}
