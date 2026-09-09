"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { myPermissions } from "@/lib/org";
import { TOOL_BY_NAME } from "@/lib/gaib/tools";
import { AUTO_MAX_FILES, AUTO_MAX_LINES } from "@/lib/gaib/danger";
import { openDmsFor } from "@/lib/gaib/open-dm";

/*
 * Running the agent hub.
 *
 * Everything here is gated on org.manage and nothing else, because everything
 * here changes what an automated thing may do on other people's behalf. That is
 * one permission rather than a graded set on purpose -- a half-privilege to
 * "edit an agent's instructions but not its tools" is a distinction that reads
 * clearly on this page and not at all in the consequences.
 */

type Ok = { ok: boolean; error?: string };

async function mayManage() {
  return (await myPermissions()).has("org.manage");
}

const DENIED: Ok = { ok: false, error: "Not allowed" };

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

export async function createAgent(name: string, tagline: string): Promise<Ok & { id?: string }> {
  if (!(await mayManage())) return DENIED;
  const clean = name.trim();
  if (!clean) return { ok: false, error: "Give it a name" };

  const db = createServiceClient();
  const base = slugify(clean) || "agent";

  // A second agent called the same thing is a reasonable thing to want; a
  // second agent with the same slug is not, because sessions point at it.
  let slug = base;
  for (let n = 2; n < 50; n++) {
    const { data } = await db.from("gaib_agents").select("id").eq("slug", slug).maybeSingle();
    if (!data) break;
    slug = `${base}-${n}`;
  }

  const { data, error } = await db
    .from("gaib_agents")
    .insert({ slug, name: clean, tagline: tagline.trim() || null, enabled: false })
    .select("id")
    .single();

  if (error || !data) return { ok: false, error: error?.message ?? "Could not create it" };
  revalidatePath("/settings/agents");
  return { ok: true, id: (data as { id: string }).id };
}

export async function updateAgent(
  id: string,
  fields: {
    name?: string; tagline?: string; instructions?: string;
    model?: string; effort?: string; enabled?: boolean;
  }
): Promise<Ok> {
  if (!(await mayManage())) return DENIED;
  const db = createServiceClient();

  const patch: Record<string, unknown> = {};
  if (fields.name !== undefined) patch.name = fields.name.trim();
  if (fields.tagline !== undefined) patch.tagline = fields.tagline.trim() || null;
  if (fields.instructions !== undefined) patch.instructions = fields.instructions;
  if (fields.model !== undefined) patch.model = fields.model;
  if (fields.effort !== undefined) patch.effort = fields.effort;
  if (fields.enabled !== undefined) patch.enabled = fields.enabled;

  const { error } = await db.from("gaib_agents").update(patch).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings/agents");
  return { ok: true };
}

/**
 * Which tools an agent holds.
 *
 * Names the registry does not know are dropped rather than stored. Keeping them
 * would be harmless -- the chat loop ignores an unknown tool anyway -- but a
 * row saying an agent can read email when no such tool exists is exactly the
 * sort of thing somebody later reads as fact.
 */
export async function setAgentTools(id: string, tools: string[]): Promise<Ok> {
  if (!(await mayManage())) return DENIED;
  const known = tools.filter((t) => TOOL_BY_NAME.has(t));

  const db = createServiceClient();
  await db.from("gaib_agent_tools").delete().eq("agent_id", id);
  if (known.length) {
    const { error } = await db
      .from("gaib_agent_tools")
      .insert(known.map((tool) => ({ agent_id: id, tool })));
    if (error) return { ok: false, error: error.message };
  }
  revalidatePath("/settings/agents");
  return { ok: true };
}

/** Who may open it. An empty list means everybody. */
export async function setAgentRoles(id: string, roleIds: string[]): Promise<Ok> {
  if (!(await mayManage())) return DENIED;
  const db = createServiceClient();
  await db.from("gaib_agent_roles").delete().eq("agent_id", id);
  if (roleIds.length) {
    const { error } = await db
      .from("gaib_agent_roles")
      .insert(roleIds.map((role_id) => ({ agent_id: id, role_id })));
    if (error) return { ok: false, error: error.message };
  }
  revalidatePath("/settings/agents");
  return { ok: true };
}

