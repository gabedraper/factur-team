"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { myPermissions } from "@/lib/org";
import { fill, type Figures } from "@/lib/collections/render";
import { draftAs, sendAs } from "@/lib/google/compose";

export type QueueRow = {
  client_id: string;
  client_name: string;
  qb_customer: string;
  to_email: string | null;
  contact_first_name: string | null;
  payment_terms: string | null;
  days_past_due: number;
  overdue_since: string | null;
  past_due_total: number | null;
  open_balance: number | null;
  oldest_invoice_no: string | null;
  invoice_lines: string | null;
  step_id: string;
  step_position: number;
  step_days: number;
  subject: string;
  body: string;
  last_sent_at: string | null;
  last_step_position: number | null;
  paused_until: string | null;
  paused_reason: string | null;
};

/** A queue row with the template already filled in, ready to read. */
export type Chase = QueueRow & { rendered_subject: string; rendered_body: string };

export type Step = {
  id: string;
  position: number;
  days_past_due: number;
  subject: string;
  body: string;
  active: boolean;
};

export type Settings = { mode: "semi" | "full"; send_as: string };

async function mayRun() {
  const perms = await myPermissions();
  return perms.has("finance.collections") || perms.has("org.manage");
}

async function whoAmI(): Promise<string | null> {
  const {
    data: { user },
  } = await (await createClient()).auth.getUser();
  return user?.email ?? null;
}

export async function getCollectionsSettings(): Promise<Settings> {
  const { data } = await createServiceClient()
    .from("collections_settings")
    .select("mode,send_as")
    .maybeSingle();
  return (data as Settings | null) ?? { mode: "semi", send_as: "" };
}

/** The name the emails are signed with, taken from the org rather than typed. */
async function senderName(sendAs: string): Promise<string> {
  const { data } = await createServiceClient()
    .from("org_members")
    .select("full_name")
    .eq("email", sendAs)
    .maybeSingle();
  return ((data as { full_name: string | null } | null)?.full_name ?? sendAs).trim();
}

function figuresFor(row: QueueRow, sender: string): Figures {
  return {
    client_name: row.client_name,
    contact_first_name: row.contact_first_name,
    payment_terms: row.payment_terms,
    days_past_due: row.days_past_due,
    past_due_total: row.past_due_total,
    open_balance: row.open_balance,
    oldest_invoice_no: row.oldest_invoice_no,
    invoice_lines: row.invoice_lines,
    sender_name: sender,
  };
}

/**
 * Everyone due a chase today, with the wording already worked out.
 *
 * The arrears clock is brought up to date first. It is also refreshed hourly by
 * a scheduled job, but a client who paid an hour ago should not be looking back
 * at whoever opens this screen.
 */
export async function getCollectionsQueue(): Promise<Chase[]> {
  if (!(await mayRun())) return [];

  const service = createServiceClient();
  await service.rpc("refresh_collections_state");

  // Their own connection: the function checks the caller's permissions.
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_collections_queue");
  if (error) throw new Error(`collections queue failed: ${error.message}`);

  const settings = await getCollectionsSettings();
  const sender = await senderName(settings.send_as);

  return ((data ?? []) as QueueRow[]).map((row) => ({
    ...row,
    rendered_subject: fill(row.subject, figuresFor(row, sender)),
    rendered_body: fill(row.body, figuresFor(row, sender)),
  }));
}

export async function getSteps(): Promise<Step[]> {
  if (!(await mayRun())) return [];
  const { data } = await createServiceClient()
    .from("collections_steps")
    .select("id,position,days_past_due,subject,body,active")
    .order("position");
  return (data ?? []) as Step[];
}

export async function saveStep(step: {
  id?: string;
  position: number;
  days_past_due: number;
  subject: string;
  body: string;
  active: boolean;
}) {
  if (!(await mayRun())) return { success: false, error: "Not permitted." };
  if (!step.subject.trim() || !step.body.trim()) {
    return { success: false, error: "A step needs a subject and a body." };
  }

  const row = {
    position: step.position,
    days_past_due: step.days_past_due,
    subject: step.subject.trim(),
    body: step.body,
    active: step.active,
    updated_at: new Date().toISOString(),
    updated_by: await whoAmI(),
  };

  const db = createServiceClient();
  const { error } = step.id
    ? await db.from("collections_steps").update(row).eq("id", step.id)
    : await db.from("collections_steps").insert(row);

  if (error) return { success: false, error: error.message };
  revalidatePath("/settings/collections");
  revalidatePath("/collections");
  return { success: true };
}

