"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { myPermissions, type Permission } from "@/lib/org";

/*
 * One ladder editor for every process.
 *
 * Collections and NPS were the same job written twice, hours apart. What
 * differs between them -- what starts a run, what ends it, who it comes from --
 * is not here and should never be: this is the definition, and the definition
 * is the same shape whether you are chasing money or asking for a score.
 *
 * A step carries a channel and a config rather than a subject and a body, which
 * is the whole reason SMS, Chat, ClickUp and document steps can be added later
 * without touching the ladder, the queue or the log.
 */

export type Channel = "email";

export type SequenceStep = {
  id: string;
  position: number;
  offset_days: number;
  channel: Channel;
  config: Record<string, string>;
  active: boolean;
};

export type Sequence = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  mode: "semi" | "full";
};

/** Each sequence says who may edit it, since finance and NPS are different jobs. */
const EDIT_PERMISSION: Record<string, Permission> = {
  collections: "finance.collections",
  nps: "nps.send",
};

async function mayEdit(slug: string): Promise<boolean> {
  const perms = await myPermissions();
  return perms.has("org.manage") || perms.has(EDIT_PERMISSION[slug] ?? "org.manage");
}

export async function getSequence(
  slug: string
): Promise<{ sequence: Sequence | null; steps: SequenceStep[] }> {
  const db = createServiceClient();

  const { data: seq } = await db
    .from("sequences").select("id,slug,name,description,mode").eq("slug", slug).maybeSingle();
  if (!seq) return { sequence: null, steps: [] };

  const sequence = seq as unknown as Sequence;
  const { data: steps } = await db
    .from("sequence_steps")
    .select("id,position,offset_days,channel,config,active")
    .eq("sequence_id", sequence.id)
    .order("position");

  return { sequence, steps: (steps ?? []) as unknown as SequenceStep[] };
}

export async function saveSequenceStep(
  slug: string,
  step: {
    id?: string;
    position: number;
    offset_days: number;
    channel?: Channel;
    config: Record<string, string>;
    active: boolean;
  }
) {
  if (!(await mayEdit(slug))) return { success: false, error: "Not permitted." };

  const db = createServiceClient();
  const { data: seq } = await db.from("sequences").select("id").eq("slug", slug).maybeSingle();
  if (!seq) return { success: false, error: "No such sequence." };

  const row = {
    sequence_id: (seq as { id: string }).id,
    position: step.position,
    offset_days: step.offset_days,
    channel: step.channel ?? "email",
    config: step.config,
    active: step.active,
    updated_at: new Date().toISOString(),
  };

  const { error } = step.id
    ? await db.from("sequence_steps").update(row).eq("id", step.id)
    : await db.from("sequence_steps").insert(row);

  if (error) return { success: false, error: error.message };
  revalidatePath(`/settings/sequences/${slug}`);
  revalidatePath("/collections");
  revalidatePath("/clients/nps");
  return { success: true };
}

export async function deleteSequenceStep(slug: string, id: string) {
  if (!(await mayEdit(slug))) return { success: false, error: "Not permitted." };
  const { error } = await createServiceClient().from("sequence_steps").delete().eq("id", id);
  if (error) return { success: false, error: error.message };
  revalidatePath(`/settings/sequences/${slug}`);
  return { success: true };
}

/** Whether a due step becomes a draft somebody looks at, or simply goes. */
export async function setSequenceMode(slug: string, mode: "semi" | "full") {
  if (!(await mayEdit(slug))) return { success: false, error: "Not permitted." };
  const { error } = await createServiceClient()
    .from("sequences").update({ mode }).eq("slug", slug);
  if (error) return { success: false, error: error.message };
  revalidatePath(`/settings/sequences/${slug}`);
  return { success: true };
}
