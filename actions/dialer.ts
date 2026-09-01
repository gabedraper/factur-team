"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { currentMemberId, myPermissions } from "@/lib/org";
import { assertPipeline } from "@/lib/pipeline/access";

/**
 * The dialer's own server-side surface.
 *
 * Placing and hanging up a call happens entirely client-side, by posting
 * messages straight into the embedded Dialpad Mini Dialer iframe -- see
 * components/pipeline/DialWidget.tsx. Nothing here talks to Dialpad. What's
 * here is the one thing that's genuinely ours: picking which reserved
 * number a call goes out from, and provisioning that pool.
 */

export async function claimOutboundNumber(): Promise<string | null> {
  await assertPipeline("view");
  const supabase = await createClient();
  const me = await currentMemberId();
  if (!me) throw new Error("Not signed in as a Factur member.");

  const { data, error } = await supabase.rpc("claim_dialpad_number", { p_member_id: me });
  if (error) throw new Error(`Could not claim an outbound number: ${error.message}`);

  const row = (data as { e164: string }[] | null)?.[0];
  return row?.e164 ?? null;
}

export type DialpadNumberRow = {
  id: string;
  e164: string;
  label: string | null;
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

export async function listDialpadNumbers(): Promise<DialpadNumberRow[]> {
  await assertManage();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("dialpad_numbers")
    .select("id,e164,label,assigned_member_id,status,last_used_at,calls_placed,org_members(full_name)")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Could not load the number pool: ${error.message}`);

  return (data as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    e164: r.e164 as string,
    label: r.label as string | null,
    assigned_member_id: r.assigned_member_id as string | null,
    assigned_member_name: (r.org_members as { full_name: string | null } | null)?.full_name ?? null,
    status: r.status as DialpadNumberRow["status"],
    last_used_at: r.last_used_at as string | null,
    calls_placed: r.calls_placed as number,
  }));
}

export async function addDialpadNumber(input: { e164: string; label?: string | null; assigned_member_id?: string | null }) {
  await assertManage();
  const supabase = await createClient();
  const me = await currentMemberId();

  const { error } = await supabase.from("dialpad_numbers").insert({
    e164: input.e164,
    label: input.label ?? null,
    assigned_member_id: input.assigned_member_id ?? null,
    created_by: me,
  });
  if (error) throw new Error(`Could not add that number: ${error.message}`);
  revalidatePath("/settings/dialpad");
}

export async function setDialpadNumberStatus(id: string, status: "active" | "paused" | "flagged") {
  await assertManage();
  const supabase = await createClient();
  const { error } = await supabase.from("dialpad_numbers").update({ status }).eq("id", id);
  if (error) throw new Error(`Could not update that number: ${error.message}`);
  revalidatePath("/settings/dialpad");
}
