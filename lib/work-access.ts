import { cache } from "react";
import { createServiceClient } from "@/lib/supabase/server";
import { previewedMember } from "@/lib/org";
import { getAuthedUser } from "@/lib/supabase/session";

/**
 * What the current viewer may see of the ClickUp mirror.
 *
 * The mirror reads through one admin token that sees everything, so access
 * has to be re-applied here or it does not exist. The decision itself is made
 * in SQL, by work_access_for, from what ClickUp says about each list:
 *
 *   ClickUp owner or admin -> everything
 *   anyone else            -> the lists ClickUp lets them open
 *   no ClickUp account     -> public spaces only
 *
 * It comes back as the sets to hide, in two tiers: whole spaces, then folders
 * and lists inside the spaces the viewer does see. The first tier keeps the
 * second small -- a median of one list -- which is what makes it safe to pass
 * as a query filter.
 *
 * Respects role preview: a preview that does not narrow access is lying about
 * exactly the thing it exists to check.
 */
export type Access = {
  seeAll: boolean;
  hiddenSpaces: string[];
  hiddenFolders: string[];
  hiddenLists: string[];
};

/* Nobody signed in, or an answer that did not arrive: every private space is
 * hidden. Access fails shut, never open. */
const SHUT = async (): Promise<Access> => {
  const { data } = await createServiceClient()
    .from("work_containers").select("clickup_id").eq("kind", "space").eq("private", true);
  return {
    seeAll: false,
    hiddenSpaces: ((data ?? []) as { clickup_id: string }[]).map((r) => r.clickup_id),
    hiddenFolders: [],
    hiddenLists: [],
  };
};

export const access = cache(async (): Promise<Access> => {
  const { memberId } = await viewer();
  if (!memberId) return SHUT();

  const { data, error } = await createServiceClient()
    .rpc("work_access_for", { p_member: memberId }).single();
  if (error || !data) return SHUT();

  const row = data as {
    see_all: boolean; hidden_spaces: string[] | null;
    hidden_folders: string[] | null; hidden_lists: string[] | null;
  };
  return {
    seeAll: row.see_all,
    hiddenSpaces: row.hidden_spaces ?? [],
    hiddenFolders: row.hidden_folders ?? [],
    hiddenLists: row.hidden_lists ?? [],
  };
});

/**
 * Who is asking, as far as the mirror is concerned: the previewed person when
 * previewing, otherwise the signed-in one. One answer for every access check,
 * so a grant and a list membership can never be judged for different people.
 */
export const viewer = cache(async (): Promise<{ memberId: string | null; email: string | null }> => {
  const previewing = await previewedMember();
  if (previewing) return { memberId: previewing.id, email: previewing.email };

  const user = await getAuthedUser();
  if (!user) return { memberId: null, email: null };

  const { data } = await createServiceClient()
    .from("org_members").select("id,email").eq("auth_user_id", user.id).maybeSingle();
  const row = data as { id: string; email: string } | null;
  return { memberId: row?.id ?? null, email: row?.email ?? user.email ?? null };
});

/** Tasks shared with the viewer one at a time, by ClickUp id. */
export const grantedTaskIds = cache(async (): Promise<Set<string>> => {
  const { memberId } = await viewer();
  if (!memberId) return new Set();
  const { data } = await createServiceClient()
    .from("work_access_grants").select("clickup_id").eq("member_id", memberId);
  return new Set(((data ?? []) as { clickup_id: string }[]).map((g) => g.clickup_id));
});

/** PostgREST's `in` list syntax, quoted, for use with .not(col, "in", ...). */
export function inList(ids: string[]): string {
  return `(${ids.map((id) => `"${id.replace(/"/g, "")}"`).join(",")})`;
}

type Notable<Q> = { not: (column: string, op: string, value: string) => Q };

function exclude<Q>(query: Q, column: string, ids: string[]): Q {
  return ids.length ? (query as unknown as Notable<Q>).not(column, "in", inList(ids)) : query;
}

/**
 * Drop what the viewer may not see from a query, in the query -- not after it,
 * so a page of results is never spent on rows that are then thrown away.
 *
 *   "items"      work_items: hidden spaces, then hidden lists
 *   "spaces"     work_containers where kind = 'space'
 *   "containers" folders and lists: hidden spaces, then hidden folders/lists
 */
export function withoutHidden<Q>(query: Q, a: Access, target: "items" | "spaces" | "containers" = "items"): Q {
  if (a.seeAll) return query;
  if (target === "spaces") return exclude(query, "clickup_id", a.hiddenSpaces);
  const q = exclude(query, "space_clickup_id", a.hiddenSpaces);
  return target === "items"
    ? exclude(q, "clickup_list_id", a.hiddenLists)
    : exclude(q, "clickup_id", [...a.hiddenFolders, ...a.hiddenLists]);
}

/** Whether one container is hidden -- for a page that has already fetched it. */
export function isHidden(a: Access, c: { kind: string; clickup_id: string; space_clickup_id: string | null }): boolean {
  if (a.seeAll) return false;
  const space = c.kind === "space" ? c.clickup_id : c.space_clickup_id;
  if (!space || a.hiddenSpaces.includes(space)) return true;
  return a.hiddenFolders.includes(c.clickup_id) || a.hiddenLists.includes(c.clickup_id);
}

/**
 * The earlier name, kept so code written against it keeps working. It now
 * returns the full Access rather than a list of space ids, and withoutHidden
 * reads it the same way -- so a caller written for space-level filtering gets
 * list-level filtering without changing a line. Prefer access() in new code.
 */
export const hiddenSpaceIds = access;
