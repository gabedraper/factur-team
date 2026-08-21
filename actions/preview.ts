"use server";

import { cookies } from "next/headers";
import { createServiceClient } from "@/lib/supabase/server";
import { myRealPermissions } from "@/lib/org";

const HOUR = 60 * 60;

/** Preview is an admin tool, so every setter checks the *real* user's rights. */
async function requirePreviewRights() {
  const perms = await myRealPermissions();
  return perms.has("org.manage");
}

export async function setPreviewRole(role: string) {
  if (!(await requirePreviewRights())) return;
  const jar = await cookies();
  jar.set("preview_role", role, { path: "/", httpOnly: true, maxAge: HOUR });
  // Previewing a role and a person at once would be two answers to the same
  // question, so picking one clears the other.
  jar.delete("preview_member");
}

export async function clearPreviewRole() {
  const jar = await cookies();
  jar.delete("preview_role");
}

/** See the app as one specific person sees it, permissions and all. */
export async function setPreviewUser(memberId: string) {
  if (!(await requirePreviewRights())) return { success: false, error: "Not permitted." };

  const db = createServiceClient();
  const { data } = await db
    .from("org_members").select("id,full_name,email").eq("id", memberId).maybeSingle();
  if (!data) return { success: false, error: "No such person." };

  const jar = await cookies();
  jar.set("preview_member", memberId, { path: "/", httpOnly: true, maxAge: HOUR });
  jar.delete("preview_role");
  return { success: true };
}

export async function clearPreviewUser() {
  const jar = await cookies();
  jar.delete("preview_member");
}
