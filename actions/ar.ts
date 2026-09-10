"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { myPermissions } from "@/lib/org";
import { fill, fillHtml, type Figures } from "@/lib/ar/render";
import { htmlToText } from "@/lib/email/richtext";
import { draftAs, sendAs, type Attachment } from "@/lib/google/compose";
import { buildStatement } from "@/lib/ar/statement-pdf";
import { getCollectionsSettings } from "@/actions/collections";

export type ArRow = {
  qb_invoice_id: number;
  invoice_no: string;
  client_id: string;
  client_name: string;
  qb_customer_id: string;
  qb_customer_name: string;
  due_date: string;
  age_days: number;
  invoice_balance: number;
  account_total: number | null;
  autopay: boolean;
  interest_rate: string | null;
  to_email: string | null;
  cc_emails: string | null;
  contact_first_name: string | null;
  payment_terms: string | null;
  pay_link: string | null;
  step_id: string;
  step_position: number;
  step_code: string;
  step_name: string;
  step_offset: number;
  subject: string;
  body: string;
  internal_to: string[] | null;
  internal_subject: string | null;
  internal_body: string | null;
  last_sent_at: string | null;
  last_step_position: number | null;
  /** Null means it can go. Anything else is the reason it cannot. */
  blocked: string | null;
};

export type ArChase = ArRow & {
  account_manager: string | null;
  team_lead: string | null;
  rendered_subject: string;
  rendered_body: string;
};

export type ArStep = {
  id: string;
  position: number;
  code: string;
  name: string;
  offset_days: number;
  subject: string;
  body: string;
  cc_roles: string[];
  skip_when_autopay: boolean;
  internal_to: string[] | null;
  internal_subject: string | null;
  internal_body: string | null;
  active: boolean;
};

export type ArSettings = {
  start_from: string;
  grace_days: number;
  stale_hours: number;
  data_age_minutes: number | null;
};

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

async function senderName(sendAs: string): Promise<string> {
  const { data } = await createServiceClient()
    .from("org_members")
    .select("full_name")
    .eq("email", sendAs)
    .maybeSingle();
  return ((data as { full_name: string | null } | null)?.full_name ?? sendAs).trim();
}

export async function getArSettings(): Promise<ArSettings> {
  const db = createServiceClient();
  const [{ data }, { data: age }] = await Promise.all([
    db.from("ar_settings").select("start_from,grace_days,stale_hours").maybeSingle(),
    db.rpc("qb_data_age_minutes"),
  ]);
  const row = data as { start_from: string; grace_days: number; stale_hours: number } | null;
  return {
    start_from: row?.start_from ?? new Date().toISOString().slice(0, 10),
    grace_days: row?.grace_days ?? 3,
    stale_hours: row?.stale_hours ?? 6,
    data_age_minutes: (age as number | null) ?? null,
  };
}

export async function getArSteps(): Promise<ArStep[]> {
  if (!(await mayRun())) return [];
  const { data } = await createServiceClient()
    .from("ar_steps")
    .select("*")
    .order("position");
  return (data ?? []) as ArStep[];
}

/**
 * The names behind the roles, for the templates that address them in prose.
 *
 * The queue hands back the account manager's address because that is what the
 * copy line needs; "[Account Manager] will be in touch" needs the person's
 * name. Looked up here rather than in the queue so the shape of the returned
 * row stays about the invoice.
 */
async function teamNames(clientIds: string[]) {
  const map = new Map<string, { am: string | null; tl: string | null }>();
  if (clientIds.length === 0) return map;

  const db = createServiceClient();
  const { data: clients } = await db
    .from("org_clients")
    .select("id,account_manager_id,team_lead_id")
    .in("id", clientIds);

  const rows = (clients ?? []) as {
    id: string; account_manager_id: string | null; team_lead_id: string | null;
  }[];

  const memberIds = [
    ...new Set(rows.flatMap((r) => [r.account_manager_id, r.team_lead_id]).filter(Boolean)),
  ] as string[];

  const { data: members } = memberIds.length
    ? await db.from("org_members").select("id,full_name,email").in("id", memberIds)
    : { data: [] };

  const names = new Map(
    ((members ?? []) as { id: string; full_name: string | null; email: string }[])
      .map((m) => [m.id, (m.full_name ?? m.email).trim()])
  );

  for (const r of rows) {
    map.set(r.id, {
      am: r.account_manager_id ? names.get(r.account_manager_id) ?? null : null,
      tl: r.team_lead_id ? names.get(r.team_lead_id) ?? null : null,
    });
  }
  return map;
}

