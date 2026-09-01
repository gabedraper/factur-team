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
  const projectNumber = process.env.GOOGLE_CHAT_PROJECT_NUMBER;
  if (!projectNumber) return null;

  const bearer = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : null;
  if (!bearer) return null;

  try {
    const client = new OAuth2Client();
    await client.verifySignedJwtWithCertsAsync(
      bearer,
      await signingCerts(),
      projectNumber,
      [CHAT_ISSUER]
    );
  } catch {
    return null;
  }

  return read(body);
}

type Payload = {
  type?: string;
  message?: {
    text?: string;
    argumentText?: string;
    sender?: { email?: string; displayName?: string };
    thread?: { name?: string };
  };
  user?: { email?: string; displayName?: string };
  space?: { name?: string; type?: string; singleUserBotDm?: boolean };
};

function read(body: unknown): ChatEvent | null {
  const p = (body ?? {}) as Payload;

  /*
   * The sender is taken from the message where there is one and from the event
   * otherwise. Both come from Google inside the signed request -- there is no
   * path here that reads an address out of anything a person typed, which is
   * the property that makes the impersonation above impossible rather than
   * merely unlikely.
   */
  const email = p.message?.sender?.email ?? p.user?.email ?? "";
  if (!email) return null;

  const kind: ChatEventKind =
    p.type === "MESSAGE" || p.type === "ADDED_TO_SPACE" ||
    p.type === "REMOVED_FROM_SPACE" || p.type === "CARD_CLICKED"
      ? p.type
      : "UNKNOWN";

  /*
   * argumentText is the message with the app's own @mention stripped out. In a
   * space, text begins "@Gaib " and feeding that to the model wastes a line
   * explaining that it is being spoken to.
   */
  const text = (p.message?.argumentText ?? p.message?.text ?? "").trim();

  return {
    kind,
    senderEmail: email,
    senderName: p.message?.sender?.displayName ?? p.user?.displayName ?? null,
    text,
    spaceName: p.space?.name ?? null,
    threadName: p.message?.thread?.name ?? null,
    isDirectMessage: p.space?.type === "DM" || Boolean(p.space?.singleUserBotDm),
  };
}

/** A plain reply, which is all Chat needs for text. */
export function reply(text: string, threadName?: string | null) {
  return {
    text,
    ...(threadName ? { thread: { name: threadName } } : {}),
  };
}