export async function deleteStep(id: string) {
  if (!(await mayRun())) return { success: false, error: "Not permitted." };
  const { error } = await createServiceClient()
    .from("collections_steps").delete().eq("id", id);
  if (error) return { success: false, error: error.message };
  revalidatePath("/settings/collections");
  revalidatePath("/collections");
  return { success: true };
}

export async function setMode(mode: "semi" | "full") {
  if (!(await mayRun())) return { success: false, error: "Not permitted." };
  const { error } = await createServiceClient()
    .from("collections_settings")
    .update({ mode, updated_at: new Date().toISOString(), updated_by: await whoAmI() })
    .eq("id", true);
  if (error) return { success: false, error: error.message };
  revalidatePath("/settings/collections");
  revalidatePath("/collections");
  return { success: true };
}

/** Stop chasing one client, with the reason kept beside it. */
export async function pauseClient(clientId: string, until: string | null, reason: string) {
  if (!(await mayRun())) return { success: false, error: "Not permitted." };
  const { error } = await createServiceClient()
    .from("collections_client_state")
    .upsert(
      {
        client_id: clientId,
        paused_until: until,
        paused_reason: until ? reason.trim() || null : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "client_id" }
    );
  if (error) return { success: false, error: error.message };
  revalidatePath("/collections");
  return { success: true };
}

/**
 * Put one chase in front of the customer.
 *
 * The wording can be edited before it goes -- that is the whole point of a
 * person reading it -- but the recipient and the fact that this step is due are
 * both taken from the queue on the server. Otherwise the screen would be a way
 * to send mail from Brenolene's mailbox to any address at all, which is not
 * what anyone asked for.
 */
export async function placeChase(
  clientId: string,
  stepId: string,
  subject: string,
  body: string
): Promise<{ success: boolean; error?: string; mode?: "semi" | "full" }> {
  if (!(await mayRun())) return { success: false, error: "Not permitted." };
  if (!subject.trim() || !body.trim()) {
    return { success: false, error: "Nothing to send." };
  }

  const queue = await getCollectionsQueue();
  const row = queue.find((q) => q.client_id === clientId && q.step_id === stepId);
  if (!row) {
    return { success: false, error: "That chase is no longer due — the queue has moved on." };
  }
  if (row.paused_until && new Date(row.paused_until) >= new Date()) {
    return { success: false, error: `${row.client_name} is paused until ${row.paused_until}.` };
  }
  if (!row.to_email) {
    return { success: false, error: `QuickBooks holds no billing email for ${row.client_name}.` };
  }

  const settings = await getCollectionsSettings();
  const sender = await senderName(settings.send_as);

  const outgoing = {
    from: settings.send_as,
    fromName: sender,
    to: row.to_email,
    subject: subject.trim(),
    body,
  };

  let placed;
  try {
    placed = settings.mode === "full" ? await sendAs(outgoing) : await draftAs(outgoing);
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Gmail refused it." };
  }

  const { error } = await createServiceClient().from("collections_sent").insert({
    client_id: clientId,
    step_id: stepId,
    step_position: row.step_position,
    days_past_due: row.days_past_due,
    past_due_total: row.past_due_total,
    to_email: row.to_email,
    subject: outgoing.subject,
    body,
    mode: settings.mode,
    gmail_draft_id: placed.draftId,
    rfc_message_id: placed.rfcMessageId,
    sent_by: await whoAmI(),
  });

  /*
   * The mail is already in her mailbox by this point. Failing to write the log
   * afterwards must not read as "nothing happened", or the same chase goes out
   * twice.
   */
  if (error) {
    return {
      success: false,
      error:
        `The email was ${settings.mode === "full" ? "sent" : "drafted"}, but recording it ` +
        `failed: ${error.message}. Do not send it again before checking her mailbox.`,
    };
  }

  revalidatePath("/collections");
  revalidatePath(`/clients/${clientId}`);
  return { success: true, mode: settings.mode };
}
