"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { draftAs } from "@/lib/google/compose";
import { fill as fillCollections } from "@/lib/collections/render";
import { fill as fillNps, surveyUrl } from "@/lib/nps/render";
import { myPermissions, type Permission } from "@/lib/org";
import type { Ending } from "@/lib/sequences";

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

export type Sequence = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  mode: "semi" | "full";
  ends_on: Ending[];
};

export type SequenceStep = {
  id: string;
  position: number;
  offset_days: number;
  channel: Channel;
  config: Record<string, string>;
  active: boolean;
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
    .from("sequences").select("id,slug,name,description,mode,ends_on")
    .eq("slug", slug).maybeSingle();
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


/** Start a new ladder. Nothing runs through it until something opens a run. */
export async function createSequence(name: string, description: string) {
  const perms = await myPermissions();
  if (!perms.has("org.manage")) return { success: false, error: "Not permitted." };

  const clean = name.trim();
  if (!clean) return { success: false, error: "Give it a name." };

  const slug = clean.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!slug) return { success: false, error: "That name has no letters in it." };

  const { error } = await createServiceClient().from("sequences").insert({
    slug, name: clean, description: description.trim() || null,
    mode: "semi", ends_on: ["manual"],
  });

  if (error) {
    return {
      success: false,
      error: error.code === "23505" ? "There is already a sequence with that name." : error.message,
    };
  }
  revalidatePath("/settings/sequences");
  return { success: true, slug };
}

export async function setSequenceEndings(slug: string, endings: Ending[]) {
  if (!(await mayEdit(slug))) return { success: false, error: "Not permitted." };
  // Stopping one by hand is always possible, so it is always on the list.
  const list = [...new Set([...endings, "manual" as Ending])];
  const { error } = await createServiceClient()
    .from("sequences").update({ ends_on: list }).eq("slug", slug);
  if (error) return { success: false, error: error.message };
  revalidatePath(`/settings/sequences/${slug}`);
  return { success: true };
}

/*
 * Send one step to yourself.
 *
 * Drafted rather than sent, and always to the person asking -- there is no
 * recipient field to get wrong. The merge fields come from a real open run
 * where there is one, so what you read is what a client would read rather than
 * a row of braces.
 */
export async function testStep(slug: string, stepId: string) {
  if (!(await mayEdit(slug))) return { success: false, error: "Not permitted." };

  const { data: { user } } = await (await createClient()).auth.getUser();
  const me = user?.email;
  if (!me) return { success: false, error: "No mailbox to send to." };

  const db = createServiceClient();
  const { data: step } = await db
    .from("sequence_steps").select("config,sequence_id").eq("id", stepId).maybeSingle();
  if (!step) return { success: false, error: "No such step." };

  const { config, sequence_id } = step as { config: Record<string, string>; sequence_id: string };

  // Any live run will do; this is about the wording, not about who gets it.
  const { data: run } = await db
    .from("sequence_runs").select("context")
    .eq("sequence_id", sequence_id).is("ended_at", null).limit(1).maybeSingle();

  const c = ((run as { context: Record<string, unknown> } | null)?.context ?? {}) as
    Record<string, string | number | null>;

  const subject = String(config.subject ?? "");
  const body = String(config.body ?? "");

  const rendered = slug === "nps"
    ? {
        subject: fillNps(subject, {
          client_name: String(c.client_name ?? "Example Client"),
          contact_first_name: (c.contact_first_name as string) ?? "there",
          sender_name: me,
          url: surveyUrl(process.env.NEXT_PUBLIC_SITE_URL ?? "", String(c.token ?? "test")),
        }),
        body: fillNps(body, {
          client_name: String(c.client_name ?? "Example Client"),
          contact_first_name: (c.contact_first_name as string) ?? "there",
          sender_name: me,
          url: surveyUrl(process.env.NEXT_PUBLIC_SITE_URL ?? "", String(c.token ?? "test")),
        }),
      }
    : (() => {
        const figures = {
          client_name: String(c.client_name ?? "Example Client"),
          contact_first_name: (c.contact_first_name as string) ?? "there",
          payment_terms: (c.payment_terms as string) ?? null,
          days_past_due: Number(c.days_past_due ?? 0),
          past_due_total: c.past_due_total === null ? null : Number(c.past_due_total ?? 0),
          open_balance: c.open_balance === null ? null : Number(c.open_balance ?? 0),
          oldest_invoice_no: (c.oldest_invoice_no as string) ?? null,
          invoice_lines: (c.invoice_lines as string) ?? null,
          sender_name: me,
        };
        return { subject: fillCollections(subject, figures), body: fillCollections(body, figures) };
      })();

  try {
    await draftAs({
      from: me,
      fromName: null,
      to: me,
      subject: `[test] ${rendered.subject}`,
      body: rendered.body,
    });
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Could not draft it." };
  }

  return { success: true, error: undefined };
}