export async function makeDefaultAgent(id: string): Promise<Ok> {
  if (!(await mayManage())) return DENIED;
  const db = createServiceClient();
  // Cleared first: the unique index allows only one, so setting the new one
  // while the old still holds it would be refused.
  await db.from("gaib_agents").update({ is_default: false }).eq("is_default", true);
  const { error } = await db
    .from("gaib_agents").update({ is_default: true, enabled: true }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings/agents");
  return { ok: true };
}

export async function deleteAgent(id: string): Promise<Ok> {
  if (!(await mayManage())) return DENIED;
  const db = createServiceClient();

  const { data } = await db
    .from("gaib_agents").select("is_default").eq("id", id).maybeSingle();
  if ((data as { is_default: boolean } | null)?.is_default) {
    return { ok: false, error: "Make another agent the default first" };
  }

  // Sessions keep their transcripts and lose their agent, rather than being
  // deleted along with it. A conversation somebody had is a record of what
  // happened; retiring the assistant does not un-happen it.
  const { error } = await db.from("gaib_agents").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings/agents");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// The coding agent
// ---------------------------------------------------------------------------

export type CodingSettings = {
  auto_ship: boolean;
  max_files: number;
  max_lines: number;
  extra_protected_paths: string[];
};

export async function getCodingSettings(): Promise<CodingSettings> {
  const db = createServiceClient();
  const { data } = await db
    .from("gaib_coding_settings")
    .select("auto_ship,max_files,max_lines,extra_protected_paths")
    .eq("id", true)
    .maybeSingle();

  return (data as CodingSettings | null) ?? {
    auto_ship: false, max_files: AUTO_MAX_FILES, max_lines: AUTO_MAX_LINES,
    extra_protected_paths: [],
  };
}

/**
 * Turning the coding agent down.
 *
 * The limits are clamped to the values in danger.ts rather than replacing them.
 * This page can make the agent stricter and can never make it looser, so
 * widening what an automated thing may push to production stays a code change
 * that a person reviews -- which is the only reason it is safe to expose these
 * on a web form at all.
 */
export async function updateCodingSettings(next: {
  auto_ship: boolean; max_files: number; max_lines: number; extra_protected_paths: string;
}): Promise<Ok> {
  if (!(await mayManage())) return DENIED;

  const paths = next.extra_protected_paths
    .split("\n").map((p) => p.trim()).filter(Boolean).slice(0, 200);

  const db = createServiceClient();
  const { error } = await db.from("gaib_coding_settings").update({
    auto_ship: next.auto_ship,
    max_files: Math.max(0, Math.min(Number(next.max_files) || 0, AUTO_MAX_FILES)),
    max_lines: Math.max(0, Math.min(Number(next.max_lines) || 0, AUTO_MAX_LINES)),
    extra_protected_paths: paths,
    updated_at: new Date().toISOString(),
  }).eq("id", true);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings/agents/coding");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Reaching people in Google Chat
// ---------------------------------------------------------------------------

export type ChatReach = {
  userId: string | null;
  memberId: string;
  name: string;
  email: string;
  /** Whether Gaib can already speak to them without being spoken to first. */
  open: boolean;
  /** No account yet. They get an invitation rather than the ordinary hello. */
  neverSignedIn: boolean;
};

/**
 * Who Gaib can and cannot reach.
 *
 * Worth having on screen rather than inferring from silence: until a direct
 * message space exists, every notification aimed at somebody simply does not
 * arrive, and nothing anywhere says so.
 *
 * People with no account are listed too. They were left out while the
 * conversation was filed against an app account, which excluded exactly the
 * people worth writing to -- twelve members of staff who have never opened the
 * app and would never have been told it exists.
 */
export async function chatReach(): Promise<ChatReach[]> {
  if (!(await mayManage())) return [];
  const db = createServiceClient();

  const { data: members } = await db
    .from("org_members")
    .select("id,full_name,email,auth_user_id")
    .eq("active", true)
    .order("full_name");

  const rows = (members ?? []) as {
    id: string; full_name: string | null; email: string | null; auth_user_id: string | null;
  }[];

  const { data: spaces } = await db.from("gaib_chat_spaces").select("email");
  const open = new Set(
    ((spaces ?? []) as { email: string | null }[])
      .map((s) => s.email?.toLowerCase())
      .filter(Boolean) as string[]
  );

  return rows
    .filter((r) => r.email)
    .map((r) => ({
      userId: r.auth_user_id,
      memberId: r.id,
      name: r.full_name ?? r.email!,
      email: r.email!,
      open: open.has(r.email!.toLowerCase()),
      neverSignedIn: !r.auth_user_id,
    }));
}

/**
 * Open the conversation with the people named, and introduce Gaib once.
 *
 * Takes an explicit list rather than doing everybody, because the first run of
 * this puts an unsolicited message in real people's Chat and the sensible way
 * to do that is two of you first, then the rest.
 */
export async function openChatWith(
  memberIds: string[]
): Promise<Ok & { opened?: number; greeted?: number; failures?: { name: string; why: string }[] }> {
  if (!(await mayManage())) return DENIED;
  if (!memberIds.length) return { ok: false, error: "Nobody selected" };

  // Keyed on the org record, not the account: the people this most needs to
  // reach are the ones who have no account.
  const wanted = new Set(memberIds);
  const people = (await chatReach()).filter((p) => wanted.has(p.memberId));
  if (!people.length) return { ok: false, error: "Nobody selected" };

  const results = await openDmsFor(
    people.map((p) => ({ userId: p.userId, email: p.email, name: p.name }))
  );

  revalidatePath("/settings/agents");
  return {
    ok: true,
    opened: results.filter((r) => r.result.ok).length,
    greeted: results.filter((r) => r.introduced).length,
    failures: results
      .filter((r) => !r.result.ok)
      .map((r) => ({ name: r.name, why: (r.result as { reason: string }).reason })),
  };
}
