"use server";

import { revalidatePath } from "next/cache";
import { draftAs, sendAs } from "@/lib/google/compose";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { resolveAction } from "@/lib/sequences/step-actions";
import { myPermissions } from "@/lib/org";
import { fill, fillHtml, surveyUrl, type Figures } from "@/lib/nps/render";
import { htmlToText } from "@/lib/email/richtext";

/*
 * Sending the survey, one step of the ladder at a time.
 *
 * Modelled on actions/collections.ts, and different in exactly one way that
 * matters: collections comes from a single mailbox held in settings, while a
 * survey comes from the client's own team lead. So the sender arrives on each
 * queue row rather than being looked up once, and a row with no lead is not
 * offered at all rather than quietly falling back to somebody else's name.
 */

export type QueueRow = {
  send_id: string;
  client_id: string;
  client_name: string;
  campaign_id: string;
  campaign_name: string;
  to_email: string;
  contact_first_name: string | null;
  token: string;
  from_email: string;
  from_name: string | null;
  invited_at: string | null;
  days_since_send: number;
  step_id: string;
  step_position: number;
  step_days: number;
  subject: string;
  body: string;
  last_sent_at: string | null;
  last_step_position: number | null;
};

export type Invitation = QueueRow & {
  rendered_subject: string;
  rendered_body: string;
};

export type Step = {
  id: string;
  position: number;
  days_after_send: number;
  subject: string;
  body: string;
  active: boolean;
};

export type Settings = { mode: "semi" | "full" };

async function mayRun(): Promise<boolean> {
  const perms = await myPermissions();
  return perms.has("nps.send") || perms.has("org.manage");
}

async function whoAmI(): Promise<string> {
  const { data } = await (await createClient()).auth.getUser();
  return data.user?.email ?? "unknown";
}

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://team.facturmfg.com";
}

export async function getNpsSettings(): Promise<Settings> {
  const { data } = await createServiceClient()
    .from("sequences").select("mode").eq("slug", "nps").maybeSingle();
  return { mode: (data as { mode: "semi" | "full" } | null)?.mode ?? "semi" };
}


function figuresFor(row: QueueRow): Figures {
  return {
    client_name: row.client_name,
    contact_first_name: row.contact_first_name,
    sender_name: row.from_name,
    url: surveyUrl(siteUrl(), row.token),
  };
}

/**
 * Mint a campaign: one invitation, with its own token, per eligible client.
 *
 * Nothing is emailed. This only creates the invitations -- the ladder is what
 * sends step one, which means a campaign can be built, looked at, and abandoned
 * without a single client hearing about it.
 */
export async function createNpsCampaign(name: string, period: string) {
  if (!(await mayRun())) return { success: false, error: "Not permitted." };
  if (!name.trim()) return { success: false, error: "A campaign needs a name." };
  if (!period) return { success: false, error: "Pick the period it covers." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_nps_campaign", {
    p_name: name.trim(),
    p_period: period,
  });
  if (error) return { success: false, error: error.message };

  const row = (data ?? [])[0] as
    | { campaign_id: string; invitations: number; named: number; skipped: number }
    | undefined;

  revalidatePath("/clients/nps");
  return {
    success: true,
    campaignId: row?.campaign_id,
    invitations: row?.invitations ?? 0,
    // Reported rather than assumed: a survey from a named person that opens
    // "Hi there" reads as a mailshot, so a shortfall here is worth seeing
    // before the first one goes out, not after.
    named: row?.named ?? 0,
    skipped: row?.skipped ?? 0,
  };
}

/** Who is due a survey email, and which one, with the wording filled in. */
export async function getNpsQueue(): Promise<Invitation[]> {
  if (!(await mayRun())) return [];

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_nps_queue");
  if (error) throw new Error(`NPS queue failed: ${error.message}`);

  return ((data ?? []) as QueueRow[]).map((row) => ({
    ...row,
    rendered_subject: fill(row.subject, figuresFor(row)),
    rendered_body: fillHtml(row.body, figuresFor(row)),
  }));
}

/** The ladder, in the shape the send screen already expects. */
export async function getNpsSteps(): Promise<Step[]> {
  const db = createServiceClient();
  const { data: seq } = await db
    .from("sequences").select("id").eq("slug", "nps").maybeSingle();
  if (!seq) return [];

  const { data } = await db
    .from("sequence_steps")
    .select("id,position,offset_days,config,active")
    .eq("sequence_id", (seq as { id: string }).id)
    .order("position");

  return ((data ?? []) as unknown as {
    id: string; position: number; offset_days: number;
    config: { subject?: string; body?: string }; active: boolean;
  }[]).map((r) => ({
    id: r.id, position: r.position, days_after_send: r.offset_days,
    subject: r.config.subject ?? "", body: r.config.body ?? "", active: r.active,
  }));
}



