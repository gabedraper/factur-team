import { createServiceClient } from "@/lib/supabase/server";
import { GAIB_SYSTEM } from "./prompt";

/*
 * Loading an agent, and deciding whether somebody may open it.
 *
 * Everything here reads with the service key on purpose: the question "which
 * agents exist and who may use them" has to be answerable before we know
 * whether this person may see the answer, and the deciding is done here rather
 * than by a policy. The agent's *data* access is a different matter entirely
 * and is never done with this key -- see tools.ts.
 */

export type Agent = {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  instructions: string;
  model: string;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  enabled: boolean;
  isDefault: boolean;
  tools: string[];
  /** Role ids allowed to open it. Empty means everybody. */
  roleIds: string[];
};

type Row = {
  id: string; slug: string; name: string; tagline: string | null;
  instructions: string; model: string; effort: Agent["effort"];
  enabled: boolean; is_default: boolean;
  gaib_agent_tools: { tool: string }[];
  gaib_agent_roles: { role_id: string }[];
};

function shape(row: Row): Agent {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    tagline: row.tagline,
    // An agent whose instructions have been emptied would otherwise run on the
    // preamble alone, which is a coherent but characterless assistant. Falling
    // back to the seed is the kinder failure.
    instructions: row.instructions?.trim() || GAIB_SYSTEM,
    model: row.model,
    effort: row.effort,
    enabled: row.enabled,
    isDefault: row.is_default,
    tools: (row.gaib_agent_tools ?? []).map((t) => t.tool),
    roleIds: (row.gaib_agent_roles ?? []).map((r) => r.role_id),
  };
}

const SELECT = "*, gaib_agent_tools(tool), gaib_agent_roles(role_id)";

export async function listAgents(): Promise<Agent[]> {
  const db = createServiceClient();
  const { data } = await db.from("gaib_agents").select(SELECT).order("created_at");
  return ((data ?? []) as Row[]).map(shape);
}

export async function getAgent(idOrSlug: string): Promise<Agent | null> {
  const db = createServiceClient();
  const column = /^[0-9a-f-]{36}$/i.test(idOrSlug) ? "id" : "slug";
  const { data } = await db.from("gaib_agents").select(SELECT).eq(column, idOrSlug).maybeSingle();
  return data ? shape(data as Row) : null;
}

/** The one the sidebar button opens. */
export async function defaultAgent(): Promise<Agent | null> {
  const db = createServiceClient();
  const { data } = await db
    .from("gaib_agents").select(SELECT).eq("is_default", true).maybeSingle();
  return data ? shape(data as Row) : (await listAgents()).find((a) => a.enabled) ?? null;
}

/** Which org roles a person holds, for the audience check below. */
export async function myRoleIds(userId: string): Promise<string[]> {
  const db = createServiceClient();
  const { data } = await db
    .from("org_members")
    .select("org_assignments(role_id)")
    .eq("auth_user_id", userId)
    .maybeSingle();

  const row = data as { org_assignments?: { role_id: string }[] } | null;
  return (row?.org_assignments ?? []).map((a) => a.role_id).filter(Boolean);
}

/**
 * Whether this person may open this agent.
 *
 * An agent with no roles listed is open to everyone, which is the default
 * because the first one is a feedback assistant that fails at its job if half
 * the company cannot reach it. Restriction is opt-in, for the narrower agents
 * that come later.
 */
export function mayUse(agent: Agent, roleIds: string[]): boolean {
  if (!agent.enabled) return false;
  if (!agent.roleIds.length) return true;
  return agent.roleIds.some((r) => roleIds.includes(r));
}
