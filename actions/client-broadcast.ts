"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { myPermissions } from "@/lib/org";
import { draftAs, sendAs } from "@/lib/google/compose";
import { fill } from "@/lib/sequences/audience";
import { previewClientRecipients } from "@/actions/client-outreach";
import type { Role } from "@/lib/client-contacts";

/*
 * One email to the clients somebody picked off a list.
 *
 * Built as a sequence with a single step rather than as its own send path. A
 * one-off announcement is genuinely a sequence of one message sent today, and
 * modelling it that way means it shares the queue, the Gmail chokepoint, the
 * send log and the "what did we ever send this client" history with everything
 * else. A second send path would be a second set of all of those, and the
 * second set is always the one that misses a check.
 *
 * The sequence is created private and owned, so a month of announcements does
 * not pile up in everybody's shared list.
 *
 * Nothing is written until the send begins. Checking the recipients used to
 * create the sequence and enrol everybody first, which made the review screen a
 * commitment rather than a review: going back had to undo real rows, and every
 * abandoned draft left a sequence and an audience behind. startBroadcast is now
 * called by the send itself.
 *
 * Sending is batched, and that is not a detail. The engine's own send loop does
 * every due message in one server action; at two hundred recipients and a Gmail
 * round trip each, that runs past the request timeout and nobody can tell how
 * far it got. Here the browser asks for twenty at a time and each answer says
 * what is left, so a long send shows progress and a failure halfway is visible
 * rather than silent.
 *
 * Plain text, deliberately. The engine renders a step with one renderer, and
 * storing HTML in the body would send raw markup to anybody who later worked
 * the same sequence from the sequences page. Rich text belongs here eventually,
 * but it has to arrive in the engine and here together.
 */

const BATCH = 20;

type QueueRow = {
  run_id: string;
  subject_type: string;
  subject_id: string;
  send_as: string | null;
  step_id: string;
  step_position: number;
  channel: string;
  config: { subject?: string; body?: string };
};

