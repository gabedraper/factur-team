"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { myPermissions } from "@/lib/org";
import { isJobRole, isStandaloneRole, type StandaloneRoleSlug } from "@/lib/org-roles";

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

  // Someone holds one job at a time, so setting a role replaces whatever job
  // they held. Manager and app-admin are not jobs and are left alone -- they
  // are their own checkboxes.
  const { data: allRoles } = await db.from("org_roles").select("id,slug");
  const jobRoleIds = ((allRoles ?? []) as { id: string; slug: string }[])
    .filter(isJobRole).map((r) => r.id);

  await db.from("org_assignments").delete()
    .eq("member_id", memberId).in("role_id", jobRoleIds);

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
export async function toggleStandaloneRole(memberId: string, roleSlug: StandaloneRoleSlug, on: boolean) {
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

export async function createTeam(name: string, kind: "pod" | "group") {
  await requireOrgManage();
  const trimmed = name.trim();
  if (!trimmed) return { success: false, error: "A pod needs a name." };
  const db = createServiceClient();

  const slug = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  // No service: a pod covers several, and which ones follows from its clients.
  const { error } = await db.from("org_teams")
    .insert({ name: trimmed, slug, kind });
  if (error) {
    return {
      success: false,
      error: error.message.includes("duplicate")
        ? "A team with that name already exists."
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

export async function setPodManager(teamId: string, memberId: string | null) {
  await requireOrgManage();
  const db = createServiceClient();
  const { error } = await db.from("org_teams")
    .update({ manager_member_id: memberId }).eq("id", teamId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/settings/teams");
  return { success: true };
}

/** Coverage is set on the client: it is the thing that has exactly one owner. */
/**
 * Record any change to who is on a client, right after making one.
 *
 * A full reconcile rather than a targeted write: it compares every client's
 * roles against the open history rows and touches only what actually moved, so
 * it does not matter which of these functions was called or what it changed.
 * The nightly job runs the same thing -- this only makes the timestamp the
 * moment of the edit rather than the small hours afterwards.
 *
 * Deliberately never throws. Failing to record history is worth knowing about,
 * but not worth failing an assignment the user just made.
 */
async function noteClientHistory(): Promise<void> {
  try {
    await createServiceClient().rpc("record_client_history", { p_source: "manual" });
  } catch {
    // Swallowed on purpose -- see above. The nightly run will catch it up.
  }
}

export async function setClientOwner(
  clientId: string,
  owner: { teamId: string } | { memberId: string } | null
) {
  await requireOrgManage();
  const db = createServiceClient();
  const { error } = await db.from("org_clients").update({
    team_id: owner && "teamId" in owner ? owner.teamId : null,
    member_id: owner && "memberId" in owner ? owner.memberId : null,
  }).eq("id", clientId);
  if (error) return { success: false, error: error.message };
  await noteClientHistory();
  revalidatePath("/settings/clients");
  revalidatePath("/settings/teams");
  return { success: true };
}

export async function setClientService(clientId: string, serviceId: string | null) {
  await requireOrgManage();
  const db = createServiceClient();
  const { error } = await db.from("org_clients")
    .update({ service_id: serviceId }).eq("id", clientId);
  if (error) return { success: false, error: error.message };
  await noteClientHistory();
  revalidatePath("/settings/clients");
  return { success: true };
}

// --- people -----------------------------------------------------------------

export async function createMember(email: string, fullName: string) {
  await requireOrgManage();
  const address = email.trim().toLowerCase();
  const domain = address.split("@")[1];
  if (domain !== "bethefactur.com" && domain !== "facturmfg.com") {
    return { success: false, error: "Only @bethefactur.com and @facturmfg.com addresses can sign in." };
  }
  const db = createServiceClient();

  // Same person under a second address is how six duplicates got into this
  // table once already, so a name clash is refused rather than merged blind.
  const { data: clash } = await db
    .from("org_members").select("email").ilike("full_name", fullName.trim()).maybeSingle();
  if (clash) {
    return {
      success: false,
      error: `${fullName.trim()} is already here as ${(clash as { email: string }).email}. Edit that person instead.`,
    };
  }

  const { error } = await db.from("org_members")
    .insert({ email: address, full_name: fullName.trim(), needs_review: true });
  if (error) {
    return {
      success: false,
      error: error.message.includes("duplicate") ? "That address is already in the app." : error.message,
    };
  }
  revalidatePath("/settings/people");
  return { success: true };
}

export async function updateMember(memberId: string, fields: { full_name?: string; email?: string }) {
  await requireOrgManage();
  const patch: Record<string, string> = {};
  if (fields.full_name !== undefined) patch.full_name = fields.full_name.trim();
  if (fields.email !== undefined) {
    const address = fields.email.trim().toLowerCase();
    const domain = address.split("@")[1];
    if (domain !== "bethefactur.com" && domain !== "facturmfg.com") {
      return { success: false, error: "Only @bethefactur.com and @facturmfg.com addresses can sign in." };
    }
    patch.email = address;
  }
  if (!Object.keys(patch).length) return { success: true };

  const db = createServiceClient();
  const { error } = await db.from("org_members").update(patch).eq("id", memberId);
  if (error) {
    return {
      success: false,
      error: error.message.includes("duplicate") ? "Another person already uses that address." : error.message,
    };
  }
  revalidatePath("/settings/people");
  return { success: true };
}

/**
 * Removing someone is usually the wrong tool -- deactivating keeps their history
 * attached. Deletion is refused while anything still points at them.
 */
export async function deleteMember(memberId: string) {
  await requireOrgManage();
  const db = createServiceClient();

  const [{ count: reports }, { count: coverage }] = await Promise.all([
    db.from("org_members").select("id", { count: "exact", head: true }).eq("manager_member_id", memberId),
    db.from("org_client_coverage").select("id", { count: "exact", head: true }).eq("member_id", memberId),
  ]);
  if (reports) return { success: false, error: `${reports} people report to them. Move those first.` };
  if (coverage) return { success: false, error: `They cover ${coverage} clients. Reassign those first.` };

  const { data: m } = await db
    .from("org_members").select("auth_user_id").eq("id", memberId).maybeSingle();
  if ((m as { auth_user_id: string | null } | null)?.auth_user_id) {
    return {
      success: false,
      error: "They have signed in, so deleting would orphan their history. Set them inactive instead.",
    };
  }

  const { error } = await db.from("org_members").delete().eq("id", memberId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/settings/people");
  return { success: true };
}

export async function linkSalesforceUser(memberId: string, salesforceUserId: string | null) {
  await requireOrgManage();
  const db = createServiceClient();
  const { error } = await db.from("org_members")
    .update({ salesforce_user_id: salesforceUserId }).eq("id", memberId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/settings/people");
  return { success: true };
}

// --- roles ------------------------------------------------------------------

export async function createRole(name: string, serviceId: string | null, description: string | null) {
  await requireOrgManage();
  const trimmed = name.trim();
  if (!trimmed) return { success: false, error: "A role needs a name." };
  const db = createServiceClient();

  const slug = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const { error } = await db.from("org_roles")
    .insert({ name: trimmed, slug, service_id: serviceId, description });
  if (error) {
    return {
      success: false,
      error: error.message.includes("duplicate") ? "A role with that name already exists." : error.message,
    };
  }
  revalidatePath("/settings/roles");
  return { success: true };
}

export async function updateRole(
  roleId: string,
  fields: { name?: string; service_id?: string | null; description?: string | null; active?: boolean }
) {
  await requireOrgManage();
  const db = createServiceClient();
  const { error } = await db.from("org_roles").update(fields).eq("id", roleId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/settings/roles");
  return { success: true };
}

/** Refused while anyone holds it: deleting would silently strip their access. */
export async function deleteRole(roleId: string) {
  await requireOrgManage();
  const db = createServiceClient();

  const { data: role } = await db.from("org_roles").select("slug").eq("id", roleId).maybeSingle();
  const slug = (role as { slug: string } | null)?.slug;
  if (slug && isStandaloneRole(slug)) {
    return { success: false, error: "That role is built in and cannot be deleted." };
  }

  const { count } = await db.from("org_assignments")
    .select("id", { count: "exact", head: true }).eq("role_id", roleId);
  if (count) return { success: false, error: `${count} people hold this role. Move them first.` };

  const { error } = await db.from("org_roles").delete().eq("id", roleId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/settings/roles");
  return { success: true };
}

export async function setRolePermission(roleId: string, permissionKey: string, on: boolean) {
  await requireOrgManage();
  const db = createServiceClient();
  if (on) {
    const { error } = await db.from("org_role_permissions")
      .insert({ role_id: roleId, permission_key: permissionKey });
    if (error && !error.message.includes("duplicate")) return { success: false, error: error.message };
  } else {
    await db.from("org_role_permissions")
      .delete().eq("role_id", roleId).eq("permission_key", permissionKey);
  }
  revalidatePath("/settings/roles");
  return { success: true };
}

/**
 * Put somebody in a role on a client, or take them out of it.
 *
 * Keyed on the role rather than a column, so a role added in Settings needs no
 * change here. Choosing nobody deletes the row instead of storing a null, so an
 * empty assignment and a role never filled in are the same thing.
 */
export async function setClientRole(
  clientId: string,
  roleId: string,
  memberId: string | null
) {
  await requireOrgManage();
  const db = createServiceClient();

  const { error } = memberId
    ? await db
        .from("org_client_assignments")
        .upsert(
          { client_id: clientId, role_id: roleId, member_id: memberId },
          { onConflict: "client_id,role_id" }
        )
    : await db
        .from("org_client_assignments")
        .delete()
        .eq("client_id", clientId)
        .eq("role_id", roleId);

  if (error) return { success: false, error: error.message };
  await noteClientHistory();
  revalidatePath(`/settings/clients/${clientId}`);
  revalidatePath("/settings/clients");
  return { success: true };
}

/** Show or hide a role as an assignment field on every client. */
export async function setRoleClientAssignable(roleId: string, on: boolean) {
  await requireOrgManage();
  const db = createServiceClient();
  const { error } = await db
    .from("org_roles").update({ client_assignable: on }).eq("id", roleId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/settings/roles");
  revalidatePath("/settings/clients");
  return { success: true };
}

/**
 * Override a lead, or clear the override so it goes back to following the
 * reporting line -- which is what null means here, not "nobody".
 */
export async function setClientLead(
  clientId: string,
  field: "team_lead_id" | "data_team_lead_id",
  memberId: string | null
) {
  await requireOrgManage();
  const db = createServiceClient();
  const { error } = await db.from("org_clients").update({ [field]: memberId }).eq("id", clientId);
  if (error) return { success: false, error: error.message };
  await noteClientHistory();
  revalidatePath(`/settings/clients/${clientId}`);
  return { success: true };
}