function figuresFor(row: ArRow, am: string | null, tl: string | null, sender: string): Figures {
  return {
    client_name: row.client_name,
    contact_first_name: row.contact_first_name,
    invoice_no: row.invoice_no,
    invoice_balance: row.invoice_balance,
    account_total: row.account_total,
    due_date: row.due_date,
    age_days: row.age_days,
    payment_terms: row.payment_terms,
    pay_link: row.pay_link,
    interest_rate: row.interest_rate,
    autopay: row.autopay,
    account_manager: am,
    team_lead: tl,
    sender_name: sender,
  };
}

/** Every invoice standing on a rung today, wording filled in. */
export async function getArQueue(): Promise<ArChase[]> {
  if (!(await mayRun())) return [];

  await createServiceClient().rpc("note_staging_sync");

  // Their own connection: the function checks the caller's permissions.
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_ar_queue");
  if (error) throw new Error(`A/R queue failed: ${error.message}`);

  const rows = (data ?? []) as ArRow[];
  const settings = await getCollectionsSettings();
  const sender = await senderName(settings.send_as);
  const names = await teamNames([...new Set(rows.map((r) => r.client_id))]);

  return rows.map((row) => {
    const team = names.get(row.client_id) ?? { am: null, tl: null };
    const figures = figuresFor(row, team.am, team.tl, sender);
    return {
      ...row,
      account_manager: team.am,
      team_lead: team.tl,
      rendered_subject: fill(row.subject, figures),
      rendered_body: fillHtml(row.body, figures),
    };
  });
}

/**
 * The files a rung promises in its body.
 *
 * An email that says "attached is your full statement" with nothing attached
 * is worse than one that never mentioned it, so a promise we cannot keep is a
 * refusal to send rather than a send with the sentence quietly wrong.
 */
async function attachmentsFor(
  stepId: string,
  clientId: string
): Promise<{ files: Attachment[] } | { error: string }> {
  const { data } = await createServiceClient()
    .from("ar_steps").select("attachments").eq("id", stepId).maybeSingle();
  const wanted = ((data as { attachments: string[] } | null)?.attachments ?? []);
  if (wanted.length === 0) return { files: [] };

  const files: Attachment[] = [];

  if (wanted.includes("statement")) {
    const statement = await buildStatement(clientId);
    if (!statement) {
      return { error: "This step attaches a statement and there is nothing outstanding to put on one." };
    }
    if ("problem" in statement) return { error: statement.problem };
    files.push({
      filename: statement.filename,
      contentType: "application/pdf",
      content: statement.pdf,
    });
  }

  /*
   * The invoice PDF lives behind QuickBooks' accounting API, which we are not
   * connected to yet. Saying so is the point: this is the one rung that cannot
   * keep its promise, and it should not go out pretending otherwise.
   */
  if (wanted.includes("invoice")) {
    return {
      error: "This step attaches the invoice PDF, which needs the QuickBooks connection we do not have yet.",
    };
  }

  return { files };
}

/** A rehearsal, to the person asking, clearly marked so it cannot be confused. */
export async function draftArToMe(
  invoiceId: number,
  stepId: string
): Promise<{ success: boolean; error?: string; to?: string }> {
  if (!(await mayRun())) return { success: false, error: "Not permitted." };

  const me = await whoAmI();
  if (!me) return { success: false, error: "Not signed in." };

  const queue = await getArQueue();
  const row = queue.find((q) => q.qb_invoice_id === invoiceId && q.step_id === stepId);
  if (!row) return { success: false, error: "That step is no longer due." };

  const settings = await getCollectionsSettings();

  const attached = await attachmentsFor(stepId, row.client_id);
  if ("error" in attached) return { success: false, error: attached.error };

  try {
    await draftAs({
      from: settings.send_as,
      fromName: await senderName(settings.send_as),
      to: me,
      attachments: attached.files,
      // No copy on a rehearsal. An account manager learning a client is late
      // from a test would be worse than not being told at all.
      cc: null,
      subject: `[TEST — ${row.client_name}] ${row.rendered_subject}`,
      body: htmlToText(row.rendered_body),
      html: row.rendered_body,
    });
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Gmail refused it." };
  }

  return { success: true, to: me };
}

