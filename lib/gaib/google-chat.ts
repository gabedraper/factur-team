import { OAuth2Client } from "google-auth-library";

/*
 * Proving a message really came from Google Chat.
 *
 * This is the only thing standing between "the team can talk to Gaib" and
 * "anybody who knows the address can talk to Gaib as anybody they like". The
 * endpoint takes an email address out of the request and hands whoever sent it
 * that person's permissions -- their clients, their mail, their figures -- so a
 * forged request that gets past this check is a complete impersonation of any
 * member of staff.
 *
 * Google signs every request with a short-lived token. Two things are checked:
 * that Chat itself signed it, and that it was meant for this Cloud project
 * rather than somebody else's. Both, or the request is refused.
 */

const CHAT_ISSUER = "chat@system.gserviceaccount.com";
const CERT_URL =
  `https://www.googleapis.com/service_accounts/v1/metadata/x509/${CHAT_ISSUER}`;

/*
 * Google's signing certificates, held briefly.
 *
 * Fetching them on every message would put a round trip to Google in front of
 * every reply. They rotate slowly, so an hour is short enough to follow a
 * rotation and long enough that the fetch is rare. A failure to refresh falls
 * back to nothing rather than to the old copy -- refusing messages is the safe
 * direction when the thing being cached is what decides trust.
 */
let certs: { value: Record<string, string>; until: number } | null = null;

async function signingCerts(): Promise<Record<string, string>> {
  if (certs && certs.until > Date.now()) return certs.value;
  const res = await fetch(CERT_URL);
  if (!res.ok) throw new Error(`Could not fetch Google's certificates: ${res.status}`);
  const value = (await res.json()) as Record<string, string>;
  certs = { value, until: Date.now() + 3600_000 };
  return value;
}

export type ChatEventKind =
  | "MESSAGE"
  | "ADDED_TO_SPACE"
  | "REMOVED_FROM_SPACE"
  | "CARD_CLICKED"
  | "UNKNOWN";

export type ChatEvent = {
  kind: ChatEventKind;
  /** Which shape the request came in, so the reply goes back in the same one. */
  isAddOn: boolean;
  /** Verified by Google, not read from the body. The whole model rests on it. */
  senderEmail: string;
  senderName: string | null;
  text: string;
  spaceName: string | null;
  /** Set for a message in a thread, so the reply lands in the same thread. */
  threadName: string | null;
  /** True for a one-to-one chat with Gaib rather than a group space. */
  isDirectMessage: boolean;
};

/**
 * Check the signature, then read the event.
 *
 * Returns null on anything suspect rather than throwing, so the caller answers
 * 401 and says nothing about why. A verification error that explains itself is
 * a verification error that helps somebody work out what to forge next.
 */
export async function verifyAndParse(
  authorization: string | null,
  body: unknown
): Promise<ChatEvent | null> {
  const bearer = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : null;
  if (!bearer) return null;

  return (await verifySignature(bearer)) ? read(body) : null;
}

/*
 * Two ways in, because Google signs the request differently depending on a
 * setting in the Chat configuration, and neither is more correct than the
 * other.
 *
 *   Project Number  a token Chat signs itself, checked against that account's
 *                   published certificates, addressed to the Cloud project
 *   App URL         an ordinary Google identity token, addressed to this
 *                   endpoint's own address
 *
 * Supporting both means the setting can be either without anybody having to
 * remember which, and a Console change cannot silently break this. Both are
 * strict: whichever shape arrives has to be signed by Google and addressed to
 * us, or it is refused.
 */
async function verifySignature(bearer: string): Promise<boolean> {
  const client = new OAuth2Client();

  const projectNumber = process.env.GOOGLE_CHAT_PROJECT_NUMBER;
  if (projectNumber) {
    try {
      await client.verifySignedJwtWithCertsAsync(
        bearer, await signingCerts(), projectNumber, [CHAT_ISSUER]
      );
      return true;
    } catch {
      // Falls through to the other shape rather than refusing here -- this one
      // failing is expected when the setting is the other way round.
    }
  }

  /*
   * Derived rather than configured. In this mode the audience Google signs for
   * is this endpoint's own address, which is already known from the site URL --
   * asking somebody to type it into Vercel as well would be one more place for
   * the two to disagree.
   */
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  const audience = process.env.GOOGLE_CHAT_AUDIENCE_URL
    ?? (site ? `${site.replace(/\/$/, "")}/api/gaib/google-chat` : null);

  if (audience) {
    try {
      const ticket = await client.verifyIdToken({ idToken: bearer, audience });
      const claims = ticket.getPayload();
      /*
       * The audience is checked by verifyIdToken; the issuer is checked here
       * because that method accepts any Google identity token and only this
       * pair of issuers belongs to Google itself.
       */
      const issuer = claims?.iss ?? "";
      return issuer === "https://accounts.google.com" || issuer === "accounts.google.com";
    } catch {
      return false;
    }
  }

  return false;
}

