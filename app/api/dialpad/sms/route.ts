import { NextRequest, NextResponse } from "next/server";
import { verifyDialpadWebhook } from "@/lib/dialpad/webhook";
import { recordSms } from "@/lib/dialpad/sms-log";

/*
 * Dialpad's SMS events, written to the text log.
 *
 * The Mini Dialer's own compose box and the standalone Dialpad app both send
 * straight to Dialpad's servers -- neither passes through anything of ours --
 * so without this, a text sent from either place was invisible to the app.
 * Subscribing to SMS events fixes that the same way /api/dialpad/events fixes
 * it for calls: Dialpad POSTs one event per message here, whichever surface
 * sent it.
 *
 * Setting it up, once, against Dialpad's API:
 *   1. POST /api/v2/webhooks   { hook_url: "<site>/api/dialpad/sms", secret: <same secret as the call-events webhook, or a new one> }
 *   2. POST /api/v2/subscriptions/sms
 *        { endpoint_id: <id from step 1>, direction: "all", status: true }
 *   3. Put the secret in DIALPAD_WEBHOOK_SECRET, if it isn't set already.
 *
 * Dialpad omits the message text by default for privacy. To get `text` in
 * the payload, the API key used for step 2 needs the message_content_export
 * scope (or message_content_export:all for an unscoped subscription) --
 * without it every row here records a text happened but not what it said.
 *
 * As with call events, a secret is required rather than optional: an
 * unsigned endpoint would let anyone who found the URL fill the log with
 * texts that never happened.
 */

const SECRET = process.env.DIALPAD_WEBHOOK_SECRET;

type DialpadSms = {
  id?: number | string;
  created_date?: number | string | null;
  text?: string | null;
  direction?: string;
  mms?: boolean;
  from_number?: string | null;
  to_number?: (string | null)[] | string | null;
  target?: { phone_number?: string | null } | null;
  contact?: { name?: string | null; phone_number?: string | null } | null;
  message_status?: string | null;
  message_delivery_result?: string | null;
};

function iso(ms: number | string | null | undefined): string | null {
  if (ms === null || ms === undefined || ms === "") return null;
  const d = new Date(Number(ms));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Dialpad documents to_number as an array; some payloads may not bother. */
function firstTo(to: DialpadSms["to_number"]): string | null {
  if (Array.isArray(to)) return to[0] ?? null;
  return to ?? null;
}

export async function POST(request: NextRequest) {
  if (!SECRET) return new NextResponse("Dialpad webhooks are not configured.", { status: 503 });

  const event = verifyDialpadWebhook(await request.text(), SECRET) as DialpadSms | null;
  if (!event) return new NextResponse("Invalid signature.", { status: 403 });

  const id = event.id === undefined || event.id === null ? "" : String(event.id);
  if (!id) return NextResponse.json({ ok: true, ignored: "no id" });

  try {
    await recordSms({
      provider: "dialpad",
      providerMessageId: id,
      direction: event.direction === "inbound" ? "inbound" : "outbound",
      mms: Boolean(event.mms),
      from: event.from_number ?? null,
      to: firstTo(event.to_number),
      body: event.text ?? null,
      internalNumber: event.target?.phone_number ?? null,
      contactName: event.contact?.name ?? null,
      messageStatus: event.message_status ?? null,
      messageDeliveryResult: event.message_delivery_result ?? null,
      sentAt: iso(event.created_date) ?? new Date().toISOString(),
      raw: event,
    });
  } catch (e) {
    // A 5xx makes Dialpad retry; a bad row should be retried, not swallowed.
    return new NextResponse(e instanceof Error ? e.message : "Failed", { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
