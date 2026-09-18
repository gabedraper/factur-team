import { NextRequest, NextResponse } from "next/server";
import { checkOrumSignature, digestId, landEvent, landUnverified, notConfigured, pick } from "@/lib/ingest/activity-events";

/*
 * Orum's call events, landed as activity.
 *
 * Orum (the dialer) sends one webhook per dispositioned call, wrapped as
 * { event: "call-disposition-added", payload: {...}, test: bool }, and retries
 * up to eight times over half an hour on anything but a 2xx. It does not
 * promise order. Each call lands once, keyed on Orum's call id where the
 * payload carries one, else the recording id, else a digest of who called
 * whom when.
 *
 * Setting it up, once, in Orum: Settings > System > Webhooks, URL
 * <site>/api/ingest/orum, and a signing key of your choosing -- the same
 * string goes in ORUM_WEBHOOK_SIGNING_KEY. Orum then signs each request as
 * x-webhook-signature: t=<timestamp>,s=<base64 HMAC-SHA256 of "<t>.<body>">.
 *
 * Orum's payload field names are not documented, so the first real event is
 * expected to need a look: it lands whole, and the activity feed shows it.
 * The reading of it lives in activity_event_facts() in the database, where a
 * renamed field is fixed once for both the live path and a re-run over what
 * was already stored.
 */

export const dynamic = "force-dynamic";

const KEY = process.env.ORUM_WEBHOOK_SIGNING_KEY;

export async function POST(request: NextRequest) {
  if (!KEY) return notConfigured("Orum");

  const raw = await request.text();
  const check = checkOrumSignature(raw, request.headers.get("x-webhook-signature"), KEY);
  if (!check.ok) {
    // On the feed as rejected, so a wrong key or a changed format is seen, not guessed at.
    await landUnverified("orum", raw, check.reason, check.detail).catch(() => undefined);
    return new NextResponse("Invalid signature.", { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return new NextResponse("Not JSON.", { status: 400 });
  }

  /*
   * The call sits at payload.v1 (seen 2026-09-18; an older shape may sit at
   * payload, and a test at the top). Keyed on the recording id where there
   * is one -- Salesforce keeps the same id on its Task, so the two paths
   * meet by key -- else Orum's own entry id, else a digest of who called
   * whom when.
   */
  const outer = (body.payload && typeof body.payload === "object" ? body.payload : body) as Record<string, unknown>;
  const inner = (outer.v1 && typeof outer.v1 === "object" ? outer.v1 : outer) as Record<string, unknown>;
  const recording = pick(inner, "recordingLink", "recording_url", "recordingUrl", "recording", "call_recording", "recording.url");
  const externalId =
    (recording ? recording.replace(/^.*\//, "") : null)
    ?? pick(inner, "entryID", "entryId", "call_id", "callId", "id", "call.id")
    ?? digestId(
      pick(inner, "repEmail", "user_email", "userEmail", "user.email"),
      pick(inner, "prospectPhoneNumber", "prospect_phone", "prospectPhone", "phone_number", "phone"),
      pick(inner, "calledAt", "datetime", "date_time", "started_at", "timestamp", "created_at")
    );

  try {
    const landed = await landEvent({
      source: "orum",
      externalId,
      eventType: pick(body, "event", "type"),
      payload: body,
    });
    return NextResponse.json({ ok: true, ...landed });
  } catch (e) {
    return new NextResponse(e instanceof Error ? e.message : "Failed", { status: 500 });
  }
}
