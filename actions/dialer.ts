"use server";

import { revalidatePath } from "next/cache";
import twilio from "twilio";
import { createClient } from "@/lib/supabase/server";
import { currentMemberId, myPermissions } from "@/lib/org";
import { assertPipeline } from "@/lib/pipeline/access";

export type VoiceProvider = "dialpad" | "twilio" | "telnyx";

/**
 * The dialer's own server-side surface, shared across whichever voice
 * provider is actually wired up.
 *
 * Dialpad: placing and hanging up a call happens entirely client-side, by
 * posting messages into the embedded Mini Dialer iframe -- nothing here
 * talks to Dialpad for that. Twilio: the browser holds a real WebRTC call
 * via the Voice SDK, authenticated with the access token this file issues;
 * the actual dial-out happens when Twilio's servers hit
 * app/api/twilio/voice, not here either. What's genuinely ours either way is
 * picking which reserved number a call goes out from, and provisioning that
 * pool -- see voice_numbers / claim_voice_number.
 */

export async function claimOutboundNumber(provider: VoiceProvider): Promise<string | null> {
  await assertPipeline("view");
  const supabase = await createClient();
  const me = await currentMemberId();
  if (!me) throw new Error("Not signed in as a Factur member.");

  const { data, error } = await supabase.rpc("claim_voice_number", { p_member_id: me, p_provider: provider });
  if (error) throw new Error(`Could not claim an outbound number: ${error.message}`);

  const row = (data as { e164: string }[] | null)?.[0];
  return row?.e164 ?? null;
}

export type VoiceNumberRow = {
  id: string;
  e164: string;
  label: string | null;
  provider: VoiceProvider;
  assigned_member_id: string | null;
  assigned_member_name: string | null;
  status: "active" | "paused" | "flagged";
  last_used_at: string | null;
  calls_placed: number;
};

async function assertManage() {
  const perms = await myPermissions();
  if (!perms.has("org.manage")) throw new Error("Forbidden: org.manage required");
}

export async function listVoiceNumbers(): Promise<VoiceNumberRow[]> {
  await assertManage();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("voice_numbers")
    .select("id,e164,label,provider,assigned_member_id,status,last_used_at,calls_placed,org_members(full_name)")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Could not load the number pool: ${error.message}`);

  return (data as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    e164: r.e164 as string,
    label: r.label as string | null,
    provider: r.provider as VoiceProvider,
    assigned_member_id: r.assigned_member_id as string | null,
    assigned_member_name: (r.org_members as { full_name: string | null } | null)?.full_name ?? null,
    status: r.status as VoiceNumberRow["status"],
    last_used_at: r.last_used_at as string | null,
    calls_placed: r.calls_placed as number,
  }));
}

export async function addVoiceNumber(input: {
  e164: string; provider: VoiceProvider; label?: string | null; assigned_member_id?: string | null;
}) {
  await assertManage();
  const supabase = await createClient();
  const me = await currentMemberId();

  const { error } = await supabase.from("voice_numbers").insert({
    e164: input.e164,
    provider: input.provider,
    label: input.label ?? null,
    assigned_member_id: input.assigned_member_id ?? null,
    created_by: me,
  });
  if (error) throw new Error(`Could not add that number: ${error.message}`);
  revalidatePath("/settings/dialpad");
}

export async function setVoiceNumberStatus(id: string, status: "active" | "paused" | "flagged") {
  await assertManage();
  const supabase = await createClient();
  const { error } = await supabase.from("voice_numbers").update({ status }).eq("id", id);
  if (error) throw new Error(`Could not update that number: ${error.message}`);
  revalidatePath("/settings/dialpad");
}

/**
 * A short-lived token authenticating the current rep's browser to Twilio's
 * Voice SDK. Identity is their member id, not name/email -- Twilio uses it
 * to route inbound calls and shows up in call logs, and a member id is
 * stable across a name change in a way "Jane Doe" isn't.
 *
 * Requires TWILIO_ACCOUNT_SID, TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET and
 * TWILIO_TWIML_APP_SID. Returns null (rather than throwing) when they're not
 * set, so the widget can render its own "not connected" state.
 */
export async function getTwilioVoiceToken(): Promise<string | null> {
  await assertPipeline("view");
  const { TWILIO_ACCOUNT_SID, TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET, TWILIO_TWIML_APP_SID } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_API_KEY_SID || !TWILIO_API_KEY_SECRET || !TWILIO_TWIML_APP_SID) return null;

  const me = await currentMemberId();
  if (!me) throw new Error("Not signed in as a Factur member.");

  const AccessToken = twilio.jwt.AccessToken;
  const VoiceGrant = AccessToken.VoiceGrant;

  const token = new AccessToken(TWILIO_ACCOUNT_SID, TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET, { identity: me });
  token.addGrant(new VoiceGrant({ outgoingApplicationSid: TWILIO_TWIML_APP_SID, incomingAllow: false }));
  return token.toJwt();
}

/**
 * Same job as getTwilioVoiceToken, for Telnyx -- but Telnyx has no
 * in-process JWT signing helper, this is a real REST call to their API
 * (POST /v2/telephony_credentials/{id}/token) using TELNYX_API_KEY, scoped
 * to a credential you create once in the Telnyx portal or API
 * (TELNYX_CREDENTIAL_ID). The credential is the identity the token proves --
 * unlike Twilio, there's no per-rep `identity` param here, so every rep
 * currently authenticates as the same credential. Fine for now; if per-rep
 * call attribution in Telnyx's own logs ever matters, that needs one
 * credential per rep instead of one shared one.
 *
 * Response shape is documented inconsistently (a bare JWT string in some
 * examples, {"data":{"token":...}} in others going by Telnyx's usual v2
 * envelope) -- handled defensively below rather than assumed, and worth
 * confirming against the real response the first time this actually runs.
 */
export async function getTelnyxVoiceToken(): Promise<string | null> {
  await assertPipeline("view");
  const { TELNYX_API_KEY, TELNYX_CREDENTIAL_ID } = process.env;
  if (!TELNYX_API_KEY || !TELNYX_CREDENTIAL_ID) return null;

  const res = await fetch(`https://api.telnyx.com/v2/telephony_credentials/${TELNYX_CREDENTIAL_ID}/token`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TELNYX_API_KEY}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw new Error(`Could not get a Telnyx token: ${res.status} ${await res.text()}`);

  const text = await res.text();
  try {
    const parsed = JSON.parse(text) as { data?: { token?: string } | string; token?: string };
    if (typeof parsed.data === "string") return parsed.data;
    if (typeof parsed.data === "object" && parsed.data?.token) return parsed.data.token;
    if (typeof parsed.token === "string") return parsed.token;
  } catch {
    // Not JSON -- the bare-JWT-string response shape.
  }
  return text.trim() || null;
}
