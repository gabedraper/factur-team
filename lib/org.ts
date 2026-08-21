import { cookies } from "next/headers";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export type Permission =
  | "org.manage" | "lms.admin" | "lms.instruct" | "scoreboard.view"
  | "scoreboard.retention.unmask" | "scoreboard.weights.edit" | "timelines.view";

/**
 * Every capability the signed-in person holds. One round trip, because callers
 * usually need to ask about several at once (a page that shows an admin tab and
 * an unmasked column would otherwise query twice).
 */
async function permissionsForMember(column: "auth_user_id" | "id", value: string) {
  const db = createServiceClient();
  const { data } = await db
    .from("org_members")
    .select("org_assignments(org_roles(org_role_permissions(permission_key)))")
    .eq(column, value)
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

/** What the signed-in person actually holds, ignoring any preview. */
export async function myRealPermissions(): Promise<Set<Permission>> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Set();
  return permissionsForMember("auth_user_id", user.id);
}

/** Who the app should behave as: normally you, or someone you are previewing. */
export async function previewedMemberId(): Promise<string | null> {
  const jar = await cookies();
  const id = jar.get("preview_member")?.value ?? null;
  if (!id) return null;
  // A stale cookie must not grant anything, so the real rights are rechecked.
  const real = await myRealPermissions();
  return real.has("org.manage") ? id : null;
}

export async function myPermissions(): Promise<Set<Permission>> {
  const previewing = await previewedMemberId();
  if (previewing) return permissionsForMember("id", previewing);
  return myRealPermissions();
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

export type TeamRow = {
  id: string; service_id: string | null; name: string; slug: string;
  kind: "pod" | "group"; active: boolean;
  manager_member_id: string | null;
  memberIds: string[];
  clients: { id: string; name: string }[];
};

export type ClientRow = {
  id: string; salesforce_client_id: string | null; name: string;
  status: string | null; service_id: string | null;
  team_id: string | null; member_id: string | null; active: boolean;
};

/**
 * Pods with their people and, read-only, the clients pointing at them. Coverage
 * is set on the client record -- a client is the thing that has one owner, so a
 * pod's client list is a view of that rather than the place it is decided.
 */
export async function listPodsAndClients() {
  const db = createServiceClient();

  const [{ data: teams }, { data: assignments }, { data: clients }] = await Promise.all([
    db.from("org_teams").select("id,service_id,name,slug,kind,active,manager_member_id").order("name"),
    db.from("org_assignments").select("member_id,team_id").not("team_id", "is", null),
    db.from("org_clients")
      .select("id,salesforce_client_id,name,status,service_id,team_id,member_id,active")
      .order("name"),
  ]);

  const membersByTeam = new Map<string, string[]>();
  for (const a of (assignments ?? []) as { member_id: string; team_id: string }[]) {
    membersByTeam.set(a.team_id, [...(membersByTeam.get(a.team_id) ?? []), a.member_id]);
  }

  const rows = (clients ?? []) as ClientRow[];
  const clientsByTeam = new Map<string, { id: string; name: string }[]>();
  for (const c of rows.filter((c) => c.team_id)) {
    clientsByTeam.set(c.team_id!, [...(clientsByTeam.get(c.team_id!) ?? []), { id: c.id, name: c.name }]);
  }

  return {
    teams: ((teams ?? []) as Omit<TeamRow, "memberIds" | "clients">[]).map((t) => ({
      ...t,
      memberIds: [...new Set(membersByTeam.get(t.id) ?? [])],
      clients: clientsByTeam.get(t.id) ?? [],
    })),
    clients: rows,
  };
}

export type RoleDetail = {
  id: string; slug: string; name: string; description: string | null;
  service_id: string | null; active: boolean;
  permissionKeys: string[]; holders: number;
};

export async function listRolesAndPermissions() {
  const db = createServiceClient();
  const [{ data: roles }, { data: perms }, { data: rolePerms }, { data: assignments }] =
    await Promise.all([
      db.from("org_roles").select("id,slug,name,description,service_id,active").order("name"),
      db.from("org_permissions").select("key,name,description").order("key"),
      db.from("org_role_permissions").select("role_id,permission_key"),
      db.from("org_assignments").select("role_id"),
    ]);

  const byRole = new Map<string, string[]>();
  for (const rp of (rolePerms ?? []) as { role_id: string; permission_key: string }[]) {
    byRole.set(rp.role_id, [...(byRole.get(rp.role_id) ?? []), rp.permission_key]);
  }
  const holders = new Map<string, number>();
  for (const a of (assignments ?? []) as { role_id: string }[]) {
    holders.set(a.role_id, (holders.get(a.role_id) ?? 0) + 1);
  }

  return {
    roles: ((roles ?? []) as Omit<RoleDetail, "permissionKeys" | "holders">[]).map((r) => ({
      ...r,
      permissionKeys: byRole.get(r.id) ?? [],
      holders: holders.get(r.id) ?? 0,
    })),
    permissions: (perms ?? []) as { key: string; name: string; description: string | null }[],
  };
}

export type MatchSuggestion = {
  memberId: string; fullName: string | null; email: string;
  sfId: string | null; sfName: string | null; sfEmail: string | null;
  score: number | null; basis: string | null;
};

/**
 * Best Salesforce candidate for each unlinked person. Nothing is linked
 * automatically -- near-misses like "Matt Cool" against "Matt Beaver" score
 * high enough to be dangerous and need a human.
 */
export async function listSalesforceSuggestions(): Promise<MatchSuggestion[]> {
  const db = createServiceClient();
  const { data: unlinked } = await db
    .from("org_members").select("id,full_name,email")
    .is("salesforce_user_id", null).eq("active", true).order("full_name");

  const rows = (unlinked ?? []) as { id: string; full_name: string | null; email: string }[];
  const out = await Promise.all(rows.map(async (m) => {
    const { data } = await db.rpc("suggest_salesforce_matches", { p_member_id: m.id });
    const best = ((data ?? []) as {
      salesforce_user_id: string; sf_name: string; sf_email: string; score: number; basis: string;
    }[])[0];
    return {
      memberId: m.id, fullName: m.full_name, email: m.email,
      sfId: best?.salesforce_user_id ?? null, sfName: best?.sf_name ?? null,
      sfEmail: best?.sf_email ?? null,
      score: best ? Number(best.score) : null, basis: best?.basis ?? null,
    };
  }));
  return out;
}
