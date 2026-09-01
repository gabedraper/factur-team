import { JWT } from "google-auth-library";
import { createServiceClient } from "@/lib/supabase/server";
import { readKey } from "./service-key";

/*
 * Gaib speaking first.
 *
 * Everything until now has been Gaib answering: a message arrives, a reply goes
 * back in the same breath. This is the other direction -- telling somebody their
 * fix is live, days later, without waiting for them to think of asking.
 *
 * It authenticates as the app rather than as a person, which is the one place
 * in this codebase that happens. Every other Google call passes a member of
 * staff's address and acts as them; this one is Gaib acting as itself, because
 * it is Gaib doing the talking. The scope is chat.bot and nothing else, so the
 * worst a leaked key could do is post as the assistant -- it cannot read a
 * mailbox and it cannot reach the database.
 *
 * The hard limit worth knowing before planning around this: a direct message
 * space does not exist until a person opens one, so Gaib can only ever speak
 * first to somebody who has spoken to it at least once. No amount of code moves
 * that; it is how Chat works.
 */

const SCOPE = "https://www.googleapis.com/auth/chat.bot";

export type PostResult =
  | { ok: true; messageName: string }
  | { ok: false; reason: string };

function credentials(): { client_email: string; private_key: string } | null {
  const key = readKey();
  return key.ok ? { client_email: key.client_email, private_key: key.private_key } : null;
}

/** Whether Gaib is able to start conversations at all. */
export function canPost(): boolean {
  return credentials() !== null;
}

async function token(): Promise<string | null> {
  const creds = credentials();
  if (!creds) return null;

  const jwt = new JWT({
    email: creds.client_email,
    // Vercel strips the newlines out of a pasted key, so they go back in.
    // Without this the signature fails with an error that says nothing about
    // newlines -- the same trap the ingest key fell into.
    key: creds.private_key.replace(/\\n/g, "\n"),
    scopes: [SCOPE],
  });

  const { access_token } = await jwt.authorize();
  return access_token ?? null;
}

/**
 * Put a message in a space.
 *
 * Never throws. Nothing that calls this is worth failing over -- a notification
 * that did not arrive is a small loss, and one that took a background job down
 * with it is a larger one.
 */
export async function postToSpace(spaceName: string, text: string): Promise<PostResult> {
  const access = await token().catch(() => null);
  if (!access) return { ok: false, reason: "no posting key, or it would not authorise" };

  try {
    const res = await fetch(
      `https://chat.googleapis.com/v1/${spaceName}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
      }
    );

    if (!res.ok) {
      return { ok: false, reason: `Chat ${res.status}: ${(await res.text()).slice(0, 200)}` };
    }
    const body = (await res.json()) as { name?: string };
    return { ok: true, messageName: body.name ?? "(unnamed)" };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "unknown error" };
  }
}

/**
 * Where this person talks to Gaib, if they ever have.
 *
 * Null is a perfectly ordinary answer and the caller must treat it as one:
 * most people will not have messaged Gaib yet, and the right response is to
 * leave the update waiting in the app rather than to invent somewhere to put it.
 */
export async function spaceFor(userId: string): Promise<string | null> {
  const db = createServiceClient();
  const { data } = await db
    .from("gaib_chat_spaces")
    .select("space_name")
    .eq("user_id", userId)
    .maybeSingle();
  return (data as { space_name: string } | null)?.space_name ?? null;
}
export { readKey } from "./service-key";
