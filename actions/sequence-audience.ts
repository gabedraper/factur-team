"use server";

import { revalidatePath } from "next/cache";
import { draftAs, sendAs } from "@/lib/google/compose";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { myPermissions } from "@/lib/org";
import { fill, type Candidate } from "@/lib/sequences/audience";

/*
 * Putting people into a sequence, and sending to them.
 *
 * Built on the engine that already exists -- sequences, sequence_steps,
 * sequence_runs, sequence_actions -- rather than beside it. That engine already
 * does ladders, offsets, per-writer wording and a queue; what it had no way to
 * express was a person who is not a client, and it had no send path at all.
 *
 * Kept in its own file rather than added to actions/sequences.ts, which is
 * being worked on elsewhere. Authoring lives there; audience and sending live
 * here.
 */

export type SequenceRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  mode: "semi" | "full";
  visibility: "shared" | "private";
  ownerName: string | null;
  mine: boolean;
  activeSteps: number;
  enrolled: number;
};

export type AudienceRow = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  clientName: string | null;
  source: string;
  enrolled: boolean;
};

async function mayRun(): Promise<boolean> {
  const perms = await myPermissions();
  return perms.has("sequences.send") || perms.has("org.manage");
}

async function me(): Promise<{ email: string; name: string | null; memberId: string | null }> {
  const { data } = await (await createClient()).auth.getUser();
  const email = data.user?.email ?? "";
  const { data: member } = await createServiceClient()
    .from("org_members")
    .select("id,full_name")
    .eq("email", email)
    .maybeSingle();
  const m = member as { id: string; full_name: string | null } | null;
  return { email, name: m?.full_name ?? null, memberId: m?.id ?? null };
}

/** Shared sequences, and the ones belonging to whoever is asking. */
export async function listSequences(): Promise<SequenceRow[]> {
  if (!(await mayRun())) return [];
  const who = await me();
  const db = createServiceClient();

  const { data } = await db
    .from("sequences")
    .select("id,slug,name,description,mode,visibility,owner_member_id,active,org_members(full_name)")
    .eq("active", true)
    .order("name");

  const rows = (data ?? []) as unknown as {
    id: string; slug: string; name: string; description: string | null;
    mode: "semi" | "full"; visibility: "shared" | "private";
    owner_member_id: string | null;
    org_members: { full_name: string | null } | null;
  }[];

  const [{ data: steps }, { data: runs }] = await Promise.all([
    db.from("sequence_steps").select("sequence_id,active"),
    db.from("sequence_runs").select("sequence_id,ended_at"),
  ]);

  const activeSteps = new Map<string, number>();
  for (const s of (steps ?? []) as { sequence_id: string; active: boolean }[]) {
    if (s.active) activeSteps.set(s.sequence_id, (activeSteps.get(s.sequence_id) ?? 0) + 1);
  }
  const enrolled = new Map<string, number>();
  for (const r of (runs ?? []) as { sequence_id: string; ended_at: string | null }[]) {
    if (!r.ended_at) enrolled.set(r.sequence_id, (enrolled.get(r.sequence_id) ?? 0) + 1);
  }

  return rows
    // A private sequence is nobody's business but its owner's.
    .filter((r) => r.visibility === "shared" || r.owner_member_id === who.memberId)
    .map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      description: r.description,
      mode: r.mode,
      visibility: r.visibility,
      ownerName: r.org_members?.full_name ?? null,
      mine: r.owner_member_id === who.memberId,
      activeSteps: activeSteps.get(r.id) ?? 0,
      enrolled: enrolled.get(r.id) ?? 0,
    }));
}

/** Contacts already in the app, offered as candidates for a sequence. */
export async function contactCandidates(): Promise<Candidate[]> {
  if (!(await mayRun())) return [];

  const { data } = await createServiceClient()
    .from("client_contact_current")
    .select("email,first_name,last_name,client_id,org_clients(name)")
    .order("email");

  return ((data ?? []) as unknown as {
    email: string; first_name: string | null; last_name: string | null;
    client_id: string; org_clients: { name: string } | null;
  }[]).map((c) => ({
    email: c.email,
    firstName: c.first_name,
    lastName: c.last_name,
    company: c.org_clients?.name ?? null,
    clientId: c.client_id,
    problem: null,
  }));
}

/**
 * Add people to a sequence and start them on it.
 *
 * One call rather than "add" then "enrol", because a person added and not
 * enrolled is a row that does nothing and confuses the next reader. Adding is
 * idempotent on the address, so re-uploading the same CSV enrols nobody twice.
 */
export async function addToSequence(
  slug: string,
  people: Candidate[]
): Promise<{ success: boolean; error?: string; added?: number; alreadyIn?: number }> {
  if (!(await mayRun())) return { success: false, error: "Not permitted." };

  const wanted = people.filter((p) => !p.problem && p.email.trim());
  if (wanted.length === 0) return { success: false, error: "Nobody selected." };

  const db = createServiceClient();
  const who = await me();

  const { data: seq } = await db
    .from("sequences").select("id").eq("slug", slug).maybeSingle();
  const sequenceId = (seq as { id: string } | null)?.id;
  if (!sequenceId) return { success: false, error: "That sequence no longer exists." };

  const { data: inserted, error } = await db
    .from("sequence_audience")
    .upsert(
      wanted.map((p) => ({
        sequence_id: sequenceId,
        email: p.email.trim().toLowerCase(),
        first_name: p.firstName,
        last_name: p.lastName,
        company: p.company,
        client_id: p.clientId,
        source: p.clientId ? "contacts" : "csv",
        added_by: who.email,
      })),
      { onConflict: "sequence_id,email", ignoreDuplicates: true }
    )
    .select("id,email,client_id");

  if (error) return { success: false, error: error.message };

  const rows = (inserted ?? []) as { id: string; email: string; client_id: string | null }[];

  /*
   * The sender is decided now and frozen onto the run, the same way the NPS
   * survey freezes it: whoever presses send later should not silently change
   * who a half-finished sequence appears to come from.
   */
  const runs = rows.map((r) => ({
    sequence_id: sequenceId,
    subject_type: "audience",
    subject_id: r.id,
    send_as: who.email,
    context: { email: r.email, added_by: who.email },
  }));

  if (runs.length > 0) {
    const { error: runError } = await db
      .from("sequence_runs")
      .insert(runs);
    if (runError) return { success: false, error: runError.message };
  }

  revalidatePath(`/sequences/${slug}`);
  return {
    success: true,
    added: rows.length,
    alreadyIn: wanted.length - rows.length,
  };
}

