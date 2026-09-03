import { NextRequest, NextResponse } from "next/server";
import Telnyx from "telnyx";

/*
 * What Telnyx's servers hit when a rep's browser calls client.newCall() --
 * the TeXML equivalent of app/api/twilio/voice, same reasoning: this is the
 * one place that decides who gets dialed and from which number, and it's
 * unauthenticated by our normal session auth, so the Ed25519 signature
 * verification stands in for that.
 *
 * To (destination) and From (caller ID, set by callerNumber in newCall())
 * arrive as standard TeXML POST fields -- Telnyx's TeXML layer mirrors
 * Twilio's To/From convention on purpose, no custom params needed for
 * either of those.
 */
export async function POST(request: NextRequest) {
  const apiKey = process.env.TELNYX_API_KEY;
  const publicKey = process.env.TELNYX_PUBLIC_KEY;
  const signature = request.headers.get("telnyx-signature-ed25519");
  const timestamp = request.headers.get("telnyx-timestamp");

  const rawBody = await request.text();

  if (!apiKey || !publicKey || !signature || !timestamp) {
    return new NextResponse("Telnyx is not configured.", { status: 503 });
  }

  const telnyx = new Telnyx({ apiKey, publicKey });
  try {
    await telnyx.webhooks.unwrap(rawBody, {
      headers: {
        "telnyx-signature-ed25519": signature,
        "telnyx-timestamp": timestamp,
      },
    });
  } catch {
    return new NextResponse("Invalid signature.", { status: 403 });
  }

  const params = new URLSearchParams(rawBody);
  const to = params.get("To");
  const callerId = params.get("From");
  if (!to || !callerId) {
    return new NextResponse("Missing To or From.", { status: 400 });
  }

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response><Dial callerId="${callerId}"><Number>${to}</Number></Dial></Response>`;

  return new NextResponse(xml, { headers: { "Content-Type": "text/xml" } });
}
