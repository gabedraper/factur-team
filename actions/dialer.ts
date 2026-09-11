"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { currentMemberId, myPermissions } from "@/lib/org";
import { assertPipeline } from "@/lib/pipeline/access";

export type VoiceProvider = "dialpad";

/**
 * The dialer's own server-side surface.
 *
 * Placing and hanging up a call happens entirely client-side, by posting
 * messages into Dialpad's embedded Mini Dialer iframe -- nothing here talks
 * to Dialpad for that. What's genuinely ours is picking which reserved number
 * a call goes out from, and provisioning that pool -- see voice_numbers /
 * claim_voice_number.
 */

export async function claimOutboundNumber(
  provider: VoiceProvider
): Promise<{ ok: true; e164: string | null } | { ok: false; error: string }> {
  try {
    await assertPipeline("view");
    const supabase = await createClient();
    const me = await currentMemberId();
    if (!me) return { ok: false, error: "Not signed in as a Factur member." };

    const { data, error } = await supabase.rpc("claim_voice_number", { p_member_id: me, p_provider: provider });
    if (error) return { ok: false, error: `Could not claim an outbound number: ${error.message}` };

    const row = (data as { e164: string }[] | null)?.[0];
    return { ok: true, e164: row?.e164 ?? null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not claim an outbound number." };
  }
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
    // voice_numbers still holds a Telnyx number from before Dialpad was the
    // only dialer. Nothing claims it any more, so it isn't part of the pool.
    .eq("provider", "dialpad")
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
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
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
    if (error) return { ok: false, error: `Could not add that number: ${error.message}` };
    revalidatePath("/settings/dialpad");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not add that number." };
  }
}

export async function setVoiceNumberStatus(id: string, status: "active" | "paused" | "flagged") {
  await assertManage();
  const supabase = await createClient();
  const { error } = await supabase.from("voice_numbers").update({ status }).eq("id", id);
  if (error) throw new Error(`Could not update that number: ${error.message}`);
  revalidatePath("/settings/dialpad");
}

/**
 * Sends one SMS via Dialpad's own Messages API -- a different product from
 * the Mini Dialer CTI embedded elsewhere in this app, which has no
 * server-callable send of its own. Requires DIALPAD_API_KEY, a static key
 * generated in Dialpad's admin portal (Settings, not the OAuth Client
 * ID/Secret the Mini Dialer's CTI app was issued -- that's a different
 * credential for a different product) and, per Dialpad's own docs,
 * "business messaging" registered on the account before this endpoint will
 * accept anything -- a one-time portal step.
 *
 * DIALPAD_SMS_USER_ID picks which licensed Dialpad user the text is sent
 * as; DIALPAD_SMS_FROM_NUMBER picks which of that user's numbers it goes
 * out from. Both optional per Dialpad's API, but almost certainly needed
 * in practice -- an account with multiple users/numbers has to pick one.
 */
export async function sendDialpadSms(to: string, body: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await assertPipeline("view");
    const { DIALPAD_API_KEY, DIALPAD_SMS_USER_ID, DIALPAD_SMS_FROM_NUMBER } = process.env;
    if (!DIALPAD_API_KEY) {
      return { ok: false, error: "Dialpad texting isn't configured yet — needs DIALPAD_API_KEY." };
    }

    const res = await fetch("https://dialpad.com/api/v2/sms", {
      method: "POST",
      headers: { Authorization: `Bearer ${DIALPAD_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        to_numbers: [to],
        text: body,
        ...(DIALPAD_SMS_USER_ID ? { user_id: Number(DIALPAD_SMS_USER_ID) } : {}),
        ...(DIALPAD_SMS_FROM_NUMBER ? { from_number: DIALPAD_SMS_FROM_NUMBER } : {}),
      }),
    });
    if (!res.ok) return { ok: false, error: `Could not send that text: ${res.status} ${await res.text()}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not send that text." };
  }
}
