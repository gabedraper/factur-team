"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/supabase/session";
import { isJobRole } from "@/lib/org-roles";

/**
 * Things a person may change about their own record, without an administrator.
 *
 * Every function here works out who the caller is from their session and
 * ignores any id the browser sends. That is the whole security model: the
 * page cannot ask to edit somebody else, because it never gets to say who is
 * being edited.
 *
 * What that model does *not* do is limit what you may give yourself. Roles
 * carry permissions, so a person choosing their own role can choose one that
 * holds org.manage and become an administrator. That is the behaviour that was
 * asked for, and it means the permission checks elsewhere in the app describe
 * what someone currently holds rather than what they are allowed to hold.
 */

/** The signed-in person's own member row. Never the previewed one. */
async function me(): Promise<{ id: string } | null> {
  const user = await getAuthedUser();
  if (!user) return null;

  const { data } = await createServiceClient()
    .from("org_members")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  return (data as { id: string } | null) ?? null;
}

/**
 * Set your own job role.
 *
 * Mirrors setMemberRole, which an administrator uses: one job at a time, so
 * choosing a role replaces the previous one. Standalone roles -- manager,
 * app-admin -- are left alone here, as they are there.
 */
export async function setMyRole(roleId: string | null) {
  const mine = await me();
  if (!mine) return { success: false, error: "Not signed in." };

  const db = createServiceClient();

  const { data: allRoles } = await db.from("org_roles").select("id,slug");
  const jobRoleIds = ((allRoles ?? []) as { id: string; slug: string }[])
    .filter(isJobRole)
    .map((r) => r.id);

  await db
    .from("org_assignments")
    .delete()
    .eq("member_id", mine.id)
    .in("role_id", jobRoleIds);

  if (roleId) {
    // A role belongs to a service, and a service to a team; the assignment
    // carries the team so the org screens can group people by it.
    const { data: role } = await db
      .from("org_roles")
      .select("service_id")
      .eq("id", roleId)
      .single();
    const serviceId = (role as { service_id: string | null } | null)?.service_id ?? null;

    let teamId: string | null = null;
    if (serviceId) {
      const { data: team } = await db
        .from("org_teams")
        .select("id")
        .eq("service_id", serviceId)
        .limit(1)
        .maybeSingle();
      teamId = (team as { id: string } | null)?.id ?? null;
    }

    const { error } = await db
      .from("org_assignments")
      .insert({ member_id: mine.id, role_id: roleId, team_id: teamId, is_primary: true });
    if (error) return { success: false, error: error.message };
  }

  await db.from("org_members").update({ needs_review: false }).eq("id", mine.id);

  revalidatePath("/settings");
  revalidatePath("/settings/people");
  return { success: true };
}

/**
 * Put a client in your own name, or take yours back out.
 *
 * `member_id` is the same column the Clients screen writes, so a client
 * claimed here and one assigned by an administrator are the same thing to
 * everything downstream -- the scoreboards, client health and the collections
 * queue all read it without caring who set it.
 *
 * Claiming a client someone else holds takes it from them. There is no check
 * for that, by request.
 */
export async function claimClient(clientId: string, claim: boolean) {
  const mine = await me();
  if (!mine) return { success: false, error: "Not signed in." };

  const db = createServiceClient();

  if (!claim) {
    /*
     * Releasing only clears the column when it is still yours. Without the
     * second condition, two people releasing at once -- or a stale page --
     * would let one of them unassign a client that had already moved to
     * somebody else.
     */
    const { error } = await db
      .from("org_clients")
      .update({ member_id: null })
      .eq("id", clientId)
      .eq("member_id", mine.id);
    if (error) return { success: false, error: error.message };
  } else {
    const { error } = await db
      .from("org_clients")
      .update({ member_id: mine.id })
      .eq("id", clientId);
    if (error) return { success: false, error: error.message };
  }

  /*
   * The client history table records who held what and when. Written on a
   * best effort: failing to note the change is not a reason to refuse it, and
   * the nightly run catches up.
   */
  try {
    await db.rpc("record_client_history", { p_source: "manual" });
  } catch {
    // Deliberately swallowed -- see above.
  }

  revalidatePath("/settings");
  revalidatePath("/settings/clients");
  revalidatePath("/settings/teams");
  return { success: true };
}

/** Every client, with who currently holds it, for the picker. */
export async function listClientsForSelf(): Promise<
  { id: string; name: string; heldBy: string | null; mine: boolean }[]
> {
  const mine = await me();
  if (!mine) return [];

  const db = createServiceClient();
  const { data } = await db
    .from("org_clients")
    .select("id, name, member_id, org_members!org_clients_member_id_fkey(full_name, email)")
    .eq("active", true)
    .order("name");

  type Row = {
    id: string;
    name: string;
    member_id: string | null;
    org_members: { full_name: string | null; email: string } | null;
  };

  return ((data ?? []) as unknown as Row[]).map((c) => ({
    id: c.id,
    name: c.name,
    heldBy: c.org_members?.full_name ?? c.org_members?.email ?? null,
    mine: c.member_id === mine.id,
  }));
}
