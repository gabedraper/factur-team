import { NextRequest, NextResponse } from "next/server";
import { digestId, landEvent, notConfigured, pick, verifyOrumSignature } from "@/lib/ingest/activity-events";

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
  if (!verifyOrumSignature(raw, request.headers.get("x-webhook-signature"), KEY)) {
    return new NextResponse("Invalid signature.", { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return new NextResponse("Not JSON.", { status: 400 });
  }

  const inner = (body.payload && typeof body.payload === "object" ? body.payload : body) as Record<string, unknown>;
  const recording = pick(inner, "recording_url", "recordingUrl", "recording", "call_recording", "recording.url");
  const externalId =
    pick(inner, "call_id", "callId", "id", "call.id")
    ?? (recording ? recording.replace(/^.*\//, "") : null)
    ?? digestId(
      pick(inner, "user_email", "userEmail", "user.email"),
      pick(inner, "prospect_phone", "prospectPhone", "phone_number", "phone"),
      pick(inner, "datetime", "date_time", "started_at", "timestamp", "created_at")
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
