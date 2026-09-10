"use server";

import { cookies } from "next/headers";
import { createClient, createServiceClient } from "@/lib/supabase/server";

const HOUR = 60 * 60;

/**
 * Preview is a managers' tool, so every setter checks the *real* user's rights
 * against the person being previewed. public.can_preview_as() is the single
 * definition -- admins may preview anyone, team leads and managers only inside
 * their own reporting line, everyone else not at all -- and the same function
 * guards my_client_ids(), so refusing here and refusing there cannot drift
 * apart.
 */
async function mayPreview(memberId: string) {
  const db = await createClient();
  const { data } = await db.rpc("can_preview_as", { p_target: memberId });
  return data === true;
}

/** See the app as one specific person sees it, permissions and all. */
export async function setPreviewUser(memberId: string) {
  if (!(await mayPreview(memberId))) return { success: false, error: "Not permitted." };

  const db = createServiceClient();
  const { data } = await db
    .from("org_members").select("id,full_name,email").eq("id", memberId).maybeSingle();
  if (!data) return { success: false, error: "No such person." };

  const jar = await cookies();
  jar.set("preview_member", memberId, { path: "/", httpOnly: true, maxAge: HOUR });
  return { success: true };
}

export async function clearPreviewUser() {
  const jar = await cookies();
  jar.delete("preview_member");
}