/**
 * Put one rung in front of the customer.
 *
 * The wording can be edited before it goes -- that is the point of a person
 * reading it -- but the recipient, the fact that this step is due, and whether
 * anything blocks it are all re-read from the queue on the server. The browser
 * gets to change the words and nothing else; otherwise this screen would be a
 * way to send mail from finance's mailbox to any address at all.
 */
export async function placeArStep(
  invoiceId: number,
  stepId: string,
  subject: string,
  body: string
): Promise<{ success: boolean; error?: string; mode?: "semi" | "full" }> {
  if (!(await mayRun())) return { success: false, error: "Not permitted." };
  if (!subject.trim() || !body.trim()) return { success: false, error: "Nothing to send." };

  const queue = await getArQueue();
  const row = queue.find((q) => q.qb_invoice_id === invoiceId && q.step_id === stepId);
  if (!row) {
    return { success: false, error: "That step is no longer due — the queue has moved on." };
  }
  /*
   * The block is re-checked here rather than trusted from the screen. Between
   * the page rendering and somebody clicking, a payment may have landed --
   * which is exactly the case this whole guard exists for.
   */
  if (row.blocked) return { success: false, error: row.blocked };
  if (!row.to_email) {
    return { success: false, error: `QuickBooks holds no billing email for ${row.client_name}.` };
  }

  const settings = await getCollectionsSettings();
  const sender = await senderName(settings.send_as);
  const automatic = settings.mode === "full";

  const attached = await attachmentsFor(stepId, row.client_id);
  if ("error" in attached) return { success: false, error: attached.error };

  const outgoing = {
    from: settings.send_as,
    fromName: sender,
    to: row.to_email,
    cc: row.cc_emails,
    subject: subject.trim(),
    body: htmlToText(body),
    html: body,
    attachments: attached.files,
  };

  let placed;
  try {
    placed = automatic ? await sendAs(outgoing) : await draftAs(outgoing);
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Gmail refused it." };
  }

  const db = createServiceClient();
  const { error } = await db.from("ar_sent").insert({
    qb_invoice_id: invoiceId,
    client_id: row.client_id,
    step_id: stepId,
    step_position: row.step_position,
    kind: "client",
    offset_days: row.age_days,
    invoice_no: row.invoice_no,
    invoice_balance: row.invoice_balance,
    account_total: row.account_total,
    to_email: row.to_email,
    cc_emails: row.cc_emails,
    subject: subject.trim(),
    body,
    mode: settings.mode,
    gmail_draft_id: placed?.draftId ?? null,
    rfc_message_id: placed?.rfcMessageId ?? null,
    sent_by: await whoAmI(),
  });
  if (error) return { success: false, error: `Sent, but not recorded: ${error.message}` };

  /*
   * The internal task rides alongside, not instead. It goes to our own people,
   * so it is sent rather than drafted even in semi-auto -- nobody needs to
   * approve telling an account manager that their client just got a final
   * notice, and a task sitting unapproved in drafts is a task nobody does.
   */
  if (row.internal_subject && row.internal_body && row.internal_to?.length) {
    const to = await internalRecipients(row.client_id, row.internal_to, settings.send_as);
    if (to) {
      const figures = figuresFor(row, row.account_manager, row.team_lead, sender);
      const isubject = fill(row.internal_subject, figures);
      const ibody = fillHtml(row.internal_body, figures);
      try {
        const sent = await sendAs({
          from: settings.send_as, fromName: sender, to, cc: null,
          subject: isubject, body: htmlToText(ibody), html: ibody,
        });
        await db.from("ar_sent").insert({
          qb_invoice_id: invoiceId, client_id: row.client_id, step_id: stepId,
          step_position: row.step_position, kind: "internal",
          offset_days: row.age_days, invoice_no: row.invoice_no,
          to_email: to, subject: isubject, body: ibody, mode: "full",
          rfc_message_id: sent?.rfcMessageId ?? null, sent_by: await whoAmI(),
        });
      } catch {
        // The client's email is the one that matters and it has already gone.
        // A failed internal task must not report the send as failed.
      }
    }
  }

  revalidatePath("/collections");
  revalidatePath(`/clients/${row.client_id}`);
  return { success: true, mode: settings.mode };
}

