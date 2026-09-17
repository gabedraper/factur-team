"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { draftAs } from "@/lib/google/compose";
import { fill as fillCollections, fillHtml as fillCollectionsHtml } from "@/lib/collections/render";
import { fill as fillNps, fillHtml as fillNpsHtml, surveyUrl } from "@/lib/nps/render";
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
  /** Do not start a run for somebody who has already been through this one. */
  skip_if_completed: boolean;
  /** Do not start one for somebody part way through a different sequence. */
  skip_if_active_elsewhere: boolean;
  /** When one person at a company replies, stop chasing the others there. */
  exit_same_domain: boolean;
};

export type SequenceStep = {
  id: string;
  position: number;
  offset_days: number;
  channel: Channel;
  config: Record<string, string>;
  active: boolean;
  /** This person's own wording, where they have written any. */
  variant?: Record<string, string> | null;
};

export type Writer = { id: string; name: string };


/** Each sequence says who may edit it, since finance and NPS are different jobs. */
const EDIT_PERMISSION: Record<string, Permission> = {
  collections: "finance.collections",
  nps: "nps.send",
};

async function mayEdit(slug: string): Promise<boolean> {
  const perms = await myPermissions();
  return perms.has("org.manage") || perms.has(EDIT_PERMISSION[slug] ?? "org.manage");
}

/*
 * The ladder, optionally as one person writes it.
 *
 * `writerId` picks whose wording to show. Null is the shared version everyone
 * falls back to. Passing a person shows theirs, with the shared one behind it
 * wherever they have not written their own.
 */
export async function getSequence(
  slug: string,
  writerId?: string | null
): Promise<{ sequence: Sequence | null; steps: SequenceStep[]; writers: Writer[] }> {
  const db = createServiceClient();

  const { data: seq } = await db
    .from("sequences").select("id,slug,name,description,mode,ends_on,skip_if_completed,skip_if_active_elsewhere,exit_same_domain")
    .eq("slug", slug).maybeSingle();
  if (!seq) return { sequence: null, steps: [], writers: [] };

  const sequence = seq as unknown as Sequence;
  const { data: steps } = await db
    .from("sequence_steps")
    .select("id,position,offset_days,channel,config,active")
    .eq("sequence_id", sequence.id)
    .order("position");

  const rows = (steps ?? []) as unknown as SequenceStep[];

  /*
   * Who may write their own version: whoever holds the role this sequence is
   * sent by. Taken from the role rather than from who has already sent, so a
   * team lead can write theirs before their first survey goes out -- and a
   * sequence sent by account managers would need nothing changed here.
   */
  const { data: people } = await db.rpc("get_sequence_writers", { p_slug: slug });
  const writers = (people ?? []) as unknown as Writer[];

  if (writerId) {
    const { data: variants } = await db
      .from("sequence_step_variants")
      .select("step_id,config")
      .eq("member_id", writerId);

    const byStep = new Map(
      ((variants ?? []) as { step_id: string; config: Record<string, string> }[])
        .map((v) => [v.step_id, v.config])
    );
    for (const r of rows) r.variant = byStep.get(r.id) ?? null;
  }

  return { sequence, steps: rows, writers };
}

/** Save one person's own wording for a step, or clear it back to the shared one. */
export async function saveStepVariant(
  slug: string,
  stepId: string,
  memberId: string,
  config: Record<string, string> | null
) {
  if (!(await mayEdit(slug))) return { success: false, error: "Not permitted." };

  const db = createServiceClient();
  const { data: { user } } = await (await createClient()).auth.getUser();

  const { error } = config
    ? await db.from("sequence_step_variants").upsert(
        {
          step_id: stepId, member_id: memberId, config,
          updated_at: new Date().toISOString(), updated_by: user?.email ?? null,
        },
        { onConflict: "step_id,member_id" }
      )
    : await db.from("sequence_step_variants")
        .delete().eq("step_id", stepId).eq("member_id", memberId);

  if (error) return { success: false, error: error.message };
  revalidatePath(`/settings/sequences/${slug}`);
  return { success: true };
}

