"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/supabase/session";
import { myRealPermissions } from "@/lib/org";
import { isJobRole } from "@/lib/org-roles";

/**
 * What a person may change about their own record without an administrator.
 *
 * Every function here works out who the caller is from their session and
 * ignores any id the browser sends, so a request cannot name somebody else.
 *
 * Roles are the part that needs care. A role is a bundle of permissions, so
 * "choose your own role" is "choose your own permissions" unless something
 * stops it -- and two ordinary-looking job roles, CEO and Team Lead, carry
 * org.manage. Team Lead in particular is the kind of title somebody would pick
 * without meaning to make themselves an administrator.
 */

/**
 * Permissions nobody may hand themselves.
 *
 * org.manage is administration -- it is the key to this screen, to everyone
 * else's record, and to the permission editor itself, so a role carrying it
 * has to come from an administrator. lms.manage_team is the manager one: it
 * shows other people's training and progress.
 */
const RESTRICTED_PERMISSIONS = ["org.manage", "lms.manage_team"] as const;

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

/** Role ids that carry a permission only an administrator may grant. */
async function restrictedRoleIds(): Promise<Set<string>> {
  const { data } = await createServiceClient()
    .from("org_role_permissions")
    .select("role_id, permission_key")
    .in("permission_key", RESTRICTED_PERMISSIONS as unknown as string[]);

  return new Set(
    ((data ?? []) as { role_id: string }[]).map((r) => r.role_id)
  );
}

export type SelfRole = {
  id: string;
  name: string;
  service_id: string | null;
  /** True when only an administrator may assign it. */
  restricted: boolean;
};

/**
 * The job roles on offer, and which of them are out of reach.
 *
 * Restricted roles are returned rather than filtered out so the screen can
 * show them greyed rather than pretend they do not exist -- somebody looking
 * for "Team Lead" should find it and see that it needs an administrator, not
 * conclude the list is broken.
 */
export async function listRolesForSelf(): Promise<{
  roles: SelfRole[];
  canAssignRestricted: boolean;
}> {
  const db = createServiceClient();
  const [{ data }, restricted, perms] = await Promise.all([
    db.from("org_roles").select("id,slug,name,service_id").eq("active", true).order("name"),
    restrictedRoleIds(),
    myRealPermissions(),
  ]);

  const roles = ((data ?? []) as
    { id: string; slug: string; name: string; service_id: string | null }[])
    // Manager and app-admin are not jobs; they are separate checkboxes an
    // administrator ticks, and were never part of this picker.
    .filter(isJobRole)
    .map((r) => ({
      id: r.id,
      name: r.name,
      service_id: r.service_id,
      restricted: restricted.has(r.id),
    }));

  return { roles, canAssignRestricted: perms.has("org.manage") };
}

/**
 * Set your own job role.
 *
 * One job at a time, as when an administrator sets it: choosing a role
 * replaces the previous one.
 */
export async function setMyRole(roleId: string | null) {
  const mine = await me();
  if (!mine) return { success: false, error: "Not signed in." };

  const db = createServiceClient();

  /*
   * Checked on the server, and on the real permissions rather than any preview
   * -- the change lands on the account actually signed in, so it is that
   * account's rights that decide. The screen hides these too, but the screen
   * is a convenience and this is the rule.
   */
  if (roleId) {
    const perms = await myRealPermissions();
    if (!perms.has("org.manage") && (await restrictedRoleIds()).has(roleId)) {
      return {
        success: false,
        error: "That role includes administrator or manager access. An administrator has to assign it.",
      };
    }
  }

  const { data: allRoles } = await db.from("org_roles").select("id,slug");
  const jobRoleIds = ((allRoles ?? []) as { id: string; slug: string }[])
    .filter(isJobRole)
    .map((r) => r.id);

  // Refuse an id that is not a job role at all, rather than silently doing
  // nothing with it.
  if (roleId && !jobRoleIds.includes(roleId)) {
    return { success: false, error: "That is not a job role." };
  }

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
 * `member_id` is the same column the Clients screen writes, so a client picked
 * here and one assigned by an administrator are the same thing to everything
 * downstream -- the scoreboards, client health and the collections queue all
 * read it without caring who set it.
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
     * Releasing only clears the column while it is still yours. Without the
     * second condition, a stale page could unassign a client that had already
     * moved to somebody else.
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
   * The history table records who held what and when. Written on a best
   * effort: failing to note the change is not a reason to refuse it, and the
   * nightly run catches up.
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

/** Every active client, with who holds it, for the picker. */
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
