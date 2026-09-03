"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { currentMemberId } from "@/lib/org";
import { assertTalent } from "@/lib/talent/access";
import { syncTalentMail, type MailSyncReport } from "@/lib/talent/mail";
import { draftAs, sendAs } from "@/lib/google/compose";
import { htmlToText } from "@/lib/email/richtext";

/**
 * Sending and receiving, through the Google delegation this app already holds.
 *
 * Nothing here needed a new credential. Collections has been drafting into a
 * mailbox and the billing ingest reading out of one for months; the service
 * account's domain-wide delegation already carries `gmail.compose` and
 * `gmail.readonly`. Talent reuses both.
 *
 * Mail always goes out **as the person clicking the button**, never from a
 * shared address. A candidate who replies should reach the recruiter who wrote
 * to them, and a reply to noreply@ is a candidate lost.
 */

async function me() {
  await assertTalent("recruit");
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) throw new Error("Not signed in");

  const db = createServiceClient();
  const { data } = await db
    .from("org_members").select("id,full_name,email").eq("auth_user_id", user.id).maybeSingle();
  const member = data as { id: string; full_name: string | null; email: string } | null;

  return {
    supabase,
    memberId: member?.id ?? (await currentMemberId()),
    from: member?.email ?? user.email,
    fromName: member?.full_name ?? null,
  };
}

