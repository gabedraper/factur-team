import { createHmac, timingSafeEqual } from "node:crypto";

/*
 * Checking that a webhook actually came from Dialpad.
 *
 * With a secret configured on the Dialpad side, they send the event body as a
 * JWT signed with it (HS256) instead of plain JSON -- shared by the call and
 * SMS event routes rather than each re-implementing it, since a bug in
 * signature verification is exactly the kind of thing that should only be
 * possible to get wrong once.
 */

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The event inside the JWT, or null when the signature does not hold. */
export function verifyDialpadWebhook(token: string, secret: string): Record<string, unknown> | null {
  const parts = token.trim().split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  const expected = b64url(createHmac("sha256", secret).update(`${header}.${payload}`).digest());
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}
