import { cache } from "react";
import { createServiceClient } from "@/lib/supabase/server";
import { previewedMember } from "@/lib/org";
import { getAuthedUser } from "@/lib/supabase/session";

/**
 * The ClickUp spaces the current viewer may not see.
 *
 * The mirror reads through one personal token that sees every private space,
 * so access has to be re-applied here or it simply does not exist: fifteen of
 * twenty-three spaces are private over there, Finance and People Ops among
 * them. Every read path asks this first.
 *
 * Returns the set to hide rather than to show, because the common case -- a
 * viewer who is in every private space they could have work in, or a space
 * list with nothing private -- is then an empty set that costs nothing.
 *
 * Respects role preview: previewing someone has to narrow what you see to what
 * they would see, or the preview is lying about exactly the thing it exists to
 * check.
 */
export const hiddenSpaceIds = cache(async (): Promise<string[]> => {
  const db = createServiceClient();

  let email: string | null = null;
  const previewing = await previewedMember();
  if (previewing) {
    email = previewing.email;
  } else {
    const user = await getAuthedUser();
    if (user) {
      const { data } = await db
        .from("org_members").select("email").eq("auth_user_id", user.id).maybeSingle();
      email = (data as { email: string } | null)?.email ?? user.email ?? null;
    }
  }

  /* No identity means no private space membership, so everything private is
   * hidden -- never the other way round. */
  const { data } = await db.rpc("work_hidden_space_ids", { p_email: email ?? "" });
  return ((data ?? []) as unknown[]).map((r) =>
    typeof r === "string" ? r : String((r as Record<string, unknown>).work_hidden_space_ids ?? "")
  ).filter(Boolean);
});

/** PostgREST's `in` list syntax, quoted, for use with .not(col, "in", ...). */
export function inList(ids: string[]): string {
  return `(${ids.map((id) => `"${id.replace(/"/g, "")}"`).join(",")})`;
}

/**
 * Drop rows in spaces the viewer may not see from a work_items or
 * work_containers query. Applied in the query, not after it, so a limit cannot
 * be spent on rows that are then thrown away.
 *
 * `column` is the space id column: space_clickup_id on items and on folders and
 * lists, clickup_id on the spaces themselves.
 */
export function withoutHidden<Q>(query: Q, hidden: string[], column = "space_clickup_id"): Q {
  if (hidden.length === 0) return query;
  return (query as unknown as { not: (c: string, op: string, v: string) => Q })
    .not(column, "in", inList(hidden));
}
