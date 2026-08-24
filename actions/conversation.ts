"use server";

import { createServiceClient, createClient } from "@/lib/supabase/server";
import { myPermissions } from "@/lib/org";
import { tokenFor } from "@/lib/google/auth";

export type ConversationEntry = {
  occurred_at: string;
  kind: "message" | "event";
  direction: "inbound" | "outbound" | "internal" | null;
  author: string | null;
  title: string;
  preview: string | null;
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
 * Read as whoever the message was already collected from -- this grants no
 * access that the ingest did not already have.
 */
export async function getMessageBody(externalId: string): Promise<{
  body: string | null;
  problem: string | null;
}> {
  if (!(await mayRead())) return { body: null, problem: "Not permitted." };

  const db = createServiceClient();
  const { data } = await db
    .from("comm_messages")
    .select("participants,author_email")
    .eq("source", "gmail")
    .eq("external_id", externalId)
    .maybeSingle();

  if (!data) return { body: null, problem: "That message isn't in the trail." };

  // Whose mailbox to read it from: someone on it whom the ingest already reads.
  const { data: accounts } = await db.rpc("get_ingest_accounts");
  const readable = new Set(
    ((accounts ?? []) as { email: string }[]).map((a) => a.email.toLowerCase())
  );
  const row = data as { participants: string[]; author_email: string | null };
  const actAs = [...(row.participants ?? []), row.author_email ?? ""]
    .map((p) => p.toLowerCase())
    .find((p) => readable.has(p));

  if (!actAs) {
    return { body: null, problem: "Nobody whose mail we read is on this message." };
  }

  try {
    const token = await tokenFor("gmail", actAs);
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${externalId}?format=full`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return { body: null, problem: `Gmail ${res.status}` };

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