export async function sequenceAudience(slug: string): Promise<AudienceRow[]> {
  if (!(await mayRun())) return [];
  const db = createServiceClient();

  const { data: seq } = await db
    .from("sequences").select("id").eq("slug", slug).maybeSingle();
  const sequenceId = (seq as { id: string } | null)?.id;
  if (!sequenceId) return [];

  const [{ data: audience }, { data: runs }] = await Promise.all([
    db.from("sequence_audience")
      .select("id,email,first_name,last_name,company,source,org_clients(name)")
      .eq("sequence_id", sequenceId)
      .order("added_at", { ascending: false }),
    db.from("sequence_runs")
      .select("subject_id,ended_at")
      .eq("sequence_id", sequenceId)
      .eq("subject_type", "audience"),
  ]);

  const live = new Set(
    ((runs ?? []) as { subject_id: string; ended_at: string | null }[])
      .filter((r) => !r.ended_at)
      .map((r) => r.subject_id)
  );

  return ((audience ?? []) as unknown as {
    id: string; email: string; first_name: string | null; last_name: string | null;
    company: string | null; source: string; org_clients: { name: string } | null;
  }[]).map((a) => ({
    id: a.id,
    email: a.email,
    firstName: a.first_name,
    lastName: a.last_name,
    company: a.company,
    clientName: a.org_clients?.name ?? null,
    source: a.source,
    enrolled: live.has(a.id),
  }));
}

type QueueRow = {
  run_id: string;
  subject_type: string;
  subject_id: string;
  send_as: string | null;
  context: Record<string, unknown>;
  step_id: string;
  step_position: number;
  channel: string;
  config: { subject?: string; body?: string };
};

/**
 * Work everything currently due on a sequence, in one go.
 *
 * `mode` is the button that was pressed rather than the sequence's setting:
 * "Send to all" means send, "leave drafts in my inbox" means put every one of
 * them in the operator's own mailbox to look over. The second is the safe way
 * to see what a hundred emails actually look like before any of them move.
 *
 * Each message is recorded before the next is attempted, so a run that dies
 * halfway has told the truth about what already went.
 */
export async function workSequence(
  slug: string,
  mode: "send" | "draft-to-me"
): Promise<{ success: boolean; error?: string; done?: number; failed?: number }> {
  if (!(await mayRun())) return { success: false, error: "Not permitted." };

  const db = createServiceClient();
  const supabase = await createClient();
  const who = await me();

  const { data, error } = await supabase.rpc("get_sequence_queue", { p_slug: slug });
  if (error) return { success: false, error: error.message };

  const queue = ((data ?? []) as QueueRow[]).filter(
    (q) => q.subject_type === "audience" && q.channel === "email"
  );
  if (queue.length === 0) return { success: true, done: 0, failed: 0 };

  const { data: audience } = await db
    .from("sequence_audience")
    .select("id,email,first_name,last_name,company")
    .in("id", queue.map((q) => q.subject_id));

  const people = new Map(
    ((audience ?? []) as {
      id: string; email: string; first_name: string | null;
      last_name: string | null; company: string | null;
    }[]).map((a) => [a.id, a])
  );

  let done = 0;
  let failed = 0;

  for (const item of queue) {
    const person = people.get(item.subject_id);
    if (!person) { failed++; continue; }

    const shape = {
      firstName: person.first_name,
      lastName: person.last_name,
      company: person.company,
    };
    const from = mode === "draft-to-me" ? who.email : item.send_as ?? who.email;
    const subject = fill(item.config.subject ?? "", shape, who.name);
    const body = fill(item.config.body ?? "", shape, who.name);

    if (!subject.trim() || !body.trim()) { failed++; continue; }

    try {
      const placed =
        mode === "send"
          ? await sendAs({ from, fromName: who.name, to: person.email, subject, body })
          : await draftAs({ from, fromName: who.name, to: who.email, subject, body });

      /*
       * Only a real send counts as having worked the step. A draft into the
       * operator's own inbox is a preview -- recording it would mark the step
       * done and the client would never hear from us.
       */
      if (mode === "send") {
        await db.from("sequence_actions").insert({
          run_id: item.run_id,
          step_id: item.step_id,
          step_position: item.step_position,
          channel: "email",
          recipient: person.email,
          sender: from,
          rendered: { subject, body },
          mode: "full",
          rfc_message_id: placed.rfcMessageId,
          external_ids: placed.draftId ? { gmail_draft_id: placed.draftId } : {},
          acted_by: who.email,
        });
      }
      done++;
    } catch {
      failed++;
    }
  }

  revalidatePath(`/sequences/${slug}`);
  return { success: true, done, failed };
}
