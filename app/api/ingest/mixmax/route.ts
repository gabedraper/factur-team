import { NextRequest, NextResponse } from "next/server";
import { bearerOk, digestId, landEvent, notConfigured, pick } from "@/lib/ingest/activity-events";

/*
 * Mixmax's message events, landed as activity.
 *
 * A Mixmax Rule with a Webhook action POSTs each event -- message:sent,
 * message:received, opened, clicked -- as JSON. Rules do not sign, so the
 * URL carries a token instead: <site>/api/ingest/mixmax?token=<MIXMAX_WEBHOOK_TOKEN>
 * (a header, x-ingest-token, works too). A rule made by one person rather
 * than for the workspace may not say whose it is; add &member=<email> to the
 * URL and the event is theirs.
 *
 * Only sent and received messages become activity. Opens and clicks land and
 * are marked skipped, so they are on record without being on the timeline.
 * Each message is keyed on its RFC 822 Message-ID where Mixmax gives one, so
 * the same email seen later through the mailbox is recognised as the same.
 */

export const dynamic = "force-dynamic";

const TOKEN = process.env.MIXMAX_WEBHOOK_TOKEN;
const MESSAGE_EVENTS = new Set(["message:sent", "message:received", "message:replied", "sent", "received", "replied"]);

function externalIdFor(event: Record<string, unknown>): string {
  const name = (pick(event, "eventName", "event", "type", "name") ?? "").toLowerCase();
  const message = pick(event, "rfc822Id", "rfc822_id", "messageId", "message_id", "message.id", "_id");
  if (MESSAGE_EVENTS.has(name)) {
    return message ?? digestId(name, pick(event, "userId", "userEmail"), pick(event, "recipientEmail", "email"), pick(event, "subject"), pick(event, "timestamp"));
  }
  return `${name || "event"}:${message ?? digestId(JSON.stringify(event))}:${pick(event, "timestamp") ?? ""}`;
}

export async function POST(request: NextRequest) {
  if (!TOKEN) return notConfigured("Mixmax");
  if (!bearerOk(request, TOKEN)) return new NextResponse("Unauthorized.", { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new NextResponse("Not JSON.", { status: 400 });
  }

  const member = new URL(request.url).searchParams.get("member");
  const events = (Array.isArray(body) ? body : [body]).filter(
    (e): e is Record<string, unknown> => !!e && typeof e === "object"
  );
  if (events.length === 0) return NextResponse.json({ ok: true, ignored: "no event" });

  try {
    const landed = [];
    for (const event of events) {
      landed.push(await landEvent({
        source: "mixmax",
        externalId: externalIdFor(event),
        eventType: pick(event, "eventName", "event", "type", "name"),
        payload: event,
        memberEmail: member,
      }));
    }
    return NextResponse.json({ ok: true, landed });
  } catch (e) {
    return new NextResponse(e instanceof Error ? e.message : "Failed", { status: 500 });
  }
}