async function mayBroadcast() {
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

/** Readable, and unique without a round trip to check. */
function slugFor(name: string): string {
  const stem =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "announcement";
  const stamp = new Date().toISOString().slice(0, 10);
  const tail = Math.random().toString(36).slice(2, 8);
  return `${stem}-${stamp}-${tail}`;
}

export type BroadcastStart = {
  success: boolean;
  error?: string;
  slug?: string;
  /**
   * Who it will actually go to, as enrolled. Returned rather than counted so
   * the screen can name them: the addresses are resolved again in here, and a
   * list the server wrote down is worth more than the one the browser guessed
   * a minute earlier.
   */
  queued?: { clientName: string; email: string }[];
  missed?: number;
};

/**
 * Write the announcement down and line up who it goes to. Nothing is sent.
 *
 * Separated from sending so the recipients are fixed before the first message
 * leaves: a send that pages through the queue while somebody edits the list
 * underneath it is a send nobody can describe afterwards.
 */
export async function startBroadcast(input: {
  name: string;
  subject: string;
  body: string;
  clientIds: string[];
  roles: Role[];
}): Promise<BroadcastStart> {
  if (!(await mayBroadcast())) return { success: false, error: "Not permitted." };

  const name = input.name.trim();
  const subject = input.subject.trim();
  const body = input.body.trim();
  if (!name) return { success: false, error: "Give it a name so you can find it later." };
  if (!subject) return { success: false, error: "The email needs a subject." };
  if (!body) return { success: false, error: "The email has no message in it." };

  const preview = await previewClientRecipients(input.clientIds, input.roles);
  if (preview.error) return { success: false, error: preview.error };
  if (preview.recipients.length === 0) {
    return { success: false, error: "None of those clients has an address on file." };
  }

  const db = createServiceClient();
  const who = await me();
  if (!who.memberId) return { success: false, error: "No member record for you." };

  const slug = slugFor(name);

  const { data: seq, error: seqError } = await db
    .from("sequences")
    .insert({
      slug,
      name,
      description: `One-off email to ${preview.recipients.length} client contacts.`,
      mode: "semi",
      kind: "one_off",
      visibility: "private",
      owner_member_id: who.memberId,
      ends_on: ["manual"],
    })
    .select("id")
    .maybeSingle();

  if (seqError || !seq) {
    return { success: false, error: seqError?.message ?? "Could not create the email." };
  }
  const sequenceId = (seq as { id: string }).id;

  const { error: stepError } = await db.from("sequence_steps").insert({
    sequence_id: sequenceId,
    position: 1,
    offset_days: 0,
    channel: "email",
    config: { subject, body },
    active: true,
    updated_by: who.email,
  });
  if (stepError) return { success: false, error: stepError.message };

  /*
   * Enrolled here rather than through addToSequence because this sequence is
   * new: every address is a first, there is nothing to collide with, and the
   * runs can be opened in the same breath.
   */
  const { data: added, error: audienceError } = await db
    .from("sequence_audience")
    .insert(
      preview.recipients.map((r) => ({
        sequence_id: sequenceId,
        email: r.email,
        first_name: r.name ? r.name.split(" ")[0] : null,
        last_name: r.name && r.name.includes(" ") ? r.name.split(" ").slice(1).join(" ") : null,
        company: r.clientName,
        client_id: r.clientId,
        source: "contacts",
        added_by: who.email,
      })),
    )
    .select("id,email");
  if (audienceError) return { success: false, error: audienceError.message };

  const rows = (added ?? []) as { id: string; email: string }[];
  const companyOf = new Map(preview.recipients.map((r) => [r.email, r.clientName]));
  const { error: runError } = await db.from("sequence_runs").insert(
    rows.map((r) => ({
      sequence_id: sequenceId,
      subject_type: "audience",
      subject_id: r.id,
      send_as: who.email,
      context: { email: r.email, added_by: who.email },
    })),
  );
  if (runError) return { success: false, error: runError.message };

  return {
    success: true,
    slug,
    queued: rows.map((r) => ({ clientName: companyOf.get(r.email) ?? "", email: r.email })),
    missed: preview.unreachable.length,
  };
}

/**
 * Draft one copy to yourself, from what is currently typed.
 *
 * Deliberately needs nothing written down first. It renders against the first
 * real recipient so the merge fields show what a client will see, and it goes
 * to your own mailbox and nowhere else -- the recipient is not a parameter,
 * which is what makes it safe to call from a form that has not been committed
 * to anything yet.
 */
export async function draftBroadcastPreview(input: {
  subject: string;
  body: string;
  clientIds: string[];
  roles: Role[];
}): Promise<{ success: boolean; error?: string }> {
  if (!(await mayBroadcast())) return { success: false, error: "Not permitted." };

  const subject = input.subject.trim();
  const body = input.body.trim();
  if (!subject || !body) return { success: false, error: "Write a subject and a message first." };

  const preview = await previewClientRecipients(input.clientIds, input.roles);
  if (preview.error) return { success: false, error: preview.error };
  const first = preview.recipients[0];
  if (!first) return { success: false, error: "None of those clients has an address on file." };

  const who = await me();
  const shape = {
    firstName: first.name ? first.name.split(" ")[0] : null,
    lastName: first.name && first.name.includes(" ") ? first.name.split(" ").slice(1).join(" ") : null,
    company: first.clientName,
  };

  try {
    await draftAs({
      from: who.email,
      fromName: who.name,
      to: who.email,
      subject: `[Preview — ${first.clientName}] ${fill(subject, shape, who.name)}`,
      body: fill(body, shape, who.name),
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Could not draft it." };
  }
}

export type BroadcastBatch = {
  success: boolean;
  error?: string;
  done?: number;
  failed?: number;
  /** Still waiting after this batch, so the browser knows to come back. */
  remaining?: number;
};

/**
 * Send the next handful.
 *
 * Only real sends come through here, and every one is recorded before the next
 * is attempted, so a run that dies halfway has told the truth about what
 * already went. Rehearsals are draftBroadcastPreview, which writes nothing.
 */
export async function sendBroadcastBatch(
  slug: string,
  limit = BATCH,
): Promise<BroadcastBatch> {
  if (!(await mayBroadcast())) return { success: false, error: "Not permitted." };

  const db = createServiceClient();
  const supabase = await createClient();
  const who = await me();

  const { data, error } = await supabase.rpc("get_sequence_queue", { p_slug: slug });
  if (error) return { success: false, error: error.message };

  const queue = ((data ?? []) as QueueRow[]).filter(
    (q) => q.subject_type === "audience" && q.channel === "email",
  );
  if (queue.length === 0) return { success: true, done: 0, failed: 0, remaining: 0 };

  const batch = queue.slice(0, limit);

  const { data: audience } = await db
    .from("sequence_audience")
    .select("id,email,first_name,last_name,company")
    .in("id", batch.map((q) => q.subject_id));

  const people = new Map(
    ((audience ?? []) as {
      id: string; email: string; first_name: string | null;
      last_name: string | null; company: string | null;
    }[]).map((a) => [a.id, a]),
  );

  let done = 0;
  let failed = 0;

  for (const item of batch) {
    const person = people.get(item.subject_id);
    if (!person) { failed++; continue; }

    const shape = {
      firstName: person.first_name,
      lastName: person.last_name,
      company: person.company,
    };
    const subject = fill(item.config.subject ?? "", shape, who.name);
    const body = fill(item.config.body ?? "", shape, who.name);
    if (!subject.trim() || !body.trim()) { failed++; continue; }

    const from = item.send_as ?? who.email;

    try {
      const placed = await sendAs({ from, fromName: who.name, to: person.email, subject, body });

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
      done++;
    } catch {
      failed++;
    }
  }

  revalidatePath(`/sequences/${slug}`);
  return {
    success: true,
    done,
    failed,
    remaining: Math.max(queue.length - done, 0),
  };
}
