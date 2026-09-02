import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";

/*
 * What Twilio's servers hit when a rep's browser calls device.connect() --
 * this is the one place that actually decides who gets dialed and from
 * which number. Unauthenticated by our normal session auth (Twilio can't
 * hold a cookie), so it's the request signature that stands in for auth
 * here: without it, anyone who found this URL could make our Twilio numbers
 * call arbitrary numbers at our expense.
 *
 * To and CallerId arrive as POST params because they were passed in
 * device.connect({ params: {...} }) on the browser side -- see
 * components/pipeline/TwilioDialWidget.tsx.
 */
export async function POST(request: NextRequest) {
  const signature = request.headers.get("X-Twilio-Signature");
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

  const form = await request.formData();
  const params: Record<string, string> = {};
  form.forEach((value, key) => { params[key] = String(value); });

  if (!authToken || !siteUrl || !signature) {
    return new NextResponse("Twilio is not configured.", { status: 503 });
  }

  const url = `${siteUrl}/api/twilio/voice`;
  const valid = twilio.validateRequest(authToken, signature, url, params);
  if (!valid) {
    return new NextResponse("Invalid signature.", { status: 403 });
  }

  const to = params.To;
  const callerId = params.CallerId;
  if (!to || !callerId) {
    return new NextResponse("Missing To or CallerId.", { status: 400 });
  }

  const response = new twilio.twiml.VoiceResponse();
  response.dial({ callerId }).number(to);

  return new NextResponse(response.toString(), {
    headers: { "Content-Type": "text/xml" },
  });
}
