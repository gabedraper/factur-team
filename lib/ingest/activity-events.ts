import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

/*
 * Landing a vendor's event.
 *
 * Every ingest route does the same three things: prove the request came from
 * the vendor, write the event down exactly as received, and have the resolver
 * try it straight away so a call shows on the timeline in seconds rather than
 * on the next cron tick. This is those three things. What each vendor's
 * payload means is not decided here -- activity_event_facts() in the database
 * reads it, so a renamed field is fixed once, in SQL, for both the live path
 * and a re-run over what was already stored.
 */

export type IngestSource = "dialpad" | "orum" | "mixmax";

export type LandedEvent = {
  id: string | null;
  status: string;
  isNew: boolean;
  /** What the resolver made of it, when it ran. */
  resolved?: string;
};

export async function landEvent(e: {
  source: IngestSource;
  externalId: string;
  eventType?: string | null;
  payload: unknown;
  /** False while the vendor says the thing is still under way. */
  ready?: boolean;
  /** A route that knows whose event this is (a per-user Mixmax rule) says so. */
  memberEmail?: string | null;
  /** Skip the inline resolve -- a burst is better left to the cron. */
  resolveNow?: boolean;
}): Promise<LandedEvent> {
  const db = createServiceClient();
  const { data, error } = await db.rpc("land_activity_event", {
    p_source: e.source,
    p_external_id: e.externalId,
    p_event_type: e.eventType ?? null,
    p_payload: e.payload ?? {},
    p_ready: e.ready ?? true,
    p_member_email: e.memberEmail ?? null,
  });
  if (error) throw new Error(`land_activity_event failed: ${error.message}`);
  const row = ((data ?? []) as { event_id: string; event_status: string; is_new: boolean }[])[0];
  if (!row) throw new Error("land_activity_event returned nothing");

  const out: LandedEvent = { id: row.event_id, status: row.event_status, isNew: row.is_new };

  if ((e.resolveNow ?? true) && row.event_status === "pending") {
    // Best effort: the every-minute cron picks up whatever this does not.
    const { data: r } = await db.rpc("resolve_activity_event", { p_id: row.event_id });
    if (typeof r === "string") out.resolved = r;
  }
  return out;
}

/** A stable id for a payload that carries none of its own. */
export function digestId(...parts: (string | null | undefined)[]): string {
  return createHash("sha1").update(parts.map((p) => p ?? "").join("|")).digest("hex");
}

/** The first string among the candidate keys, dotted paths allowed. */
export function pick(obj: unknown, ...keys: string[]): string | null {
  if (!obj || typeof obj !== "object") return null;
  for (const key of keys) {
    let cur: unknown = obj;
    for (const part of key.split(".")) {
      if (!cur || typeof cur !== "object") { cur = undefined; break; }
      cur = (cur as Record<string, unknown>)[part];
    }
    if (cur === null || cur === undefined) continue;
    if (typeof cur === "string" && cur.trim()) return cur.trim();
    if (typeof cur === "number" || typeof cur === "boolean") return String(cur);
  }
  return null;
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Dialpad signs each event as an HS256 JWT with the secret given when the
 * webhook was created. The event is the JWT's payload. Null when the
 * signature does not hold, and the route answers 403.
 */
export function verifyDialpadJwt(token: string, secret: string): Record<string, unknown> | null {
  const parts = token.trim().split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  const expected = createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  if (!safeEqual(signature, expected)) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * Orum's dialer signs with the key chosen in Settings > System > Webhooks:
 * header `x-webhook-signature: t=<timestamp>,s=<base64 HMAC-SHA256 of
 * "<timestamp>.<raw body>">`. The timestamp is checked loosely -- it is not
 * documented whether it is seconds or milliseconds -- to refuse a replay from
 * another day without refusing a clock that is a few minutes off.
 */
export function verifyOrumSignature(rawBody: string, header: string | null, key: string): boolean {
  if (!header) return false;
  const fields = Object.fromEntries(
    header.split(",").map((kv) => {
      const i = kv.indexOf("=");
      return i < 0 ? [kv.trim(), ""] : [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
    })
  ) as Record<string, string>;
  const t = fields.t;
  const s = fields.s;
  if (!t || !s) return false;

  const n = Number(t);
  if (Number.isFinite(n)) {
    const ms = n > 1e11 ? n : n * 1000;
    if (Math.abs(Date.now() - ms) > 24 * 60 * 60 * 1000) return false;
  }

  const expected = createHmac("sha256", key).update(`${t}.${rawBody}`).digest("base64");
  return safeEqual(s, expected);
}

/** A shared token for vendors that cannot sign: header first, query string second. */
export function bearerOk(request: Request, expected: string | undefined): boolean {
  if (!expected) return false;
  const url = new URL(request.url);
  const offered =
    request.headers.get("x-ingest-token")
    ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
    ?? url.searchParams.get("token");
  return !!offered && safeEqual(offered, expected);
}

export function notConfigured(what: string) {
  return new NextResponse(`${what} webhooks are not configured.`, { status: 503 });
}