/** Turns "{{first_name}}" into a name, for the composer's preview and the send. */
export async function fillMergeFields(personId: string, text: string) {
  await assertTalent("view");
  const supabase = await createClient();
  const { data } = await supabase
    .from("tal_people")
    .select("name,first_name,title,company_name")
    .eq("id", personId).maybeSingle();
  const p = data as {
    name: string; first_name: string | null; title: string | null; company_name: string | null;
  } | null;
  if (!p) return text;

  return text
    .replaceAll("{{first_name}}", p.first_name ?? p.name.split(" ")[0] ?? "")
    .replaceAll("{{name}}", p.name)
    .replaceAll("{{title}}", p.title ?? "")
    .replaceAll("{{company}}", p.company_name ?? "");
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export type SendResult = {
  placed: "sent" | "drafted";
  /** Where to go and look at it, for the semi-automatic case. */
  gmailId: string;
};

/**
 * One email to one person.
 *
 * `mode` is the house convention: semi leaves it in the sender's Drafts for
 * them to read and send, full sends it there and then. Semi is the default
 * everywhere in this app and it is the right default here too -- the first
 * message to a candidate is the one that decides whether they reply.
 *
 * Returns a result rather than throwing -- Next redacts a thrown Server
 * Action error's message in production (the client gets a generic "Minified
 * React error" and a digest; the real text only reaches the server log), so a
 * thrown error here would never actually reach the composer. Everything that
 * can fail is caught and turned into { ok: false }.
 */
export async function sendTalentEmail(input: {
  personId: string;
  to: string;
  subject: string;
  body: string;
  mode?: "semi" | "full";
  jobId?: string | null;
  candidateId?: string | null;
}): Promise<({ ok: true } & SendResult) | { ok: false; error: string }> {
  try {
    const { supabase, memberId, from, fromName } = await me();

    if (!input.to?.includes("@")) throw new Error("That is not an email address");
    if (!input.subject?.trim()) throw new Error("A subject is required");

    // Do-not-contact is checked here rather than only in the UI: this action is a
    // public endpoint, and it is the last place the rule can actually be enforced.
    const { data: person } = await supabase
      .from("tal_people")
      .select("do_not_contact,unsubscribed_at")
      .eq("id", input.personId).maybeSingle();
    const p = person as { do_not_contact: boolean; unsubscribed_at: string | null } | null;
    if (p?.do_not_contact) throw new Error("That person is marked do not contact");
    if (p?.unsubscribed_at) throw new Error("That person has unsubscribed");

    const subject = await fillMergeFields(input.personId, input.subject);
    const body = await fillMergeFields(input.personId, input.body);

    const outgoing = {
      from, fromName, to: input.to.trim(), subject,
      body: htmlToText(body),
      html: /<[a-z][\s\S]*>/i.test(body) ? body : null,
    };

    const placed = (input.mode ?? "semi") === "full"
      ? await sendAs(outgoing)
      : await draftAs(outgoing);

    /*
     * The activity carries the Message-ID the mail went out with, which is the
     * same id the inbound sync will see on the reply's thread. Without it the
     * send and the answer to it are two unrelated rows on the timeline.
     */
    const { data: type } = await supabase
      .from("tal_activity_types").select("id").eq("slug", "email-out").maybeSingle();

    await supabase.from("tal_activities").insert({
      activity_type_id: (type as { id: string } | null)?.id ?? null,
      person_id: input.personId,
      job_id: input.jobId || null,
      candidate_id: input.candidateId || null,
      subject,
      body: htmlToText(body).slice(0, 2000),
      direction: "outbound",
      external_source: "gmail",
      external_id: placed.rfcMessageId,
      created_by: memberId,
      metadata: {
        mailbox: from,
        draft: placed.draftId ? true : false,
        to: outgoing.to,
      },
    });

    revalidatePath(`/talent/people/${input.personId}`);
    if (input.jobId) revalidatePath(`/talent/jobs/${input.jobId}`);

    return {
      ok: true,
      placed: placed.draftId ? "drafted" : "sent",
      gmailId: placed.gmailId,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not place that message" };
  }
}

/**
 * Puts one prepared campaign message out.
 *
 * Campaign steps are built as drafts by `prepareCampaignSends`; this is the
 * separate act of actually placing one. Kept separate on purpose -- preparing
 * two hundred messages and sending two hundred messages should not be the same
 * click.
 */
export async function placeCampaignSend(sendId: string): Promise<SendResult> {
  const { supabase, memberId, from, fromName } = await me();

  const { data } = await supabase
    .from("tal_campaign_sends")
    .select("id,status,to_address,subject,body,channel," +
            "tal_campaign_members(person_id,campaign_id,tal_campaigns(mode,from_email,name,job_id))")
    .eq("id", sendId).maybeSingle();

  const send = data as unknown as {
    id: string; status: string; to_address: string | null;
    subject: string | null; body: string | null; channel: string;
    tal_campaign_members: {
      person_id: string; campaign_id: string;
      tal_campaigns: { mode: string; from_email: string | null; name: string; job_id: string | null } | null;
    } | null;
  } | null;

  if (!send) throw new Error("That message no longer exists");
  if (send.channel !== "email") throw new Error("Only email steps can be sent from here");
  if (send.status === "sent") throw new Error("That one has already gone out");
  if (!send.to_address) throw new Error("That person has no email address");

  const campaign = send.tal_campaign_members?.tal_campaigns;
  const personId = send.tal_campaign_members?.person_id;
  if (!personId) throw new Error("That message is not attached to anybody");

  const sent = await sendTalentEmail({
    personId,
    to: send.to_address,
    subject: send.subject ?? campaign?.name ?? "",
    body: send.body ?? "",
    mode: (campaign?.mode as "semi" | "full") ?? "semi",
    jobId: campaign?.job_id ?? null,
  });
  if (!sent.ok) throw new Error(sent.error);
  const result: SendResult = sent;

  await supabase
    .from("tal_campaign_sends")
    .update({
      status: result.placed === "sent" ? "sent" : "drafted",
      sent_at: new Date().toISOString(),
      sent_by: memberId,
      gmail_id: result.gmailId,
    })
    .eq("id", sendId);

  if (campaign) revalidatePath(`/talent/campaigns/${send.tal_campaign_members!.campaign_id}`);
  return result;
}

/** Every queued message on a campaign, one after another. */
export async function placeAllCampaignSends(campaignId: string) {
  await assertTalent("recruit");
  const supabase = await createClient();

  const { data } = await supabase
    .from("tal_campaign_sends")
    .select("id, tal_campaign_members!inner(campaign_id)")
    .eq("tal_campaign_members.campaign_id", campaignId)
    .in("status", ["queued", "drafted"]);

  const rows = (data ?? []) as { id: string }[];
  let placed = 0;
  const failed: string[] = [];

  for (const row of rows) {
    try {
      await placeCampaignSend(row.id);
      placed++;
    } catch (e) {
      failed.push(e instanceof Error ? e.message : "unknown");
    }
  }

  revalidatePath(`/talent/campaigns/${campaignId}`);
  return { placed, failed };
}

// ---------------------------------------------------------------------------
// Receiving
// ---------------------------------------------------------------------------

/**
 * Reads the configured mailboxes and files what belongs to somebody.
 *
 * Needs `talent.admin` rather than `talent.recruit`: this reads other people's
 * mail, and that is an administrative act however narrow the matching is.
 *
 * Returns a result rather than throwing -- Next redacts a thrown Server
 * Action error's message in production (the client gets a generic "Minified
 * React error" and a digest; the real text only reaches the server log), so a
 * thrown error here -- including the one `syncTalentMail` itself throws --
 * would never actually reach the settings panel. Everything is caught and
 * turned into { ok: false }.
 */
export async function syncMailNow(sinceDays?: number): Promise<
  | { ok: true; reports: MailSyncReport[]; repliesStopped: number }
  | { ok: false; error: string }
> {
  try {
    await assertTalent("admin");

    let reports: MailSyncReport[];
    try {
      reports = await syncTalentMail(sinceDays);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Sync failed" };
    }

    // A reply ends a sequence, and that has to be decided after the whole sync
    // rather than per message -- otherwise somebody who wrote back on Friday
    // still gets Monday's follow-up because the rows arrived out of order.
    const supabase = await createClient();
    const { data } = await supabase.rpc("tal_mark_campaign_replies");

    revalidatePath("/settings/talent");
    revalidatePath("/talent");
    return { ok: true, reports, repliesStopped: (data as number) ?? 0 };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Sync failed" };
  }
}

export async function saveMailAccounts(
  accounts: string[],
  days: number
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await assertTalent("admin");
    const supabase = await createClient();
    const memberId = await currentMemberId();

    const clean = [...new Set(
      accounts.map((a) => a.trim().toLowerCase()).filter((a) => a.includes("@"))
    )];

    // Only Factur addresses. The delegation would hand this app a token for
    // anyone in the domain, so the list of whose mail gets read is the restraint,
    // and it should not be possible to point it at a stranger by typo.
    const outside = clean.filter(
      (a) => !["facturmfg.com", "bethefactur.com"].includes(a.split("@")[1] ?? "")
    );
    if (outside.length) {
      throw new Error(`Only Factur mailboxes can be synced — ${outside.join(", ")} is not one`);
    }

    const { error } = await supabase
      .from("tal_settings")
      .update({
        mail_accounts: clean,
        mail_sync_days: Math.min(Math.max(days, 1), 365),
        updated_by: memberId,
      })
      .eq("id", true);
    if (error) throw new Error(`Could not save that: ${error.message}`);

    revalidatePath("/settings/talent");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save that" };
  }
}
