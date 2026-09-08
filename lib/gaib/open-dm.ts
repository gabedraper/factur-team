import { JWT } from "google-auth-library";
import { createServiceClient } from "@/lib/supabase/server";
import { readKey } from "./service-key";
import { postToSpace } from "./chat-post";

/*
 * Opening the conversation, so Gaib can be the one who speaks first.
 *
 * A direct message space in Chat does not exist until somebody opens it, and
 * an app cannot open one on its own behalf -- which is why every notification
 * Gaib has ever sent has only reached the handful of people who happened to
 * message it first. Everyone else got nothing, silently.
 *
 * The way round it is not a trick. Acting as the person, through the same
 * domain-wide delegation the rest of the Google code uses, we ask Chat to set
 * up their direct message with the Gaib app -- which is exactly what would
 * happen if they had opened it themselves from the Chat sidebar. The space is
 * then real, we write it down, and from that point Gaib can speak to them the
 * ordinary way.
 *
 * This needs `chat.spaces.create` granted to the service account in Google
 * Admin. Without it every call comes back 403 and this says so plainly rather
 * than looking broken.
 */

const SETUP_SCOPE = "https://www.googleapis.com/auth/chat.spaces.create";

export type OpenResult =
  | { ok: true; spaceName: string; alreadyOpen: boolean }
  | { ok: false; reason: string };

/**
 * Find or create this person's direct message with Gaib.
 *
 * `spaces.setup` is the one call that does both: given a space that already
 * exists it hands back the same one rather than a second, so running this over
 * the whole staff list twice is harmless.
 */
export async function openDmAs(email: string): Promise<OpenResult> {
  const key = readKey();
  if (!key.ok) return { ok: false, reason: "no posting key is configured" };

  let access: string;
  try {
    const jwt = new JWT({
      email: key.client_email,
      key: key.private_key.replace(/\\n/g, "\n"),
      scopes: [SETUP_SCOPE],
      subject: email,
    });
    const { access_token } = await jwt.authorize();
    if (!access_token) return { ok: false, reason: "Google would not issue a token" };
    access = access_token;
  } catch (e) {
    const m = e instanceof Error ? e.message : "unknown error";
    /*
     * The one failure worth naming, because the fix is a click in Admin and
     * the raw message does not say so. The account is named because there is
     * more than one service account in this domain and the grant has to go on
     * this one -- putting it on the ingest account instead produces exactly
     * this error, with nothing to suggest which account was meant.
     */
    return {
      ok: false,
      reason: /unauthorized_client|invalid_grant/i.test(m)
        ? `Google Admin has not granted chat.spaces.create to ${key.client_email} ` +
          "(the grant is keyed on that account's OAuth client ID, not the project number)"
        : m,
    };
  }

  try {
    const res = await fetch("https://chat.googleapis.com/v1/spaces:setup", {
      method: "POST",
      headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
      // `singleUserBotDm` is what makes this the person-and-Gaib conversation
      // rather than a new group. No memberships: the two participants are the
      // caller and the app doing the calling.
      body: JSON.stringify({ space: { spaceType: "DIRECT_MESSAGE", singleUserBotDm: true } }),
    });

    if (!res.ok) {
      const body = (await res.text()).slice(0, 300);
      if (res.status === 403) {
        return { ok: false, reason: `Chat refused it (403). Usually the missing scope: ${body}` };
      }
      return { ok: false, reason: `Chat ${res.status}: ${body}` };
    }

    const space = (await res.json()) as { name?: string; createTime?: string };
    if (!space.name) return { ok: false, reason: "Chat returned a space with no name" };

    // A space created seconds ago is a new conversation; anything older was
    // already there, and the person should not be introduced to Gaib twice.
    const fresh = space.createTime
      ? Date.now() - new Date(space.createTime).getTime() < 60_000
      : false;

    return { ok: true, spaceName: space.name, alreadyOpen: !fresh };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "unknown error" };
  }
}

/** What Gaib says when it turns up in somebody's Chat unannounced. */
function intro(firstName: string): string {
  return [
    `Hi ${firstName} — I'm Gaib.`,
    "",
    "I'm the assistant built into the team app. I can answer questions about " +
      "your clients, your invoices and how the app works, and if something in " +
      "there is broken or annoying you can tell me here and I'll get it fixed.",
    "",
    "Nothing to set up. Just reply to this message whenever you need something.",
  ].join("\n");
}

export type OpenedFor = {
  userId: string;
  email: string;
  name: string;
  result: OpenResult;
  introduced: boolean;
};

/**
 * Open the conversation with a set of people and say hello once.
 *
 * Sequential on purpose. This runs over the whole company at most a couple of
 * times and Chat's quota is per-app, so forty parallel setups is how you get a
 * 429 that leaves half the list opened and no record of which half.
 */
export async function openDmsFor(
  people: { userId: string; email: string; name: string }[]
): Promise<OpenedFor[]> {
  const db = createServiceClient();
  const out: OpenedFor[] = [];

  for (const person of people) {
    const result = await openDmAs(person.email);
    let introduced = false;

    if (result.ok) {
      await db.from("gaib_chat_spaces").upsert({
        user_id: person.userId,
        space_name: result.spaceName,
        last_seen: new Date().toISOString(),
      });

      // Written down first, then greeted. If the greeting fails Gaib can still
      // reach them later; if the order were reversed a failed write would mean
      // a person who has been introduced and cannot be found again.
      if (!result.alreadyOpen) {
        const said = await postToSpace(
          result.spaceName,
          intro(person.name.split(/\s+/)[0] || "there")
        );
        introduced = said.ok;
      }
    }

    out.push({ ...person, result, introduced });
  }

  return out;
}
