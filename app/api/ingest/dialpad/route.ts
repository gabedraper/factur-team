import { NextRequest, NextResponse } from "next/server";
import { landEvent, notConfigured, verifyDialpadJwt } from "@/lib/ingest/activity-events";

/*
 * Dialpad's call events, landed as activity.
 *
 * Dialpad POSTs one event per change of state -- ringing, connected, hangup --
 * and only the last carries the duration. Every event lands on the same row
 * (keyed on call_id, payloads merged) and the row is handed to the resolver
 * once the state is a final one.
 *
 * Setting it up, once, against Dialpad's API:
 *   1. POST /api/v2/webhooks   { hook_url: "<site>/api/ingest/dialpad", secret: <random> }
 *   2. POST /api/v2/subscriptions/call
 *        { webhook_id, call_states: ["connected", "hangup", "missed", "voicemail"] }
 *   3. Put the same secret in DIALPAD_INGEST_SECRET.
 *
 * With a secret set, Dialpad sends the event as an HS256 JWT signed with it.
 * The secret is required: an unsigned endpoint would let anyone who found the
 * URL put calls that never happened on people's timelines.
 */

export const dynamic = "force-dynamic";

const SECRET = process.env.DIALPAD_INGEST_SECRET;
const FINAL = new Set(["hangup", "missed", "voicemail"]);

export async function POST(request: NextRequest) {
  if (!SECRET) return notConfigured("Dialpad");

  const event = verifyDialpadJwt(await request.text(), SECRET);
  if (!event) return new NextResponse("Invalid signature.", { status: 403 });

  const callId = event.call_id === undefined || event.call_id === null ? "" : String(event.call_id);
  if (!callId) return NextResponse.json({ ok: true, ignored: "no call_id" });

  const state = typeof event.state === "string" ? event.state : null;

  try {
    const landed = await landEvent({
      source: "dialpad",
      externalId: callId,
      eventType: state,
      payload: event,
      ready: state === null || FINAL.has(state),
    });
    return NextResponse.json({ ok: true, ...landed });
  } catch (e) {
    // A 5xx makes Dialpad retry; a row that failed to land should be retried, not lost.
    return new NextResponse(e instanceof Error ? e.message : "Failed", { status: 500 });
  }
}
