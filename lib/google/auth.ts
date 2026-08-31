import { JWT } from "google-auth-library";

/**
 * An access token for reading one person's Google data.
 *
 * The service account cannot see anything by itself -- its own mailbox is
 * empty. Domain-wide delegation lets it ask Google for a token that acts *as*
 * a member of staff, which is the `subject` here. That is the whole mechanism,
 * and it is why the account list matters: Google will hand over a token for
 * anyone in the domain, so the restraint has to live in the code that decides
 * whose name to put in this field.
 */
/*
 * Exported so the Integrations page can show the real list rather than a
 * description of it. A page that restates what the code does drifts from it;
 * one that reads the same constant cannot.
 */
export const SCOPES = {
  gmail: ["https://www.googleapis.com/auth/gmail.readonly"],
  /*
   * Two scopes, not one. Listing the spaces a person is in is governed by
   * `chat.spaces.readonly`; `chat.messages.readonly` only covers reading
   * inside a space you already hold. With just the second, Google still hands
   * over a token and then refuses the first call with "insufficient
   * authentication scopes", which reads as a broken connection rather than a
   * missing grant.
   */
  chat: [
    "https://www.googleapis.com/auth/chat.spaces.readonly",
    "https://www.googleapis.com/auth/chat.messages.readonly",
  ],
  drive: ["https://www.googleapis.com/auth/drive.readonly"],
  directory: ["https://www.googleapis.com/auth/admin.directory.user.readonly"],
  /*
   * The one scope here that is not readonly, and the only one that can put
   * something in front of a customer. `gmail.compose` covers both halves of
   * collections -- leaving a draft in her mailbox, and sending it -- so the
   * delegation needs widening once rather than twice.
   *
   * It is granted per address in Google Admin, not here. Until an admin adds
   * it, every call on this scope comes back 403 and the app says so plainly
   * rather than looking broken.
   */
  compose: ["https://www.googleapis.com/auth/gmail.compose"],
} as const;

export type GoogleService = keyof typeof SCOPES;

function credentials() {
  const raw = process.env.GOOGLE_INGEST_KEY;
  if (!raw) throw new Error("GOOGLE_INGEST_KEY is not set");
  try {
    return JSON.parse(raw) as { client_email: string; private_key: string };
  } catch {
    throw new Error("GOOGLE_INGEST_KEY is not valid JSON");
  }
}

export async function tokenFor(service: GoogleService, actAs: string): Promise<string> {
  const { client_email, private_key } = credentials();

  const jwt = new JWT({
    email: client_email,
    // Vercel's environment strips the newlines out of a pasted key, so they are
    // put back. Without this the signature fails with an error that says
    // nothing about newlines.
    key: private_key.replace(/\\n/g, "\n"),
    scopes: [...SCOPES[service]],
    subject: actAs,
  });

  const { access_token } = await jwt.authorize();
  if (!access_token) throw new Error(`No token for ${actAs} (${service})`);
  return access_token;
}
