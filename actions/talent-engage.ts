"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { currentMemberId } from "@/lib/org";
import { assertTalent } from "@/lib/talent/access";
import { shareToken } from "@/lib/talent/format";
import { logActivity } from "@/actions/talent";
import { addCandidate } from "@/actions/talent-jobs";

/**
 * Everything that reaches out: tasks, interviews, submissions, scorecards,
 * outreach campaigns, and turning an inbound application into a candidate.
 *
 * Nothing here sends a message on its own. Campaign steps are prepared and
 * queued; a send only happens through `sendCampaignStep`, and that refuses
 * unless an email integration is actually connected. That is deliberate --
 * a half-built outreach engine that silently does nothing is worse than one
 * that says it is not plugged in.
 */

async function ctx() {
  await assertTalent("recruit");
  return { supabase: await createClient(), me: await currentMemberId() };
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export async function saveTask(input: {
  id?: string;
  title: string;
  notes?: string | null;
  due_at?: string | null;
  priority?: string;
  assigned_member_id?: string | null;
  person_id?: string | null;
  company_id?: string | null;
  job_id?: string | null;
  candidate_id?: string | null;
  deal_id?: string | null;
}) {
  const { supabase, me } = await ctx();
  if (!input.title?.trim()) throw new Error("A task needs a title");

  const row = {
    title: input.title.trim(),
    notes: input.notes ?? null,
    due_at: input.due_at || null,
    priority: input.priority ?? "normal",
    assigned_member_id: input.assigned_member_id ?? me,
    person_id: input.person_id || null,
    company_id: input.company_id || null,
    job_id: input.job_id || null,
    candidate_id: input.candidate_id || null,
    deal_id: input.deal_id || null,
  };

  const { error } = input.id
    ? await supabase.from("tal_tasks").update(row).eq("id", input.id)
    : await supabase.from("tal_tasks").insert({ ...row, created_by: me });
  if (error) throw new Error(`Could not save that task: ${error.message}`);

  revalidatePath("/talent/tasks");
  revalidatePath("/talent");
  if (input.person_id) revalidatePath(`/talent/people/${input.person_id}`);
  if (input.job_id) revalidatePath(`/talent/jobs/${input.job_id}`);
}

export async function completeTask(taskId: string, done: boolean) {
  const { supabase } = await ctx();
  await supabase.from("tal_tasks")
    .update({ done_at: done ? new Date().toISOString() : null }).eq("id", taskId);
  revalidatePath("/talent/tasks");
  revalidatePath("/talent");
}

export async function deleteTask(taskId: string) {
  const { supabase } = await ctx();
  await supabase.from("tal_tasks").delete().eq("id", taskId);
  revalidatePath("/talent/tasks");
}

// ---------------------------------------------------------------------------
// Interviews
// ---------------------------------------------------------------------------

/**
 * Records an interview. The calendar invitation is a separate step that needs
 * Google Calendar connected -- this holds the arrangement either way, so a
 * phone screen booked over the phone still shows up on the schedule.
 */
export async function saveInterview(input: {
  id?: string;
  person_id: string;
  candidate_id?: string | null;
  job_id?: string | null;
  kind?: string;
  title?: string | null;
  starts_at: string;
  ends_at?: string | null;
  location?: string | null;
  video_url?: string | null;
  attendees?: { name?: string; email: string }[];
  notes?: string | null;
  status?: string;
}) {
  const { supabase, me } = await ctx();
  if (!input.starts_at) throw new Error("A start time is required");

  const row = {
    person_id: input.person_id,
    candidate_id: input.candidate_id || null,
    job_id: input.job_id || null,
    kind: input.kind ?? "interview",
    title: input.title ?? null,
    starts_at: input.starts_at,
    ends_at: input.ends_at || null,
    location: input.location ?? null,
    video_url: input.video_url ?? null,
    attendees: input.attendees ?? [],
    notes: input.notes ?? null,
    status: input.status ?? "scheduled",
    organizer_member_id: me,
  };

  const { error } = input.id
    ? await supabase.from("tal_interviews").update(row).eq("id", input.id)
    : await supabase.from("tal_interviews").insert({ ...row, created_by: me });
  if (error) throw new Error(`Could not save that interview: ${error.message}`);

  if (!input.id) {
    await logActivity({
      typeSlug: "interview",
      person_id: input.person_id,
      job_id: input.job_id ?? null,
      candidate_id: input.candidate_id ?? null,
      subject: `${input.kind === "client_interview" ? "Client interview" : "Interview"} scheduled`,
      occurred_at: new Date().toISOString(),
      metadata: { starts_at: input.starts_at },
    });
  }

  revalidatePath("/talent/schedule");
  revalidatePath(`/talent/people/${input.person_id}`);
  if (input.job_id) revalidatePath(`/talent/jobs/${input.job_id}`);
}

export async function setInterviewStatus(interviewId: string, status: string) {
  const { supabase } = await ctx();
  await supabase.from("tal_interviews").update({ status }).eq("id", interviewId);
  revalidatePath("/talent/schedule");
}

// ---------------------------------------------------------------------------
// Submissions
// ---------------------------------------------------------------------------

export async function saveSubmission(input: {
  id?: string;
  job_id: string;
  candidate_id: string;
  person_id: string;
  headline?: string | null;
  summary?: string | null;
  include?: Record<string, boolean>;
}) {
  const { supabase, me } = await ctx();
  const row = {
    job_id: input.job_id,
    candidate_id: input.candidate_id,
    person_id: input.person_id,
    headline: input.headline ?? null,
    summary: input.summary ?? null,
    include: input.include ?? {
      resume: true, contact: false, compensation: false, work_history: true,
    },
  };

  const { data, error } = input.id
    ? await supabase.from("tal_submissions").update(row).eq("id", input.id).select("id").single()
    : await supabase.from("tal_submissions").insert({ ...row, created_by: me }).select("id").single();
  if (error) throw new Error(`Could not save that submission: ${error.message}`);

  revalidatePath(`/talent/jobs/${input.job_id}`);
  return (data as { id: string }).id;
}

/**
 * Marks a submission as shared and mints its token.
 *
 * The token is what makes the hiring-manager portal work without an account.
 * Sending the link is a separate act -- this returns the URL, and who it goes
 * to is a decision for the person, not for a background job.
 */
export async function shareSubmission(
  submissionId: string,
  recipients: { name?: string; email: string }[],
  expiresInDays = 30
) {
  const { supabase } = await ctx();

  const { data: sub } = await supabase
    .from("tal_submissions").select("job_id, share_token").eq("id", submissionId).maybeSingle();
  const row = sub as { job_id: string; share_token: string | null } | null;
  if (!row) throw new Error("That submission no longer exists");

  const token = row.share_token ?? shareToken();
  const expires = new Date();
  expires.setDate(expires.getDate() + expiresInDays);

  const { error } = await supabase
    .from("tal_submissions")
    .update({
      status: "shared",
      share_token: token,
      shared_with: recipients,
      shared_at: new Date().toISOString(),
      expires_at: expires.toISOString(),
    })
    .eq("id", submissionId);
  if (error) throw new Error(`Could not share that: ${error.message}`);

  // One portal link per job per recipient, so a hiring manager sees every
  // candidate for their search behind a single URL rather than one per person.
  const links: string[] = [];
  for (const r of recipients) {
    const { data: existing } = await supabase
      .from("tal_portal_links")
      .select("token")
      .eq("job_id", row.job_id)
      .eq("recipient_email", r.email)
      .is("revoked_at", null)
      .maybeSingle();

    let linkToken = (existing as { token: string } | null)?.token;
    if (!linkToken) {
      linkToken = shareToken();
      await supabase.from("tal_portal_links").insert({
        token: linkToken,
        job_id: row.job_id,
        recipient_name: r.name ?? null,
        recipient_email: r.email,
        expires_at: expires.toISOString(),
      });
    }
    links.push(`/portal/${linkToken}`);
  }

  revalidatePath(`/talent/jobs/${row.job_id}`);
  return { token, links };
}

export async function revokePortalLink(linkId: string, jobId: string) {
  const { supabase } = await ctx();
  await supabase.from("tal_portal_links")
    .update({ revoked_at: new Date().toISOString() }).eq("id", linkId);
  revalidatePath(`/talent/jobs/${jobId}`);
}

// ---------------------------------------------------------------------------
// Scorecards
// ---------------------------------------------------------------------------

export async function saveScorecard(input: {
  id?: string;
  candidate_id: string;
  job_id: string;
  person_id: string;
  interview_id?: string | null;
  template_id?: string | null;
  overall_rating?: number | null;
  recommendation?: string | null;
  ratings?: Record<string, { rating?: number; comment?: string }>;
  strengths?: string | null;
  concerns?: string | null;
  notes?: string | null;
  submit?: boolean;
}) {
  const { supabase, me } = await ctx();
  const row = {
    candidate_id: input.candidate_id,
    job_id: input.job_id,
    person_id: input.person_id,
    interview_id: input.interview_id || null,
    template_id: input.template_id || null,
    interviewer_member_id: me,
    overall_rating: input.overall_rating ?? null,
    recommendation: input.recommendation || null,
    ratings: input.ratings ?? {},
    strengths: input.strengths ?? null,
    concerns: input.concerns ?? null,
    notes: input.notes ?? null,
    submitted_at: input.submit ? new Date().toISOString() : null,
  };

  const { error } = input.id
    ? await supabase.from("tal_scorecards").update(row).eq("id", input.id)
    : await supabase.from("tal_scorecards").insert(row);
  if (error) throw new Error(`Could not save that scorecard: ${error.message}`);

  revalidatePath(`/talent/people/${input.person_id}`);
  revalidatePath(`/talent/jobs/${input.job_id}`);
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

export async function saveCampaign(input: {
  id?: string;
  name: string;
  job_id?: string | null;
  audience?: string;
  mode?: string;
  from_email?: string | null;
  status?: string;
  stop_on_reply?: boolean;
  send_weekdays_only?: boolean;
}) {
  const { supabase, me } = await ctx();
  if (!input.name?.trim()) throw new Error("A campaign needs a name");

  const row = {
    name: input.name.trim(),
    job_id: input.job_id || null,
    audience: input.audience ?? "candidate",
    mode: input.mode ?? "semi",
    from_email: input.from_email ?? null,
    status: input.status ?? "draft",
    stop_on_reply: input.stop_on_reply ?? true,
    send_weekdays_only: input.send_weekdays_only ?? true,
    owner_member_id: me,
  };

  const { data, error } = input.id
    ? await supabase.from("tal_campaigns").update(row).eq("id", input.id).select("id").single()
    : await supabase.from("tal_campaigns").insert({ ...row, created_by: me }).select("id").single();
  if (error) throw new Error(`Could not save that campaign: ${error.message}`);

  revalidatePath("/talent/campaigns");
  return (data as { id: string }).id;
}

/** Pausing and resuming, which is a different act from editing the campaign. */
export async function setCampaignStatus(campaignId: string, status: string) {
  const { supabase } = await ctx();
  const { error } = await supabase.from("tal_campaigns").update({ status }).eq("id", campaignId);
  if (error) throw new Error(`Could not change that: ${error.message}`);
  revalidatePath(`/talent/campaigns/${campaignId}`);
  revalidatePath("/talent/campaigns");
}

export async function saveCampaignStep(input: {
  id?: string;
  campaign_id: string;
  position: number;
  channel?: string;
  delay_days?: number;
  subject?: string | null;
  body?: string;
}) {
  const { supabase } = await ctx();
  const row = {
    campaign_id: input.campaign_id,
    position: input.position,
    channel: input.channel ?? "email",
    delay_days: input.delay_days ?? 0,
    subject: input.subject ?? null,
    body: input.body ?? "",
  };
  const { error } = input.id
    ? await supabase.from("tal_campaign_steps").update(row).eq("id", input.id)
    : await supabase.from("tal_campaign_steps").insert(row);
  if (error) throw new Error(`Could not save that step: ${error.message}`);
  revalidatePath(`/talent/campaigns/${input.campaign_id}`);
}

export async function deleteCampaignStep(stepId: string, campaignId: string) {
  const { supabase } = await ctx();
  await supabase.from("tal_campaign_steps").delete().eq("id", stepId);
  revalidatePath(`/talent/campaigns/${campaignId}`);
}

/**
 * Enrols people, skipping the ones it must not contact.
 *
 * Do-not-contact and no-email-address are not errors to report one by one --
 * they are a count to show, because enrolling two hundred people and being
 * told about the eleven that were skipped is the useful shape.
 */
export async function enrolInCampaign(campaignId: string, personIds: string[]) {
  const { supabase, me } = await ctx();

  const { data: people } = await supabase
    .from("tal_people")
    .select("id, primary_email, do_not_contact, unsubscribed_at")
    .in("id", personIds);

  const rows = (people ?? []) as {
    id: string; primary_email: string | null; do_not_contact: boolean; unsubscribed_at: string | null;
  }[];
  const eligible = rows.filter((p) => p.primary_email && !p.do_not_contact && !p.unsubscribed_at);
  const skipped = rows.length - eligible.length;

  if (eligible.length) {
    const { error } = await supabase
      .from("tal_campaign_members")
      .upsert(
        eligible.map((p) => ({
          campaign_id: campaignId, person_id: p.id, enrolled_by: me,
          next_due_at: new Date().toISOString(),
        })),
        { onConflict: "campaign_id,person_id", ignoreDuplicates: true }
      );
    if (error) throw new Error(`Could not enrol: ${error.message}`);
  }

  revalidatePath(`/talent/campaigns/${campaignId}`);
  return { enrolled: eligible.length, skipped };
}

export async function setCampaignMemberStatus(memberRowId: string, status: string, campaignId: string) {
  const { supabase } = await ctx();
  await supabase.from("tal_campaign_members")
    .update({ status, finished_at: status === "active" ? null : new Date().toISOString() })
    .eq("id", memberRowId);
  revalidatePath(`/talent/campaigns/${campaignId}`);
}

/**
 * Builds the next step for everyone who is due, as drafts.
 *
 * Sending is refused while no email integration is connected. Queuing is not --
 * a draft queue is genuinely useful on its own, and it means the day the
 * mailbox is connected there is already work waiting rather than an empty
 * screen that needs a week of use before it proves anything.
 */
export async function prepareCampaignSends(campaignId: string) {
  const { supabase } = await ctx();

  const [{ data: steps }, { data: due }] = await Promise.all([
    supabase.from("tal_campaign_steps").select("*").eq("campaign_id", campaignId)
      .eq("active", true).order("position"),
    supabase.from("tal_campaign_members")
      .select("id, current_position, next_due_at, tal_people(id,name,first_name,primary_email,title,company_name)")
      .eq("campaign_id", campaignId).eq("status", "active")
      .lte("next_due_at", new Date().toISOString()),
  ]);

  const stepList = (steps ?? []) as { id: string; position: number; channel: string; delay_days: number; subject: string | null; body: string }[];
  const members = (due ?? []) as unknown as {
    id: string; current_position: number;
    tal_people: { id: string; name: string; first_name: string | null; primary_email: string | null; title: string | null; company_name: string | null } | null;
  }[];

  let prepared = 0;
  for (const m of members) {
    const next = stepList.find((s) => s.position > m.current_position);
    if (!next) {
      await supabase.from("tal_campaign_members")
        .update({ status: "completed", finished_at: new Date().toISOString(), next_due_at: null })
        .eq("id", m.id);
      continue;
    }
    const p = m.tal_people;
    if (!p?.primary_email) continue;

    const fill = (text: string) =>
      text
        .replaceAll("{{first_name}}", p.first_name ?? p.name.split(" ")[0] ?? "")
        .replaceAll("{{name}}", p.name)
        .replaceAll("{{title}}", p.title ?? "")
        .replaceAll("{{company}}", p.company_name ?? "");

    await supabase.from("tal_campaign_sends").insert({
      member_id: m.id, step_id: next.id, channel: next.channel,
      to_address: p.primary_email,
      subject: next.subject ? fill(next.subject) : null,
      body: fill(next.body), status: "drafted",
    });

    const after = new Date();
    const following = stepList.find((s) => s.position > next.position);
    after.setDate(after.getDate() + (following?.delay_days ?? 0));

    await supabase.from("tal_campaign_members")
      .update({
        current_position: next.position,
        next_due_at: following ? after.toISOString() : null,
        status: following ? "active" : "completed",
      })
      .eq("id", m.id);
    prepared++;
  }

  revalidatePath(`/talent/campaigns/${campaignId}`);
  return prepared;
}

// ---------------------------------------------------------------------------
// Inbound applications
// ---------------------------------------------------------------------------

/**
 * Turns an application from the careers page into a real person and candidate.
 *
 * A matching email address is reused rather than duplicated -- somebody who
 * applied for one role last year and another one today is one person, and this
 * is the moment that stays true or stops being true.
 */
export async function acceptApplication(applicationId: string) {
  const { supabase, me } = await ctx();

  const { data: app } = await supabase
    .from("tal_applications").select("*").eq("id", applicationId).maybeSingle();
  const a = app as {
    id: string; job_id: string; first_name: string | null; last_name: string | null;
    email: string | null; phone: string | null; linkedin_url: string | null;
    location: string | null; cover_note: string | null; resume_path: string | null;
    resume_name: string | null; status: string;
  } | null;
  if (!a) throw new Error("That application no longer exists");
  if (a.status !== "new") throw new Error("That application has already been dealt with");

  let personId: string | null = null;
  if (a.email) {
    const { data: existing } = await supabase
      .from("tal_people").select("id").eq("primary_email", a.email.toLowerCase())
      .is("merged_into_id", null).maybeSingle();
    personId = (existing as { id: string } | null)?.id ?? null;
  }

  if (!personId) {
    const { data: created, error } = await supabase
      .from("tal_people")
      .insert({
        first_name: a.first_name, last_name: a.last_name,
        emails: a.email ? [{ value: a.email, type: "personal", primary: true }] : [],
        phones: a.phone ? [{ value: a.phone, type: "mobile", primary: true }] : [],
        linkedin_url: a.linkedin_url,
        city: a.location,
        source: "applied", source_detail: "Careers page",
        created_by: me, owner_member_id: me,
      })
      .select("id").single();
    if (error) throw new Error(`Could not create that person: ${error.message}`);
    personId = (created as { id: string }).id;
  }

  if (a.resume_path) {
    await supabase.from("tal_documents").insert({
      person_id: personId, job_id: a.job_id,
      name: a.resume_name ?? "Resume", kind: "resume",
      storage_path: a.resume_path, is_primary: true, uploaded_by: me,
    });
  }

  const candidate = await addCandidate(a.job_id, personId, {
    source: "applied", source_detail: "Careers page",
  });

  if (a.cover_note) {
    await logActivity({
      typeSlug: "note", person_id: personId, job_id: a.job_id,
      candidate_id: candidate.id, subject: "Cover note from the application",
      body: a.cover_note,
    });
  }

  await supabase.from("tal_applications")
    .update({
      status: "accepted", person_id: personId, candidate_id: candidate.id,
      reviewed_by: me, reviewed_at: new Date().toISOString(),
    })
    .eq("id", applicationId);

  revalidatePath("/talent/applications");
  revalidatePath(`/talent/jobs/${a.job_id}`);
  return { personId, candidateId: candidate.id };
}

export async function rejectApplication(applicationId: string, status: "rejected" | "spam" | "duplicate") {
  const { supabase, me } = await ctx();
  await supabase.from("tal_applications")
    .update({ status, reviewed_by: me, reviewed_at: new Date().toISOString() })
    .eq("id", applicationId);
  revalidatePath("/talent/applications");
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

export async function saveList(input: {
  id?: string;
  name: string;
  description?: string | null;
  entity?: string;
  is_smart?: boolean;
  filter?: Record<string, unknown>;
  shared?: boolean;
}) {
  const { supabase, me } = await ctx();
  if (!input.name?.trim()) throw new Error("A list needs a name");

  const row = {
    name: input.name.trim(),
    description: input.description ?? null,
    entity: input.entity ?? "person",
    is_smart: input.is_smart ?? false,
    filter: input.filter ?? {},
    shared: input.shared ?? true,
    owner_member_id: me,
  };
  const { data, error } = input.id
    ? await supabase.from("tal_lists").update(row).eq("id", input.id).select("id").single()
    : await supabase.from("tal_lists").insert(row).select("id").single();
  if (error) throw new Error(`Could not save that list: ${error.message}`);

  revalidatePath("/talent/lists");
  return (data as { id: string }).id;
}

export async function addToList(listId: string, entityIds: string[]) {
  const { supabase, me } = await ctx();
  if (!entityIds.length) return 0;
  const { error } = await supabase
    .from("tal_list_members")
    .upsert(entityIds.map((id) => ({ list_id: listId, entity_id: id, added_by: me })),
            { onConflict: "list_id,entity_id", ignoreDuplicates: true });
  if (error) throw new Error(`Could not add to that list: ${error.message}`);
  revalidatePath("/talent/lists");
  return entityIds.length;
}

export async function removeFromList(listId: string, entityId: string) {
  const { supabase } = await ctx();
  await supabase.from("tal_list_members").delete().eq("list_id", listId).eq("entity_id", entityId);
  revalidatePath("/talent/lists");
}

export async function deleteList(listId: string) {
  const { supabase } = await ctx();
  await supabase.from("tal_lists").delete().eq("id", listId);
  revalidatePath("/talent/lists");
}