/*
 * Two payload shapes, because a Chat app and a Workspace add-on that extends
 * Chat send completely different requests -- and the Console decides which this
 * is with a checkbox that cannot be unticked once set.
 *
 *   classic  { type, message, space } at the top level
 *   add-on   { chat: { messagePayload: { message, space } }, commonEventObject }
 *
 * Both are read, because being wrong about which one this is should not be a
 * silence. The add-on shape is checked first: it is what this app actually is.
 */

type Message = {
  text?: string;
  argumentText?: string;
  sender?: { email?: string; displayName?: string };
  thread?: { name?: string };
};
type Space = { name?: string; type?: string; spaceType?: string; singleUserBotDm?: boolean };

type Payload = {
  // classic
  type?: string;
  message?: Message;
  user?: { email?: string; displayName?: string };
  space?: Space;
  // add-on
  chat?: {
    user?: { email?: string; displayName?: string };
    messagePayload?: { message?: Message; space?: Space };
    addedToSpacePayload?: { space?: Space };
    removedFromSpacePayload?: { space?: Space };
    appCommandPayload?: { message?: Message; space?: Space };
  };
};

function read(body: unknown): ChatEvent | null {
  const p = (body ?? {}) as Payload;
  const chat = p.chat;

  const addOnMessage = chat?.messagePayload ?? chat?.appCommandPayload;

  const message: Message | undefined = addOnMessage?.message ?? p.message;
  const space: Space | undefined =
    addOnMessage?.space
    ?? chat?.addedToSpacePayload?.space
    ?? chat?.removedFromSpacePayload?.space
    ?? p.space;

  /*
   * The sender comes from Google inside the signed request, never from anything
   * a person typed. That is the property the whole permission model rests on,
   * so every branch here reads a field Google set.
   */
  const email = message?.sender?.email ?? chat?.user?.email ?? p.user?.email ?? "";
  if (!email) return null;

  let kind: ChatEventKind = "UNKNOWN";
  if (chat) {
    if (chat.messagePayload || chat.appCommandPayload) kind = "MESSAGE";
    else if (chat.addedToSpacePayload) kind = "ADDED_TO_SPACE";
    else if (chat.removedFromSpacePayload) kind = "REMOVED_FROM_SPACE";
  } else if (
    p.type === "MESSAGE" || p.type === "ADDED_TO_SPACE" ||
    p.type === "REMOVED_FROM_SPACE" || p.type === "CARD_CLICKED"
  ) {
    kind = p.type;
  }

  /*
   * argumentText is the message with the app's own @mention stripped out. In a
   * space the text begins "@Gaib ", and feeding that to the model wastes a line
   * explaining that it is being spoken to.
   */
  const text = (message?.argumentText ?? message?.text ?? "").trim();
  const spaceType = space?.spaceType ?? space?.type;

  return {
    kind,
    isAddOn: Boolean(chat),
    senderEmail: email,
    senderName: message?.sender?.displayName ?? chat?.user?.displayName ?? p.user?.displayName ?? null,
    text,
    spaceName: space?.name ?? null,
    threadName: message?.thread?.name ?? null,
    isDirectMessage: spaceType === "DM" || spaceType === "DIRECT_MESSAGE" || Boolean(space?.singleUserBotDm),
  };
}

/*
 * A reply, in exactly the shape the request came in.
 *
 * A classic Chat app takes { text }. An add-on ignores that and needs the
 * message wrapped three deep under hostAppDataAction. Sending both at once
 * seemed safe and is not: an add-on response carrying an unexpected top-level
 * field is rejected outright, so the endpoint answers 200 with something Chat
 * throws away and the app reads as not responding -- which looks identical to
 * every other failure and is why this took three passes to find.
 *
 * One shape, chosen from what arrived.
 */
export function reply(text: string, event?: { isAddOn: boolean; threadName?: string | null } | null) {
  const message = {
    text,
    ...(event?.threadName ? { thread: { name: event.threadName } } : {}),
  };

  return event?.isAddOn === false
    ? message
    : { hostAppDataAction: { chatDataAction: { createMessageAction: { message } } } };
}
