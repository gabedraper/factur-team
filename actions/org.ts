"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { myPermissions } from "@/lib/org";

async function requireOrgManage() {
  const perms = await myPermissions();
  if (!perms.has("org.manage")) throw new Error("Forbidden: org.manage required");
}

/**
 * Replaces the member's service roles with one choice. Roles that are not tied
 * to a service -- manager, app-admin -- are left alone, since those say what
 * someone may see rather than what job they do, and are granted separately.
 */
export async function setMemberRole(memberId: string, roleId: string | null) {
  await requireOrgManage();
  const db = createServiceClient();

  const { data: serviceRoles } = await db
    .from("org_roles").select("id").not("service_id", "is", null);
  const serviceRoleIds = (serviceRoles ?? []).map((r) => (r as { id: string }).id);

  await db.from("org_assignments").delete()
    .eq("member_id", memberId).in("role_id", serviceRoleIds);

  if (roleId) {
    const { data: role } = await db
      .from("org_roles").select("service_id").eq("id", roleId).single();
    const serviceId = (role as { service_id: string | null } | null)?.service_id ?? null;

    let teamId: string | null = null;
    if (serviceId) {
      const { data: team } = await db
        .from("org_teams").select("id").eq("service_id", serviceId).limit(1).maybeSingle();
      teamId = (team as { id: string } | null)?.id ?? null;
    }

    const { error } = await db.from("org_assignments")
      .insert({ member_id: memberId, role_id: roleId, team_id: teamId, is_primary: true });
    if (error) return { success: false, error: error.message };
  }

  // Picking a role is the review.
  await db.from("org_members").update({ needs_review: false }).eq("id", memberId);
  revalidatePath("/settings/people");
  return { success: true };
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

export async function createTeam(serviceId: string, name: string, kind: "pod" | "group") {
  await requireOrgManage();
  const trimmed = name.trim();
  if (!trimmed) return { success: false, error: "A pod needs a name." };
  const db = createServiceClient();

  const slug = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const { error } = await db.from("org_teams")
    .insert({ service_id: serviceId, name: trimmed, slug, kind });
  if (error) {
    return {
      success: false,
      error: error.message.includes("duplicate")
        ? "A team with that name already exists in this service."
        : error.message,
    };
  }
  revalidatePath("/settings/teams");
  return { success: true };
}

export async function renameTeam(teamId: string, name: string) {
  await requireOrgManage();
  if (!name.trim()) return { success: false, error: "A pod needs a name." };
  const db = createServiceClient();
  const { error } = await db.from("org_teams").update({ name: name.trim() }).eq("id", teamId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/settings/teams");
  return { success: true };
}

export async function setTeamActive(teamId: string, active: boolean) {
  await requireOrgManage();
  const db = createServiceClient();
  const { error } = await db.from("org_teams").update({ active }).eq("id", teamId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/settings/teams");
  return { success: true };
}

/**
 * Puts someone in a pod, or takes them out. Team lives on the assignment rather
 * than the member because a split-role person can sit in a different pod for
 * each role they hold.
 */
export async function setMemberTeam(memberId: string, teamId: string, inTeam: boolean) {
  await requireOrgManage();
  const db = createServiceClient();

  const { data: team } = await db.from("org_teams").select("service_id").eq("id", teamId).single();
  const serviceId = (team as { service_id: string } | null)?.service_id;
  if (!serviceId) return { success: false, error: "No such team." };

  const { data: rows } = await db
    .from("org_assignments").select("id,role_id,org_roles(service_id)").eq("member_id", memberId);
  type Row = { id: string; role_id: string; org_roles?: { service_id: string | null } | null };
  const match = ((rows ?? []) as unknown as Row[])
    .find((r) => r.org_roles?.service_id === serviceId);

  if (!match) {
    return {
      success: false,
      error: "Give this person a role in that service first — a pod place hangs off the role.",
    };
  }

  const { error } = await db.from("org_assignments")
    .update({ team_id: inTeam ? teamId : null }).eq("id", match.id);
  if (error) return { success: false, error: error.message };
  revalidatePath("/settings/teams");
  return { success: true };
}

/** A client is covered by a pod or by one person, never both. */
export async function addCoverage(
  clientId: string, clientName: string | null,
  owner: { teamId: string } | { memberId: string }
) {
  await requireOrgManage();
  const db = createServiceClient();
  const { error } = await db.from("org_client_coverage").insert({
    client_id: clientId,
    client_name: clientName,
    team_id: "teamId" in owner ? owner.teamId : null,
    member_id: "memberId" in owner ? owner.memberId : null,
  });
  if (error) {
    return {
      success: false,
      error: error.message.includes("duplicate")
        ? "That client is already covered by them."
        : error.message,
    };
  }
  revalidatePath("/settings/teams");
  return { success: true };
}

export async function removeCoverage(coverageId: string) {
  await requireOrgManage();
  const db = createServiceClient();
  const { error } = await db.from("org_client_coverage").delete().eq("id", coverageId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/settings/teams");
  return { success: true };
}
