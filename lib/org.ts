import { createClient, createServiceClient } from "@/lib/supabase/server";

export type Permission =
  | "org.manage" | "lms.admin" | "lms.instruct" | "scoreboard.view"
  | "scoreboard.retention.unmask" | "scoreboard.weights.edit" | "timelines.view";

/**
 * Every capability the signed-in person holds. One round trip, because callers
 * usually need to ask about several at once (a page that shows an admin tab and
 * an unmasked column would otherwise query twice).
 */
export async function myPermissions(): Promise<Set<Permission>> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Set();

  const { data } = await supabase
    .from("org_members")
    .select("org_assignments(org_roles(org_role_permissions(permission_key)))")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  const keys = new Set<Permission>();
  type Row = { org_assignments?: { org_roles?: { org_role_permissions?: { permission_key: string }[] } }[] };
  for (const a of ((data as Row | null)?.org_assignments ?? [])) {
    for (const p of a.org_roles?.org_role_permissions ?? []) {
      keys.add(p.permission_key as Permission);
    }
  }
  return keys;
}

export type MemberRow = {
  id: string;
  email: string;
  full_name: string | null;
  active: boolean;
  needs_review: boolean;
  manager_member_id: string | null;
  salesforce_user_id: string | null;
  roleIds: string[];
};

/**
 * Everyone, with their roles flattened. Read through the service client: the
 * people screen is gated on org.manage in the app, and reading it through the
 * user's own session would hide rows behind RLS mid-edit.
 */
export async function listMembers() {
  const db = createServiceClient();

  const [{ data: members }, { data: assignments }, { data: roles }] = await Promise.all([
    db.from("org_members")
      .select("id,email,full_name,active,needs_review,manager_member_id,salesforce_user_id")
      .order("needs_review", { ascending: false })
      .order("full_name"),
    db.from("org_assignments").select("member_id,role_id"),
    db.from("org_roles").select("id,slug,name,service_id,active").order("name"),
  ]);

  const byMember = new Map<string, string[]>();
  for (const a of (assignments ?? []) as { member_id: string; role_id: string }[]) {
    byMember.set(a.member_id, [...(byMember.get(a.member_id) ?? []), a.role_id]);
  }

  return {
    members: ((members ?? []) as Omit<MemberRow, "roleIds">[]).map((m) => ({
      ...m,
      roleIds: byMember.get(m.id) ?? [],
    })),
    roles: (roles ?? []) as { id: string; slug: string; name: string; service_id: string | null; active: boolean }[],
  };
}

export async function listServicesAndTeams() {
  const db = createServiceClient();
  const [{ data: services }, { data: teams }] = await Promise.all([
    db.from("org_services").select("id,slug,name,description,position,active").order("position"),
    db.from("org_teams").select("id,service_id,slug,name,active").order("name"),
  ]);
  return {
    services: (services ?? []) as { id: string; slug: string; name: string; description: string | null; position: number; active: boolean }[],
    teams: (teams ?? []) as { id: string; service_id: string; slug: string; name: string; active: boolean }[],
  };
}
