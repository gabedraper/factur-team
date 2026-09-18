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
 * "<timestamp>.<body>">`. Their sample verifies against the request body as
 * a string; whether that is the bytes on the wire or a re-serialised copy is
 * not said, so both are accepted. The timestamp is checked loosely -- it is
 * not documented whether it is seconds or milliseconds -- to refuse a replay
 * from another day without refusing a clock that is a few minutes off.
 *
 * Returns why it failed, for the feed, rather than just that it did.
 */
export type OrumSignatureCheck = { ok: true } | { ok: false; reason: string; detail?: Record<string, unknown> };

export function checkOrumSignature(rawBody: string, header: string | null, key: string): OrumSignatureCheck {
  if (!header) return { ok: false, reason: "no x-webhook-signature header" };
  const fields = Object.fromEntries(
    header.split(",").map((kv) => {
      const i = kv.indexOf("=");
      return i < 0 ? [kv.trim(), ""] : [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
    })
  ) as Record<string, string>;
  const t = fields.t;
  const s = fields.s;
  if (!t || !s) return { ok: false, reason: "header is not t=...,s=...", detail: { header: header.slice(0, 120) } };

  const n = Number(t);
  if (Number.isFinite(n)) {
    const ms = n > 1e11 ? n : n * 1000;
    if (Math.abs(Date.now() - ms) > 24 * 60 * 60 * 1000) {
      return { ok: false, reason: "timestamp more than a day off", detail: { t } };
    }
  }

  const candidates: [string, string][] = [["raw", rawBody]];
  try {
    const again = JSON.stringify(JSON.parse(rawBody));
    if (again !== rawBody) candidates.push(["restringified", again]);
  } catch {
    // not JSON; the raw form is all there is
  }
  for (const [, body] of candidates) {
    const expected = createHmac("sha256", key).update(`${t}.${body}`).digest("base64");
    if (safeEqual(s, expected)) return { ok: true };
  }
  const expectedRaw = createHmac("sha256", key).update(`${t}.${rawBody}`).digest("base64");
  return {
    ok: false,
    reason: "signature does not match the key",
    detail: { t, got: s.slice(0, 8), expected: expectedRaw.slice(0, 8), bodyBytes: rawBody.length, forms: candidates.map((c) => c[0]) },
  };
}

export function verifyOrumSignature(rawBody: string, header: string | null, key: string): boolean {
  return checkOrumSignature(rawBody, header, key).ok;
}

/**
 * A request that failed its signature check, kept on the feed so a
 * misconfiguration is visible rather than a silent 403. Written as failed
 * with the retry budget spent, so the resolver never treats it as real.
 */
export async function landUnverified(source: IngestSource, rawBody: string, reason: string, detail?: Record<string, unknown>): Promise<void> {
  const db = createServiceClient();
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    payload = { raw: rawBody.slice(0, 2000) };
  }
  await db.from("activity_events").upsert(
    {
      source,
      external_id: `unverified:${digestId(rawBody)}`,
      event_type: "unverified",
      payload,
      status: "failed",
      attempts: 5,
      resolution: { error: `rejected: ${reason}`, ...(detail ? { detail } : {}) },
    },
    { onConflict: "source,external_id" }
  );
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
