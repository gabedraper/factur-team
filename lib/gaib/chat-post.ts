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

async function token(scope: string = SCOPE): Promise<string | null> {
  const creds = credentials();
  if (!creds) return null;

  const jwt = new JWT({
    email: creds.client_email,
    // Vercel strips the newlines out of a pasted key, so they go back in.
    // Without this the signature fails with an error that says nothing about
    // newlines -- the same trap the ingest key fell into.
    key: creds.private_key.replace(/\\n/g, "\n"),
    scopes: [scope],
  });

  const { access_token } = await jwt.authorize();
  return access_token ?? null;
}

/*
 * Reading every message in a room, not just the ones that mention Gaib.
 *
 * A separate scope from posting, and one Google only honours once a Workspace
 * admin has approved it for this app. Until then the token is issued and the
 * listing call is refused with a 403 -- which the reader reports rather than
 * treating as an empty room.
 */
const READ_ROOM_SCOPE = "https://www.googleapis.com/auth/chat.app.messages.readonly";

export type RoomMessage = {
  name: string;
  text: string;
  createTime: string;
  threadName: string | null;
  senderUser: string | null;
  senderType: string | null;
  mentionsApp: boolean;
  attachments: { resourceName: string; contentType: string }[];
};

export async function listRoomMessages(
  spaceName: string,
  sinceIso: string
): Promise<{ ok: true; messages: RoomMessage[] } | { ok: false; reason: string; status?: number }> {
  const access = await token(READ_ROOM_SCOPE).catch(() => null);
  if (!access) return { ok: false, reason: "no key, or it would not authorise" };

  const filter = encodeURIComponent(`createTime > "${sinceIso}"`);
  const res = await fetch(
    `https://chat.googleapis.com/v1/${spaceName}/messages?pageSize=50&orderBy=createTime%20asc&filter=${filter}`,
    { headers: { Authorization: `Bearer ${access}` } }
  );
  if (!res.ok) {
    return { ok: false, status: res.status, reason: `Chat ${res.status}: ${(await res.text()).slice(0, 200)}` };
  }

  type Raw = {
    name: string; text?: string; argumentText?: string; createTime: string;
    thread?: { name?: string };
    sender?: { name?: string; type?: string };
    annotations?: { type?: string; userMention?: { user?: { type?: string } } }[];
    attachment?: { contentType?: string; source?: string; attachmentDataRef?: { resourceName?: string } }[];
  };
  const body = (await res.json()) as { messages?: Raw[] };

  return {
    ok: true,
    messages: (body.messages ?? []).map((m) => ({
      name: m.name,
      text: (m.text ?? "").trim(),
      createTime: m.createTime,
      threadName: m.thread?.name ?? null,
      senderUser: m.sender?.name ?? null,
      senderType: m.sender?.type ?? null,
      // A mention of an app arrives through the webhook as well, and must not
      // be answered twice.
      mentionsApp: (m.annotations ?? []).some(
        (a) => a.type === "USER_MENTION" && a.userMention?.user?.type === "BOT"
      ),
      attachments: (m.attachment ?? [])
        .filter((a) => a.source !== "DRIVE_FILE" && a.attachmentDataRef?.resourceName)
        .filter((a) => /^image\/(png|jpe?g|gif|webp)$/i.test(a.contentType ?? ""))
        .map((a) => ({ resourceName: a.attachmentDataRef!.resourceName!, contentType: a.contentType! })),
    })),
  };
}

/**
 * Put a message in a space.
 *
 * Never throws. Nothing that calls this is worth failing over -- a notification
 * that did not arrive is a small loss, and one that took a background job down
 * with it is a larger one.
 */
export async function postToSpace(
  spaceName: string,
  text: string,
  /** Reply under this thread rather than starting a new one. */
  threadName?: string | null
): Promise<PostResult> {
  const access = await token().catch(() => null);
  if (!access) return { ok: false, reason: "no posting key, or it would not authorise" };

  try {
    const query = threadName ? "?messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD" : "";
    const res = await fetch(
      `https://chat.googleapis.com/v1/${spaceName}/messages${query}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text, ...(threadName ? { thread: { name: threadName } } : {}) }),
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

/**
 * Fetch an image somebody attached to a message sent to Gaib.
 *
 * Chat hands the app a reference rather than the file, and the file is
 * downloaded with the app's own credentials -- the same chat.bot scope that
 * posts, which covers attachments on messages the app was sent. Never throws:
 * a picture that could not be fetched means an answer without it, not no
 * answer.
 */
export async function downloadAttachment(
  resourceName: string
): Promise<{ ok: true; data: string } | { ok: false; reason: string }> {
  const access = await token().catch(() => null);
  if (!access) return { ok: false, reason: "no posting key" };

  try {
    const res = await fetch(
      `https://chat.googleapis.com/v1/media/${resourceName}?alt=media`,
      { headers: { Authorization: `Bearer ${access}` } }
    );
    if (!res.ok) return { ok: false, reason: `Chat ${res.status}` };

    const bytes = Buffer.from(await res.arrayBuffer());
    // Past this the model refuses the image outright, and a screenshot of a
    // browser window is never close to it -- anything bigger is something else.
    if (bytes.length > 5 * 1024 * 1024) return { ok: false, reason: "image over 5MB" };
    return { ok: true, data: bytes.toString("base64") };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "download failed" };
  }
}

/**
 * Post a GIF as an image card, in the same thread as the reply it belongs to.
 *
 * A card rather than a bare link: Chat does not reliably unfurl links in
 * messages from apps, so a pasted URL often arrives as just a URL.
 */
export async function postGifToSpace(
  spaceName: string,
  imageUrl: string,
  threadName?: string | null
): Promise<PostResult> {
  const access = await token().catch(() => null);
  if (!access) return { ok: false, reason: "no posting key" };

  const query = threadName ? "?messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD" : "";
  try {
    const res = await fetch(`https://chat.googleapis.com/v1/${spaceName}/messages${query}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(threadName ? { thread: { name: threadName } } : {}),
        cardsV2: [{
          cardId: "gif",
          card: { sections: [{ widgets: [{ image: { imageUrl, altText: "GIF" } }] }] },
        }],
      }),
    });
    if (!res.ok) return { ok: false, reason: `Chat ${res.status}: ${(await res.text()).slice(0, 200)}` };
    const body = (await res.json()) as { name?: string };
    return { ok: true, messageName: body.name ?? "(unnamed)" };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "unknown error" };
  }
}

/**
 * The shared spaces Gaib is a member of, straight from Chat.
 *
 * Rooms used to be learned only when somebody mentioned Gaib in one -- so a
 * room it had been added to but nobody had yet spoken to was invisible, and
 * could not have its daily test switched on. Asking Chat directly finds them
 * on the next run.
 */
export async function listAppRooms(): Promise<{ name: string; displayName: string | null }[]> {
  const access = await token().catch(() => null);
  if (!access) return [];
  try {
    const res = await fetch(
      `https://chat.googleapis.com/v1/spaces?pageSize=100&filter=${encodeURIComponent('spaceType = "SPACE"')}`,
      { headers: { Authorization: `Bearer ${access}` } }
    );
    if (!res.ok) return [];
    const body = (await res.json()) as { spaces?: { name: string; displayName?: string }[] };
    return (body.spaces ?? []).map((s) => ({ name: s.name, displayName: s.displayName ?? null }));
  } catch {
    return [];
  }
}
