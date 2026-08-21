import { cookies } from "next/headers";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export type Permission =
  | "org.manage" | "lms.admin" | "lms.instruct" | "scoreboard.view"
  | "scoreboard.retention.unmask" | "scoreboard.weights.edit"
  | "timelines.view" | "timelines.view.all";

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

/** The person being previewed, for the banner and the identity block. */
export async function previewedMember() {
  const id = await previewedMemberId();
  if (!id) return null;
  const db = createServiceClient();
  const { data } = await db
    .from("org_members").select("id,full_name,email").eq("id", id).maybeSingle();
  return (data as { id: string; full_name: string | null; email: string } | null) ?? null;
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
/**
 * Salesforce ids of the people whose work is selling Factur's own services --
 * the BDMs and SDRs. Their opportunities are recorded in Prospecting Lead
 * Status rather than Stage, so the timeline has to know who they are. The app
 * roles are the source of truth, not anything read off the Salesforce record.
 */
export async function prospectingOwnerIds(): Promise<Set<string>> {
  const db = createServiceClient();
  const { data } = await db
    .from("org_assignments")
    .select("org_roles!inner(slug),org_members!inner(salesforce_user_id)")
    .in("org_roles.slug", ["bdm", "sdr"]);

  type Row = { org_members: { salesforce_user_id: string | null } | null };
  const ids = new Set<string>();
  for (const r of ((data ?? []) as unknown as Row[])) {
    const id = r.org_members?.salesforce_user_id;
    if (id) ids.add(id);
  }
  return ids;
}

export async function listMembers() {
  const db = createServiceClient();

  const [{ data: members }, { data: assignments }, { data: roles }, { data: services }] =
    await Promise.all([
      db.from("org_members")
        .select("id,email,full_name,active,needs_review,manager_member_id,salesforce_user_id")
        .order("needs_review", { ascending: false })
        .order("full_name"),
      db.from("org_assignments").select("member_id,role_id"),
      db.from("org_roles").select("id,slug,name,service_id,active").order("name"),
      // Names for the services, so the role picker can group by them rather
      // than showing eleven roles as one flat list.
      db.from("org_services").select("id,name").order("name"),
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
    services: (services ?? []) as { id: string; name: string }[],
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
      db.from("org_permissions").select("key,name,description,category,position").order("position"),
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
    permissions: (perms ?? []) as {
      key: string; name: string; description: string | null;
      category: string; position: number;
    }[],
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

/**
 * Which Salesforce owners the viewer may see leads for.
 *
 * null means no restriction. An empty array means nothing -- which is the right
 * answer for someone with no Salesforce account, since none of these leads are
 * theirs, and is deliberately distinct from "show everything".
 *
 * Honours the preview cookie, so previewing a rep really does narrow the page.
 */
export async function visibleOwnerIds(): Promise<string[] | null> {
  const perms = await myPermissions();
  if (perms.has("timelines.view.all")) return null;

  const db = createServiceClient();

  type Me = { id: string; salesforce_user_id: string | null };
  const previewing = await previewedMemberId();
  let me: Me | null = null;

  if (previewing) {
    const { data } = await db
      .from("org_members").select("id,salesforce_user_id").eq("id", previewing).maybeSingle();
    me = data as unknown as Me | null;
  } else {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];
    const { data } = await db
      .from("org_members").select("id,salesforce_user_id").eq("auth_user_id", user.id).maybeSingle();
    me = data as unknown as Me | null;
  }
  if (!me) return [];

  const ids = me.salesforce_user_id ? [me.salesforce_user_id] : [];

  // A manager is someone people report to -- taken from the reporting line
  // rather than a permission, so nobody has to grant it per person.
  const { data: reports } = await db
    .from("org_members").select("salesforce_user_id").eq("manager_member_id", me.id);
  for (const r of (reports ?? []) as { salesforce_user_id: string | null }[]) {
    if (r.salesforce_user_id) ids.push(r.salesforce_user_id);
  }

  return ids;
}

export { CLIENT_ROLE_FIELDS, type ClientRoleField } from "./client-roles";

/** One client with its team and everything Salesforce knows about it. */
export async function getClientDetail(clientId: string) {
  const db = createServiceClient();

  const { data: client } = await db
    .from("org_clients").select("*").eq("id", clientId).maybeSingle();
  if (!client) return null;

  const row = client as Record<string, unknown> & { salesforce_client_id: string | null };

  const { data: sf } = row.salesforce_client_id
    ? await db.from("sf_clients_raw").select("*").eq("id", row.salesforce_client_id).maybeSingle()
    : { data: null };

  // Leads are derived from the reporting line unless overridden, so read them
  // from the view rather than recomputing here.
  const { data: team } = await db
    .from("org_client_team").select("*").eq("client_id", clientId).maybeSingle();

  return {
    client: row,
    salesforce: (sf ?? null) as Record<string, unknown> | null,
    team: (team ?? null) as Record<string, unknown> | null,
  };
}

export type MaintenanceHealth = {
  healthy: boolean;
  last_success: string | null;
  last_failure: string | null;
  consecutive_failures: number;
  hours_since_success: number | null;
  newest_activity: string | null;
  problem: string | null;
};

/**
 * Whether the hourly job is working. Only worth showing to people who can act
 * on it, so callers gate on org.manage.
 */
export async function maintenanceHealth(): Promise<MaintenanceHealth | null> {
  const db = createServiceClient();
  const { data, error } = await db.rpc("maintenance_health");
  if (error) return null;
  const row = (data as MaintenanceHealth[] | null)?.[0];
  return row ?? null;
}

/** Throws unless the caller holds the permission. For server actions. */
export async function requirePermission(key: Permission) {
  const perms = await myPermissions();
  if (!perms.has(key)) throw new Error(`Forbidden: ${key} required`);
}

/**
 * The org roles the viewer holds, used to work out which courses are assigned
 * to them. Honours preview, so previewing a person shows their training.
 */
export async function myRoleIds(): Promise<string[]> {
  const db = createServiceClient();
  const previewing = await previewedMemberId();

  let memberId = previewing;
  if (!memberId) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];
    const { data } = await db
      .from("org_members").select("id").eq("auth_user_id", user.id).maybeSingle();
    memberId = (data as { id: string } | null)?.id ?? null;
  }
  if (!memberId) return [];

  const { data } = await db
    .from("org_assignments").select("role_id").eq("member_id", memberId);
  return ((data ?? []) as { role_id: string }[]).map((r) => r.role_id);
}
