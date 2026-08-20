"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { myPermissions } from "@/lib/org";

async function requireOrgManage() {
  const perms = await myPermissions();
  if (!perms.has("org.manage")) throw new Error("Forbidden: org.manage required");
}

/**
 * Add or update one service role for a member, with the share of their time it
 * takes. Someone can hold several -- 60% OBDM, 40% OSDR is a real arrangement --
 * and the database refuses anything summing past full time.
 */
export async function setMemberRoleAllocation(memberId: string, roleId: string, allocation: number) {
  await requireOrgManage();
  if (!(allocation > 0 && allocation <= 100)) {
    return { success: false, error: "Share must be between 1 and 100." };
  }
  const db = createServiceClient();

  const { data: role } = await db
    .from("org_roles").select("service_id").eq("id", roleId).single();
  const serviceId = (role as { service_id: string | null } | null)?.service_id ?? null;

  let teamId: string | null = null;
  if (serviceId) {
    const { data: team } = await db
      .from("org_teams").select("id").eq("service_id", serviceId).limit(1).maybeSingle();
    teamId = (team as { id: string } | null)?.id ?? null;
  }

  const { error } = await db.from("org_assignments").upsert(
    { member_id: memberId, role_id: roleId, team_id: teamId, allocation, is_primary: false },
    { onConflict: "member_id,role_id,team_id" }
  );
  if (error) return { success: false, error: error.message };

  await markPrimaryAndReviewed(db, memberId);
  revalidatePath("/settings/people");
  return { success: true };
}

export async function removeMemberRole(memberId: string, roleId: string) {
  await requireOrgManage();
  const db = createServiceClient();
  const { error } = await db.from("org_assignments")
    .delete().eq("member_id", memberId).eq("role_id", roleId);
  if (error) return { success: false, error: error.message };
  await markPrimaryAndReviewed(db, memberId);
  revalidatePath("/settings/people");
  return { success: true };
}

/** Largest share is the primary role, and having any role at all is the review. */
async function markPrimaryAndReviewed(db: ReturnType<typeof createServiceClient>, memberId: string) {
  const { data } = await db
    .from("org_assignments")
    .select("id,allocation,org_roles(service_id)")
    .eq("member_id", memberId);

  type Row = { id: string; allocation: number; org_roles?: { service_id: string | null } | null };
  const rows = ((data ?? []) as unknown as Row[]).filter((r) => r.org_roles?.service_id);
  if (!rows.length) return;

  const top = Math.max(...rows.map((r) => Number(r.allocation)));
  await Promise.all(rows.map((r) =>
    db.from("org_assignments").update({ is_primary: Number(r.allocation) === top }).eq("id", r.id)
  ));
  await db.from("org_members").update({ needs_review: false }).eq("id", memberId);
}

/** Grant or revoke a role that is not tied to a service: manager, app-admin. */
export async function toggleStandaloneRole(memberId: string, roleSlug: "manager" | "app-admin", on: boolean) {
  await requireOrgManage();
  const db = createServiceClient();

  const { data: role } = await db.from("org_roles").select("id").eq("slug", roleSlug).single();
  const roleId = (role as { id: string } | null)?.id;
  if (!roleId) return { success: false, error: `No such role: ${roleSlug}` };

  if (on) {
    const { error } = await db.from("org_assignments")
      .insert({ member_id: memberId, role_id: roleId, is_primary: false });
    if (error && !error.message.includes("duplicate")) return { success: false, error: error.message };
  } else {
    await db.from("org_assignments").delete().eq("member_id", memberId).eq("role_id", roleId);
  }
  revalidatePath("/settings/people");
  return { success: true };
}

export async function setMemberManager(memberId: string, managerId: string | null) {
  await requireOrgManage();
  if (managerId === memberId) return { success: false, error: "Someone cannot manage themselves." };
  const db = createServiceClient();

  // Walk up from the proposed manager; if we reach this member, the change
  // would make a loop and the org chart would never terminate.
  let cursor = managerId;
  for (let hops = 0; cursor && hops < 50; hops++) {
    if (cursor === memberId) return { success: false, error: "That would create a reporting loop." };
    const { data } = await db
      .from("org_members").select("manager_member_id").eq("id", cursor).single();
    cursor = (data as { manager_member_id: string | null } | null)?.manager_member_id ?? null;
  }

  const { error } = await db.from("org_members")
    .update({ manager_member_id: managerId }).eq("id", memberId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/settings/people");
  return { success: true };
}

export async function setMemberActive(memberId: string, active: boolean) {
  await requireOrgManage();
  const db = createServiceClient();
  const { error } = await db.from("org_members").update({ active }).eq("id", memberId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/settings/people");
  return { success: true };
}
