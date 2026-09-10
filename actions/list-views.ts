"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { currentMemberId } from "@/lib/org";
import { ENTITIES } from "@/lib/list-views/catalogue";

/**
 * A person's own adjustments to their view list — hiding one, pinning one to
 * the chip row, moving it along.
 *
 * These write to `list_view_prefs`, which holds a row only once somebody
 * actually changes something. A person who has never touched their views has
 * no rows at all, and gets the defaults from the catalogue.
 *
 * `view_key` is a string rather than a foreign key on purpose: most views are
 * not rows anywhere. `system:mine` is defined in code and `scoped:client:<id>`
 * is rendered from the client list, and a person still has to be able to hide
 * either of them.
 */

type Result = { success: boolean; error?: string };

async function ctx(entity: string) {
  if (!ENTITIES[entity]) throw new Error(`Unknown list: ${entity}`);
  const memberId = await currentMemberId();
  if (!memberId) throw new Error("No member record for you.");
  return { db: await createClient(), memberId };
}

async function writePref(
  entity: string,
  viewKey: string,
  patch: Record<string, unknown>,
): Promise<Result> {
  try {
    const { db, memberId } = await ctx(entity);
    const { error } = await db.from("list_view_prefs").upsert(
      {
        member_id: memberId,
        entity,
        view_key: viewKey,
        ...patch,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "member_id,entity,view_key" },
    );
    if (error) return { success: false, error: error.message };
    /*
     * The view row sits on every list for this entity, so the whole section is
     * revalidated rather than one path. Guessing which page the person is on
     * is how a chip stays visible after being hidden.
     */
    revalidatePath("/", "layout");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Failed" };
  }
}

export async function hideView(entity: string, viewKey: string, hidden: boolean) {
  return writePref(entity, viewKey, { hidden });
}

export async function pinView(entity: string, viewKey: string, pinned: boolean) {
  return writePref(entity, viewKey, { pinned });
}

export async function moveView(entity: string, viewKey: string, position: number) {
  return writePref(entity, viewKey, { position });
}

/**
 * Turns whatever is currently on screen into a named view.
 *
 * The filters come from the URL rather than from component state, which is the
 * point of putting them there: what gets saved is exactly what the person was
 * looking at, and it is the same thing they would have got by sending someone
 * the link.
 */
export async function saveView(input: {
  entity: string;
  name: string;
  params: Record<string, string>;
  shared: boolean;
}): Promise<Result & { id?: string }> {
  try {
    const { db, memberId } = await ctx(input.entity);
    const name = input.name.trim();
    if (!name) return { success: false, error: "A view needs a name." };

    const { data, error } = await db
      .from("list_views")
      .insert({
        entity: input.entity,
        name,
        filters: input.params,
        columns: [],
        sort_dir: "asc",
        shared: input.shared,
        // A shared view belongs to nobody, so it survives the person leaving.
        owner_member_id: input.shared ? null : memberId,
        // Set when the saved view is about one client, so it hides with them.
        client_id: input.params.client ?? null,
      })
      .select("id")
      .maybeSingle();

    if (error) return { success: false, error: error.message };
    revalidatePath("/", "layout");
    return { success: true, id: (data as { id: string } | null)?.id };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Failed" };
  }
}

export async function deleteView(entity: string, id: string): Promise<Result> {
  try {
    const { db } = await ctx(entity);
    /*
     * Scoped to the entity as well as the id. The table serves every list now,
     * and an id alone would let a bad call delete another list's view.
     */
    const { error } = await db
      .from("list_views").delete().eq("id", id).eq("entity", entity);
    if (error) return { success: false, error: error.message };
    revalidatePath("/", "layout");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Failed" };
  }
}