/** Who an internal task goes to. 'bg' is the finance mailbox itself. */
async function internalRecipients(
  clientId: string,
  roles: string[],
  sendAs: string
): Promise<string | null> {
  const db = createServiceClient();
  const out: string[] = [];

  if (roles.includes("bg") && sendAs) out.push(sendAs);

  if (roles.includes("am") || roles.includes("tl")) {
    const { data } = await db
      .from("org_clients")
      .select("account_manager_id,team_lead_id")
      .eq("id", clientId)
      .maybeSingle();
    const c = data as { account_manager_id: string | null; team_lead_id: string | null } | null;
    const wanted = [
      roles.includes("am") ? c?.account_manager_id : null,
      roles.includes("tl") ? c?.team_lead_id : null,
    ].filter(Boolean) as string[];
    if (wanted.length) {
      const { data: members } = await db
        .from("org_members").select("email,active").in("id", wanted);
      for (const m of (members ?? []) as { email: string; active: boolean }[]) {
        if (m.active && m.email?.trim()) out.push(m.email.trim());
      }
    }
  }

  const unique = [...new Set(out.map((e) => e.toLowerCase()))];
  return unique.length ? unique.join(", ") : null;
}

export async function holdInvoice(
  invoiceId: number,
  until: string | null,
  reason: string
): Promise<{ success: boolean; error?: string }> {
  if (!(await mayRun())) return { success: false, error: "Not permitted." };
  const { error } = await createServiceClient().from("ar_invoice_hold").upsert({
    qb_invoice_id: invoiceId,
    held_until: until,
    reason: reason.trim() || null,
    set_by: await whoAmI(),
    set_at: new Date().toISOString(),
  });
  if (error) return { success: false, error: error.message };
  revalidatePath("/collections/ar");
  return { success: true };
}

export async function releaseInvoice(
  invoiceId: number
): Promise<{ success: boolean; error?: string }> {
  if (!(await mayRun())) return { success: false, error: "Not permitted." };
  const { error } = await createServiceClient()
    .from("ar_invoice_hold").delete().eq("qb_invoice_id", invoiceId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/collections/ar");
  return { success: true };
}

export async function setArClientSettings(
  clientId: string,
  autopay: boolean,
  interestRate: string | null
): Promise<{ success: boolean; error?: string }> {
  if (!(await mayRun())) return { success: false, error: "Not permitted." };
  const { error } = await createServiceClient().from("ar_client_settings").upsert({
    client_id: clientId,
    autopay,
    interest_rate: interestRate?.trim() || null,
    updated_at: new Date().toISOString(),
    updated_by: await whoAmI(),
  });
  if (error) return { success: false, error: error.message };
  revalidatePath("/collections/ar");
  return { success: true };
}

export async function setArStepActive(
  stepId: string,
  active: boolean
): Promise<{ success: boolean; error?: string }> {
  if (!(await mayRun())) return { success: false, error: "Not permitted." };
  const { error } = await createServiceClient()
    .from("ar_steps")
    .update({ active, updated_at: new Date().toISOString(), updated_by: await whoAmI() })
    .eq("id", stepId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/collections/ar");
  revalidatePath("/settings/collections");
  return { success: true };
}

/**
 * Move the line the ladder starts at.
 *
 * Guarded, because moving it backwards is how a quiet system becomes a
 * hundred emails. The caller has to say how many invoices it would newly
 * catch and be told if that disagrees with what the server counts.
 */
export async function setArStartFrom(
  startFrom: string
): Promise<{ success: boolean; error?: string; wouldCatch?: number }> {
  if (!(await mayRun())) return { success: false, error: "Not permitted." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startFrom)) {
    return { success: false, error: "Not a date." };
  }
  const { error } = await createServiceClient()
    .from("ar_settings")
    .update({
      start_from: startFrom,
      updated_at: new Date().toISOString(),
      updated_by: await whoAmI(),
    })
    .eq("id", true);
  if (error) return { success: false, error: error.message };
  revalidatePath("/collections/ar");
  return { success: true };
}
