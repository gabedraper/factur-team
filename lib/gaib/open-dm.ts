import { JWT } from "google-auth-library";
import { createServiceClient } from "@/lib/supabase/server";
import { readKey } from "./service-key";
import { postToSpace } from "./chat-post";
import { vary } from "./vary";

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
  | { ok: true; spaceName: string }
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
      /*
       * A 403 here is almost never the scope -- a missing scope fails earlier,
       * at the token. It is the Chat app's own audience: the app is published
       * to a named group rather than the whole domain, and this person is not
       * in it. Worth saying outright, because the raw wording ("Developer
       * permission settings do not support this action") sends you looking at
       * the code, which is the one place the problem is not.
       */
      if (res.status === 403 && /permission/i.test(body)) {
        return {
          ok: false,
          reason:
            "the Chat app is not shared with them -- add them to the group it is " +
            "published to, in the Chat API's Visibility setting",
        };
      }
      return { ok: false, reason: `Chat ${res.status}: ${body}` };
    }

    const space = (await res.json()) as { name?: string };
    if (!space.name) return { ok: false, reason: "Chat returned a space with no name" };

    return { ok: true, spaceName: space.name };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "unknown error" };
  }
}

/** What Gaib says when it turns up in somebody's Chat unannounced. */
function intro(firstName: string): string {
  return [
    vary("intro-open", [`hey ${firstName}, i'm Gaib.`, `hi ${firstName}! Gaib here.`, `hey ${firstName}. i'm Gaib.`]),
    "",
    "I'm the assistant built into the team app. I can answer questions about " +
      "your clients, your invoices and how the app works, and if something in " +
      "there is broken or annoying you can tell me here and I'll get it fixed.",
    "",
    "Nothing to set up. Just reply to this message whenever you need something.",
  ].join("\n");
}

/**
 * The same hello, for somebody who has never opened the app.
 *
 * Different because the ordinary one is useless to them: it offers to answer
 * questions about a thing they have not seen. This says what the app is and
 * how to get in, which is the step they are actually missing.
 */
function invitation(firstName: string): string {
  return [
    vary("invite-open", [
      `hey ${firstName}, i'm Gaib, the assistant in the Factur team app.`,
      `hi ${firstName}! Gaib here, i live in the Factur team app.`,
    ]),
    "",
    "You have an account waiting and haven't used it yet. It's where your " +
      "clients, your work and your team's numbers live.",
    "",
    "sign in with your Factur Google account, nothing to set up:",
    "https://team.facturmfg.com",
    "",
    "Once you're in, ask me anything here, or tell me if something's broken " +
      "and I'll get it fixed.",
  ].join("\n");
}

export type OpenedFor = {
  userId: string | null;
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
  people: { userId: string | null; email: string; name: string }[]
): Promise<OpenedFor[]> {
  const db = createServiceClient();
  const out: OpenedFor[] = [];

  for (const person of people) {
    const email = person.email.toLowerCase();

    /*
     * Whether to say hello is decided here, from our own records, rather than
     * from anything Chat says about the space.
     *
     * The first version of this read the space's createTime and greeted anyone
     * whose space was seconds old. Chat does not return that field on setup, so
     * every space looked old, and the first person this ran for got a
     * conversation opened and nothing said in it. Our own table is the honest
     * signal anyway: a row means Gaib has talked to them, which is exactly the
     * question being asked.
     *
     * Looked up by address rather than by account, so that somebody greeted
     * before they had an account is not greeted a second time after they get
     * one.
     */
    const { data: known } = await db
      .from("gaib_chat_spaces").select("id").eq("email", email).maybeSingle();
    const isNew = !known;

    const result = await openDmAs(person.email);
    let introduced = false;

    if (result.ok) {
      await db.from("gaib_chat_spaces").upsert(
        {
          email,
          user_id: person.userId,
          space_name: result.spaceName,
          last_seen: new Date().toISOString(),
        },
        { onConflict: "email" }
      );

      // Written down first, then greeted. If the greeting fails Gaib can still
      // reach them later; if the order were reversed a failed write would mean
      // a person who has been introduced and cannot be found again.
      if (isNew) {
        const firstName = person.name.split(/\s+/)[0] || "there";
        // No account means they have never been in the app, so the ordinary
        // hello would offer to answer questions about something they have not
        // seen. They get the way in instead.
        const said = await postToSpace(
          result.spaceName,
          person.userId ? intro(firstName) : invitation(firstName)
        );
        introduced = said.ok;
      }
    }

    out.push({ ...person, result, introduced });
  }

  return out;
}