/**
 * The whole email, to your own inbox, before any client sees it.
 *
 * Worth having separately from the preview on screen: the preview shows the
 * wording, this shows what Gmail and Outlook actually make of the scale, which
 * is the part most likely to look wrong.
 */
export async function draftSurveyToMe(sendId: string, stepId: string) {
  if (!(await mayRun())) return { success: false, error: "Not permitted." };

  let queue: Invitation[];
  try {
    queue = await getNpsQueue();
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "NPS queue failed." };
  }
  const row = queue.find((q) => q.send_id === sendId && q.step_id === stepId);
  if (!row) return { success: false, error: "That step is no longer due." };

  const me = await whoAmI();
  const figures = figuresFor(row);

  try {
    await draftAs({
      from: me,
      fromName: null,
      to: me,
      subject: `[Preview] ${fill(row.subject, figures)}`,
      body: fill(row.body, figures),
      html: fillHtml(row.body, figures),
    });
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Gmail refused it." };
  }
  return { success: true };
}

/**
 * Send (or draft) one step to one client.
 *
 * The wording is taken from the caller, because whoever is looking at it may
 * have edited it for this one person. Everything else -- who it goes to, who it
 * comes from, and whether this step is due at all -- is read from the queue on
 * the server. Otherwise the screen would be a way to send mail as any team lead
 * to any address, which is not what anyone asked for.
 */
export async function placeSurvey(
  sendId: string,
  stepId: string,
  subject: string,
  body: string
): Promise<{ success: boolean; error?: string; mode?: "semi" | "full" }> {
  if (!(await mayRun())) return { success: false, error: "Not permitted." };
  if (!subject.trim() || !body.trim()) return { success: false, error: "Nothing to send." };

  let queue: Invitation[];
  try {
    queue = await getNpsQueue();
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "NPS queue failed." };
  }
  const row = queue.find((q) => q.send_id === sendId && q.step_id === stepId);
  if (!row) {
    return { success: false, error: "That step is no longer due — the queue has moved on." };
  }
  if (!row.to_email) {
    return { success: false, error: `No contact address for ${row.client_name}.` };
  }
  if (!row.from_email) {
    return { success: false, error: `${row.client_name} has no team lead to send as.` };
  }

  const settings = await getNpsSettings();
  const figures = figuresFor(row);

  const outgoing = {
    from: row.from_email,
    fromName: row.from_name,
    to: row.to_email,
    subject: subject.trim(),
    // The queue edits HTML; the text part is derived from it so the two
    // alternatives in the message always say the same thing.
    body: htmlToText(body),
    html: body,
  };

  let placed;
  try {
    /*
     * The step decides, falling back to the sequence.
     *
     * A step written before step actions existed carries none, and
     * resolveAction hands back the sequence's own mode for it -- so nothing
     * that already runs changes behaviour until somebody deliberately picks
     * an action on a step.
     */
    const { data: stepRow } = await createServiceClient()
      .from("sequence_steps").select("config").eq("id", stepId).maybeSingle();
    const action = resolveAction(
      ((stepRow as { config?: Record<string, string> } | null)?.config ?? {}).action,
      settings.mode
    );

    placed = action.automatic ? await sendAs(outgoing) : await draftAs(outgoing);
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Gmail refused it." };
  }

  const db = createServiceClient();
  const { error } = await db.from("nps_sequence_sent").insert({
    send_id: sendId,
    step_id: stepId,
    step_position: row.step_position,
    to_email: row.to_email,
    from_email: row.from_email,
    subject: outgoing.subject,
    body,
    mode: settings.mode,
    gmail_draft_id: placed.draftId,
    rfc_message_id: placed.rfcMessageId,
    sent_by: await whoAmI(),
  });

  /*
   * The mail is already in a mailbox by this point. Failing to write the log
   * afterwards must not read as "nothing happened", or the same client gets the
   * same survey twice.
   */
  if (error) {
    return {
      success: false,
      error:
        `The email was ${settings.mode === "full" ? "sent" : "drafted"}, but recording it ` +
        `failed: ${error.message}. Check the mailbox before sending it again.`,
    };
  }

  /*
   * The invitation is what the ladder counts from, so only the first step
   * stamps it -- a reminder must not reset the clock and start the sequence
   * over. The sender is frozen at the same moment, so a lead changing teams
   * mid-ladder does not make the next reminder come from a stranger.
   */
  if (!row.invited_at) {
    await db
      .from("nps_sends")
      .update({ sent_at: new Date().toISOString(), sender_email: row.from_email })
      .eq("id", sendId)
      .is("sent_at", null);
  }

  revalidatePath("/clients/nps");
  return { success: true, mode: settings.mode };
}
