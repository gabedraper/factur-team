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
  try {
    await requireOrgManage();
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Forbidden: org.manage required" };
  }
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
  try {
    await requireOrgManage();
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Forbidden: org.manage required" };
  }
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
  try {
    await requireOrgManage();
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Forbidden: org.manage required" };
  }
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
  try {
    await requireOrgManage();
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Forbidden: org.manage required" };
  }
  const db = createServiceClient();
  const { error } = await db.from("org_members").update({ active }).eq("id", memberId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/settings/people");
  return { success: true };
}

export async function createTeam(name: string, kind: "pod" | "group") {
  try {
    await requireOrgManage();
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Forbidden: org.manage required" };
  }
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
  try {
    await requireOrgManage();
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Forbidden: org.manage required" };
  }
  if (!name.trim()) return { success: false, error: "A pod needs a name." };
  const db = createServiceClient();
  const { error } = await db.from("org_teams").update({ name: name.trim() }).eq("id", teamId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/settings/teams");
  return { success: true };
}

export async function setTeamActive(teamId: string, active: boolean) {
  try {
    await requireOrgManage();
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Forbidden: org.manage required" };
  }
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
  try {
    await requireOrgManage();
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Forbidden: org.manage required" };
  }
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
  try {
    await requireOrgManage();
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Forbidden: org.manage required" };
  }
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
  try {
    await requireOrgManage();
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Forbidden: org.manage required" };
  }
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

// --- people -----------------------------------------------------------------

export async function createMember(email: string, fullName: string) {
  try {
    await requireOrgManage();
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Forbidden: org.manage required" };
  }
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
  try {
    await requireOrgManage();
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Forbidden: org.manage required" };
  }
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
  try {
    await requireOrgManage();
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Forbidden: org.manage required" };
  }
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
  try {
    await requireOrgManage();
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Forbidden: org.manage required" };
  }
  const db = createServiceClient();
  const { error } = await db.from("org_members")
    .update({ salesforce_user_id: salesforceUserId }).eq("id", memberId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/settings/people");
  return { success: true };
}

// --- roles ------------------------------------------------------------------

export async function createRole(name: string, serviceId: string | null, description: string | null) {
  try {
    await requireOrgManage();
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Forbidden: org.manage required" };
  }
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
  try {
    await requireOrgManage();
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Forbidden: org.manage required" };
  }
  const db = createServiceClient();
  const { error } = await db.from("org_roles").update(fields).eq("id", roleId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/settings/roles");
  return { success: true };
}

/** Refused while anyone holds it: deleting would silently strip their access. */
export async function deleteRole(roleId: string) {
  try {
    await requireOrgManage();
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Forbidden: org.manage required" };
  }
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
  try {
    await requireOrgManage();
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Forbidden: org.manage required" };
  }
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
  try {
    await requireOrgManage();
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Forbidden: org.manage required" };
  }
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
  try {
    await requireOrgManage();
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Forbidden: org.manage required" };
  }
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
  try {
    await requireOrgManage();
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Forbidden: org.manage required" };
  }
  const db = createServiceClient();
  const { error } = await db.from("org_clients").update({ [field]: memberId }).eq("id", clientId);
  if (error) return { success: false, error: error.message };
  await noteClientHistory();
  revalidatePath(`/settings/clients/${clientId}`);
  return { success: true };
}

/*
 * ---------------------------------------------------------------------------
 * Services
 *
 * The list behind the Service dropdown on a client, and the grouping every role
 * hangs off. Six rows seeded at the start and no way to touch them since, which
 * is fine until the day the business adds a service.
 *
 * Not to be confused with Salesforce's Service__c on the client record. That
 * one is the product a client buys -- LG, OP, OSDR. These are the parts of
 * Factur that deliver it.
 * ---------------------------------------------------------------------------
 */

export async function createService(name: string, description: string | null) {
  try {
    await requireOrgManage();
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Forbidden: org.manage required" };
  }
  const trimmed = name.trim();
  if (!trimmed) return { success: false, error: "A service needs a name." };
  const db = createServiceClient();

  const slug = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!slug) return { success: false, error: "That name has no letters or numbers in it." };

  // Onto the end of the list; ordering is a drag or an arrow away afterwards.
  const { data: last } = await db.from("org_services")
    .select("position").order("position", { ascending: false }).limit(1).maybeSingle();
  const position = ((last as { position: number } | null)?.position ?? 0) + 1;

  const { error } = await db.from("org_services")
    .insert({ name: trimmed, slug, description: description?.trim() || null, position });
  if (error) {
    return {
      success: false,
      error: error.message.includes("duplicate")
        ? "A service with that name already exists."
        : error.message,
    };
  }
  revalidatePath("/settings/services");
  revalidatePath("/settings/clients");
  return { success: true };
}

export async function updateService(
  serviceId: string,
  fields: { name?: string; description?: string | null; active?: boolean }
) {
  try {
    await requireOrgManage();
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Forbidden: org.manage required" };
  }
  if (fields.name !== undefined && !fields.name.trim()) {
    return { success: false, error: "A service needs a name." };
  }
  const db = createServiceClient();

  /*
   * The slug is deliberately left alone on rename. Seeded roles and the
   * scoreboard match on it, so renaming "Outsourced Prospecting" to something
   * friendlier should change the label and nothing else.
   */
  const patch: Record<string, unknown> = {};
  if (fields.name !== undefined) patch.name = fields.name.trim();
  if (fields.description !== undefined) patch.description = fields.description?.trim() || null;
  if (fields.active !== undefined) patch.active = fields.active;

  const { error } = await db.from("org_services").update(patch).eq("id", serviceId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/settings/services");
  revalidatePath("/settings/clients");
  return { success: true };
}

/**
 * Refused while anything still points at it.
 *
 * Deleting a service that clients or roles reference would blank the field on
 * those records with nothing said. Deactivating is nearly always what was
 * meant: it drops out of the dropdown for new work and leaves history intact.
 */
export async function deleteService(serviceId: string) {
  try {
    await requireOrgManage();
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Forbidden: org.manage required" };
  }
  const db = createServiceClient();

  const [roles, teams] = await Promise.all([
    db.from("org_roles").select("id", { count: "exact", head: true }).eq("service_id", serviceId),
    db.from("org_teams").select("id", { count: "exact", head: true }).eq("service_id", serviceId),
  ]);

  const blockers = [
    roles.count ? `${roles.count} roles` : null,
    teams.count ? `${teams.count} pods` : null,
  ].filter(Boolean);

  if (blockers.length) {
    return {
      success: false,
      error: `${blockers.join(", ")} still use this service. Move them first, or turn it off instead.`,
    };
  }

  const { error } = await db.from("org_services").delete().eq("id", serviceId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/settings/services");
  revalidatePath("/settings/clients");
  return { success: true };
}

/** Swaps a service with its neighbour, which is what the arrows in the UI do. */
export async function moveService(serviceId: string, direction: "up" | "down") {
  try {
    await requireOrgManage();
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Forbidden: org.manage required" };
  }
  const db = createServiceClient();

  const { data: rows } = await db.from("org_services").select("id,position").order("position");
  const list = (rows ?? []) as { id: string; position: number }[];
  const i = list.findIndex((s) => s.id === serviceId);
  const j = direction === "up" ? i - 1 : i + 1;
  if (i === -1 || j < 0 || j >= list.length) return { success: true };

  /*
   * Positions are swapped by value rather than recomputed, so a list that was
   * never contiguous to begin with does not get silently renumbered.
   */
  const [a, b] = [list[i], list[j]];
  const { error } = await db.from("org_services").upsert([
    { id: a.id, position: b.position },
    { id: b.id, position: a.position },
  ]);
  if (error) return { success: false, error: error.message };
  revalidatePath("/settings/services");
  return { success: true };
}

/*
 * ---------------------------------------------------------------------------
 * Client service periods
 *
 * A client's service is not one value that gets overwritten. An upgrade closes
 * one period and opens another, which is why these are rows rather than a
 * field. Overlaps are allowed: running two services at once is normal.
 *
 * Every write sets source = 'manual', which is what stops the nightly rebuild
 * from flattening a hand correction back into whatever the opportunity tags
 * happened to say.
 * ---------------------------------------------------------------------------
 */

async function requireClientEdit() {
  const perms = await myPermissions();
  if (!perms.has("org.manage") && !perms.has("clients.health")) {
    throw new Error("Forbidden: clients.health or org.manage required");
  }
}

function badDates(startedOn: string, endedOn: string | null) {
  if (!startedOn) return "A period needs a start date.";
  if (endedOn && endedOn < startedOn) return "The end date is before the start date.";
  return null;
}

export async function addServicePeriod(
  clientId: string,
  fields: {
    service: string; started_on: string; ended_on: string | null;
    monthly_rate: number | null; tier: string | null; note: string | null;
  }
) {
  try {
    await requireClientEdit();
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Forbidden: clients.health or org.manage required" };
  }
  if (!fields.service.trim()) return { success: false, error: "A period needs a service." };
  const bad = badDates(fields.started_on, fields.ended_on);
  if (bad) return { success: false, error: bad };

  const { error } = await createServiceClient().from("client_service_periods").insert({
    salesforce_client_id: clientId,
    service: fields.service.trim(),
    started_on: fields.started_on,
    ended_on: fields.ended_on || null,
    monthly_rate: fields.monthly_rate,
    tier: fields.tier?.trim() || null,
    note: fields.note?.trim() || null,
    source: "manual",
  });
  if (error) return { success: false, error: error.message };
  revalidatePath(`/clients/results/${clientId}`);
  return { success: true };
}

export async function updateServicePeriod(
  periodId: string,
  clientId: string,
  fields: {
    service?: string; started_on?: string; ended_on?: string | null;
    monthly_rate?: number | null; tier?: string | null; note?: string | null;
  }
) {
  try {
    await requireClientEdit();
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Forbidden: clients.health or org.manage required" };
  }
  const db = createServiceClient();

  const { data: current } = await db.from("client_service_periods")
    .select("started_on,ended_on").eq("id", periodId).maybeSingle();
  const row = current as { started_on: string; ended_on: string | null } | null;
  if (!row) return { success: false, error: "That period no longer exists." };

  const bad = badDates(
    fields.started_on ?? row.started_on,
    fields.ended_on === undefined ? row.ended_on : fields.ended_on,
  );
  if (bad) return { success: false, error: bad };

  const patch: Record<string, unknown> = { source: "manual" };
  if (fields.service !== undefined) patch.service = fields.service.trim();
  if (fields.started_on !== undefined) patch.started_on = fields.started_on;
  if (fields.ended_on !== undefined) patch.ended_on = fields.ended_on || null;
  if (fields.monthly_rate !== undefined) patch.monthly_rate = fields.monthly_rate;
  if (fields.tier !== undefined) patch.tier = fields.tier?.trim() || null;
  if (fields.note !== undefined) patch.note = fields.note?.trim() || null;

  const { error } = await db.from("client_service_periods").update(patch).eq("id", periodId);
  if (error) return { success: false, error: error.message };
  revalidatePath(`/clients/results/${clientId}`);
  return { success: true };
}

export async function deleteServicePeriod(periodId: string, clientId: string) {
  try {
    await requireClientEdit();
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Forbidden: clients.health or org.manage required" };
  }
  const { error } = await createServiceClient()
    .from("client_service_periods").delete().eq("id", periodId);
  if (error) return { success: false, error: error.message };
  revalidatePath(`/clients/results/${clientId}`);
  return { success: true };
}

/**
 * The upgrade or downgrade, as one action.
 *
 * Closes whatever is currently open the day before the new service starts, and
 * opens the new one. Doing it as two edits is the same thing, but this is the
 * move people actually make and it should not need two forms and a date
 * subtraction done in someone's head.
 */
export async function switchService(
  clientId: string,
  toService: string,
  onDate: string,
  monthlyRate: number | null
) {
  try {
    await requireClientEdit();
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Forbidden: clients.health or org.manage required" };
  }
  if (!toService.trim()) return { success: false, error: "Pick a service to switch to." };
  if (!onDate) return { success: false, error: "Pick the date the change took effect." };
  const db = createServiceClient();

  const dayBefore = new Date(`${onDate}T00:00:00Z`);
  dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);

  const { data: open } = await db.from("client_service_periods")
    .select("id,started_on").eq("salesforce_client_id", clientId).is("ended_on", null);

  for (const p of (open ?? []) as { id: string; started_on: string }[]) {
    /*
     * A period cannot end before it began. If someone backdates a switch to
     * before the open period started, that period was a mistake -- drop it
     * rather than writing a negative span the check constraint would reject.
     */
    if (p.started_on > dayBefore.toISOString().slice(0, 10)) {
      await db.from("client_service_periods").delete().eq("id", p.id);
      continue;
    }
    await db.from("client_service_periods")
      .update({ ended_on: dayBefore.toISOString().slice(0, 10), source: "manual" })
      .eq("id", p.id);
  }

  const { error } = await db.from("client_service_periods").insert({
    salesforce_client_id: clientId,
    service: toService.trim(),
    started_on: onDate,
    monthly_rate: monthlyRate,
    source: "manual",
  });
  if (error) return { success: false, error: error.message };
  revalidatePath(`/clients/results/${clientId}`);
  return { success: true };
}
