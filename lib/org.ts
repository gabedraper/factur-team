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
  id: string; service_id: string; name: string; slug: string;
  kind: "pod" | "group"; active: boolean;
  memberIds: string[];
  clients: { id: string; client_id: string; client_name: string | null }[];
};

/**
 * Pods and groups, with who is in them and which clients they cover. Coverage
 * held by an individual rather than a pod comes back separately, since the two
 * are deliberately different arrangements.
 */
export async function listTeamsAndCoverage() {
  const db = createServiceClient();

  const [{ data: teams }, { data: assignments }, { data: coverage }, { data: clients }] =
    await Promise.all([
      db.from("org_teams").select("id,service_id,name,slug,kind,active").order("name"),
      db.from("org_assignments").select("member_id,team_id").not("team_id", "is", null),
      db.from("org_client_coverage").select("id,client_id,client_name,team_id,member_id"),
      db.from("sf_clients_raw")
        .select("id,client_account__r_name,client_status__c")
        .order("client_account__r_name"),
    ]);

  const membersByTeam = new Map<string, string[]>();
  for (const a of (assignments ?? []) as { member_id: string; team_id: string }[]) {
    membersByTeam.set(a.team_id, [...(membersByTeam.get(a.team_id) ?? []), a.member_id]);
  }

  type Cov = { id: string; client_id: string; client_name: string | null; team_id: string | null; member_id: string | null };
  const cov = (coverage ?? []) as Cov[];
  const clientsByTeam = new Map<string, Cov[]>();
  for (const c of cov.filter((c) => c.team_id)) {
    clientsByTeam.set(c.team_id!, [...(clientsByTeam.get(c.team_id!) ?? []), c]);
  }

  return {
    teams: ((teams ?? []) as Omit<TeamRow, "memberIds" | "clients">[]).map((t) => ({
      ...t,
      memberIds: [...new Set(membersByTeam.get(t.id) ?? [])],
      clients: (clientsByTeam.get(t.id) ?? []).map((c) => ({
        id: c.id, client_id: c.client_id, client_name: c.client_name,
      })),
    })),
    individualCoverage: cov.filter((c) => c.member_id),
    clients: ((clients ?? []) as { id: string; client_account__r_name: string | null; client_status__c: string | null }[])
      .map((c) => ({ id: c.id, name: c.client_account__r_name, status: c.client_status__c })),
  };
}