/** The signed-in person, when they are one of the writers. */
export async function whoAmI(): Promise<string | null> {
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user?.email) return null;
  const { data } = await createServiceClient()
    .from("org_members").select("id").ilike("email", user.email).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
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

/**
 * The rules that decide who gets added and when a run stops early.
 *
 * One setter for the three flags rather than three, because the screen offers
 * them as one group of switches and a round trip each would let two of them
 * disagree if one failed.
 */
export async function setSequenceRules(
  slug: string,
  patch: Partial<{
    skip_if_completed: boolean;
    skip_if_active_elsewhere: boolean;
    exit_same_domain: boolean;
  }>
) {
  if (!(await mayEdit(slug))) return { success: false, error: "Not permitted." };
  const { error } = await createServiceClient()
    .from("sequences").update(patch).eq("slug", slug);
  if (error) return { success: false, error: error.message };
  revalidatePath(`/settings/sequences/${slug}`);
  return { success: true };
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
export async function testStep(slug: string, stepId: string, writerId?: string | null) {
  if (!(await mayEdit(slug))) return { success: false, error: "Not permitted." };

  const { data: { user } } = await (await createClient()).auth.getUser();
  const me = user?.email;
  if (!me) return { success: false, error: "No mailbox to send to." };

  const db = createServiceClient();
  const { data: step } = await db
    .from("sequence_steps").select("config,sequence_id").eq("id", stepId).maybeSingle();
  if (!step) return { success: false, error: "No such step." };

  const { config: shared, sequence_id } =
    step as { config: Record<string, string>; sequence_id: string };

  /*
   * Test what they would actually send. Their own wording where they have
   * written any, the shared version where they have not -- which is exactly
   * what the queue does at send time.
   */
  let config = shared;
  if (writerId) {
    const { data: variant } = await db
      .from("sequence_step_variants").select("config")
      .eq("step_id", stepId).eq("member_id", writerId).maybeSingle();
    const own = (variant as { config: Record<string, string> } | null)?.config;
    if (own) config = { ...shared, ...own };
  }

  // Any live run will do; this is about the wording, not about who gets it.
  const { data: run } = await db
    .from("sequence_runs").select("context")
    .eq("sequence_id", sequence_id).is("ended_at", null).limit(1).maybeSingle();

  const c = ((run as { context: Record<string, unknown> } | null)?.context ?? {}) as
    Record<string, string | number | null>;

  const subject = String(config.subject ?? "");
  const body = String(config.body ?? "");

  const npsFigures = {
    client_name: String(c.client_name ?? "Example Client"),
    contact_first_name: (c.contact_first_name as string) ?? "there",
    sender_name: me,
    url: surveyUrl(process.env.NEXT_PUBLIC_SITE_URL ?? "", String(c.token ?? "test")),
  };

  const rendered = slug === "nps"
    ? {
        subject: fillNps(subject, npsFigures),
        body: fillNps(body, npsFigures),
        html: fillNpsHtml(body, npsFigures),
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
        return {
          subject: fillCollections(subject, figures),
          body: fillCollections(body, figures),
          html: fillCollectionsHtml(body, figures),
        };
      })();

  try {
    await draftAs({
      from: me,
      fromName: null,
      to: me,
      subject: `[test] ${rendered.subject}`,
      // A test that arrives as plain text would not be showing the thing being
      // tested -- the formatting is most of what there is to check.
      body: rendered.body,
      html: rendered.html,
    });
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Could not draft it." };
  }

  return { success: true, error: undefined };
}

/*
 * Retiring a sequence.
 *
 * Two doors, because a sequence that has sent mail is not the same object as
 * one that never did. sequence_actions is the record of what went to which
 * client, and it hangs off the run, which hangs off the sequence -- so deleting
 * a sequence that has sent anything takes the only record of those sends with
 * it. That is not a delete, it is a quiet rewriting of what we told people.
 *
 * So: archive keeps everything and takes it out of circulation, which is what
 * is wanted nine times in ten. Delete is for the ones that never sent -- the
 * test, the false start, the one named "t" -- and refuses the moment there is
 * history to lose.
 *
 * Neither touches a process sequence. Collections and NPS rows are live
 * configuration their own screens read for draft-or-send, and removing one
 * would break a screen nobody was looking at.
 */
async function sequenceForRemoval(slug: string) {
  const db = createServiceClient();
  const { data } = await db
    .from("sequences")
    .select("id,name,kind,active,owner_member_id")
    .eq("slug", slug)
    .maybeSingle();
  return (data ?? null) as
    | { id: string; name: string; kind: string; active: boolean; owner_member_id: string | null }
    | null;
}

/** How much history a sequence is carrying, so the screen can say so. */
export async function sequenceFootprint(
  slug: string,
): Promise<{ sent: number; enrolled: number; kind: string; active: boolean }> {
  if (!(await mayEdit(slug))) return { sent: 0, enrolled: 0, kind: "campaign", active: true };
  const seq = await sequenceForRemoval(slug);
  if (!seq) return { sent: 0, enrolled: 0, kind: "campaign", active: true };

  const db = createServiceClient();
  const [{ count: enrolled }, { data: runs }] = await Promise.all([
    db.from("sequence_audience").select("id", { count: "exact", head: true }).eq("sequence_id", seq.id),
    db.from("sequence_runs").select("id").eq("sequence_id", seq.id),
  ]);

  const runIds = ((runs ?? []) as { id: string }[]).map((r) => r.id);
  let sent = 0;
  if (runIds.length > 0) {
    const { count } = await db
      .from("sequence_actions")
      .select("id", { count: "exact", head: true })
      .in("run_id", runIds);
    sent = count ?? 0;
  }

  return { sent, enrolled: enrolled ?? 0, kind: seq.kind, active: seq.active };
}

/** Out of circulation, everything kept. Nothing new comes due on it. */
export async function setSequenceArchived(
  slug: string,
  archived: boolean,
): Promise<{ success: boolean; error?: string }> {
  if (!(await mayEdit(slug))) return { success: false, error: "Not permitted." };
  const seq = await sequenceForRemoval(slug);
  if (!seq) return { success: false, error: "That sequence no longer exists." };
  if (seq.kind === "process") {
    return { success: false, error: "Collections and NPS are run by the app and cannot be archived here." };
  }

  const { error } = await createServiceClient()
    .from("sequences")
    .update({ active: !archived })
    .eq("id", seq.id);
  if (error) return { success: false, error: error.message };

  revalidatePath("/settings/sequences");
  revalidatePath(`/settings/sequences/${slug}`);
  return { success: true };
}

/** Gone entirely, and only ever for one that never sent. */
export async function deleteSequence(slug: string): Promise<{ success: boolean; error?: string }> {
  if (!(await mayEdit(slug))) return { success: false, error: "Not permitted." };
  const seq = await sequenceForRemoval(slug);
  if (!seq) return { success: false, error: "That sequence no longer exists." };
  if (seq.kind === "process") {
    return { success: false, error: "Collections and NPS are run by the app and cannot be deleted." };
  }

  const { sent } = await sequenceFootprint(slug);
  if (sent > 0) {
    return {
      success: false,
      error:
        `“${seq.name}” has sent ${sent} email${sent === 1 ? "" : "s"}, and deleting it would ` +
        `take the record of them with it. Archive it instead.`,
    };
  }

  const { error } = await createServiceClient().from("sequences").delete().eq("id", seq.id);
  if (error) return { success: false, error: error.message };

  revalidatePath("/settings/sequences");
  return { success: true };
}
