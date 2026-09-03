"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { currentMemberId } from "@/lib/org";
import { assertTalent } from "@/lib/talent/access";
import { jobSlug } from "@/lib/talent/format";
import { logActivity } from "@/actions/talent";

/**
 * Jobs, the pipeline, placements and deals.
 *
 * The rule that shapes this file: a candidate's stage is changed by exactly one
 * function, `moveCandidate`. Stage history, the activity note and the automation
 * hook all hang off it, and a second path that wrote `stage_id` directly would
 * silently skip all three.
 */

async function ctx() {
  await assertTalent("recruit");
  return { supabase: await createClient(), me: await currentMemberId() };
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export type JobInput = {
  title: string;
  company_id?: string | null;
  workflow_id?: string | null;
  status?: string;
  job_kind?: string;
  employment_type?: string;
  confidential?: boolean;
  description?: string | null;
  requirements?: string | null;
  internal_notes?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  remote?: string;
  salary_min?: number | null;
  salary_max?: number | null;
  salary_currency?: string;
  salary_period?: string;
  fee_type?: string | null;
  fee_percent?: number | null;
  fee_flat?: number | null;
  openings?: number;
  owner_member_id?: string | null;
  hiring_manager_person_id?: string | null;
  opened_on?: string | null;
  target_fill_on?: string | null;
};

function jobRow(input: JobInput, me: string | null) {
  return {
    title: input.title.trim(),
    company_id: input.company_id || null,
    workflow_id: input.workflow_id || null,
    status: input.status ?? "draft",
    job_kind: input.job_kind ?? "internal",
    employment_type: input.employment_type ?? "full_time",
    confidential: input.confidential ?? false,
    description: input.description ?? null,
    requirements: input.requirements ?? null,
    internal_notes: input.internal_notes ?? null,
    city: input.city ?? null,
    state: input.state ?? null,
    country: input.country ?? null,
    remote: input.remote ?? "onsite",
    salary_min: input.salary_min ?? null,
    salary_max: input.salary_max ?? null,
    salary_currency: input.salary_currency ?? "USD",
    salary_period: input.salary_period ?? "year",
    fee_type: input.fee_type || null,
    fee_percent: input.fee_percent ?? null,
    fee_flat: input.fee_flat ?? null,
    openings: input.openings ?? 1,
    owner_member_id: input.owner_member_id ?? me,
    hiring_manager_person_id: input.hiring_manager_person_id || null,
    opened_on: input.opened_on || null,
    target_fill_on: input.target_fill_on || null,
  };
}

export async function createJob(
  input: JobInput
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const { supabase, me } = await ctx();
    if (!input.title?.trim()) return { ok: false, error: "A job title is required" };

    // A job with no workflow has no board, so the default is applied here rather
    // than left to the person filling in the form.
    let workflowId = input.workflow_id;
    if (!workflowId) {
      const { data } = await supabase
        .from("tal_settings").select("default_workflow_id").maybeSingle();
      workflowId = (data as { default_workflow_id: string | null } | null)?.default_workflow_id ?? null;
    }
    if (!workflowId) {
      const { data } = await supabase
        .from("tal_workflows").select("id").eq("is_default", true).maybeSingle();
      workflowId = (data as { id: string } | null)?.id ?? null;
    }

    const { data, error } = await supabase
      .from("tal_jobs")
      .insert({
        ...jobRow({ ...input, workflow_id: workflowId }, me),
        created_by: me,
        opened_on: input.opened_on || new Date().toISOString().slice(0, 10),
      })
      .select("id")
      .single();
    if (error) return { ok: false, error: `Could not create that job: ${error.message}` };

    const id = (data as { id: string }).id;
    if (me) await supabase.from("tal_job_team").insert({ job_id: id, member_id: me, role: "owner" });
    revalidatePath("/talent/jobs");
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not create that job" };
  }
}

export async function updateJob(
  jobId: string,
  input: JobInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { supabase, me } = await ctx();
    const row = jobRow(input, me);
    if (input.owner_member_id === undefined) delete (row as Record<string, unknown>).owner_member_id;

    // Closing a job stamps the date; reopening one clears it, so "how long was
    // this search open" is answerable without reading the history.
    const closing = ["filled", "closed", "cancelled"].includes(row.status);
    const { error } = await supabase
      .from("tal_jobs")
      .update({ ...row, closed_at: closing ? new Date().toISOString() : null })
      .eq("id", jobId);
    if (error) return { ok: false, error: `Could not save that job: ${error.message}` };
    revalidatePath(`/talent/jobs/${jobId}`);
    revalidatePath("/talent/jobs");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save that job" };
  }
}

/**
 * Puts a job on the careers page, or takes it off.
 *
 * A confidential search can never be published -- the check is here as well as
 * in the database function, because a confidential job appearing on a public
 * page is the kind of mistake that ends a client relationship.
 */
export async function publishJob(
  jobId: string,
  published: boolean
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { supabase } = await ctx();

    const { data: job } = await supabase
      .from("tal_jobs").select("title,confidential,public_slug,status").eq("id", jobId).maybeSingle();
    const row = job as { title: string; confidential: boolean; public_slug: string | null; status: string } | null;
    if (!row) return { ok: false, error: "That job no longer exists" };
    if (published && row.confidential) return { ok: false, error: "A confidential job cannot be published" };
    if (published && row.status !== "active") {
      return { ok: false, error: "Only an active job can be published — set the status to Active first" };
    }

    const { error } = await supabase
      .from("tal_jobs")
      .update({
        published,
        published_at: published ? new Date().toISOString() : null,
        public_slug: row.public_slug ?? jobSlug(row.title),
      })
      .eq("id", jobId);
    if (error) return { ok: false, error: `Could not change that: ${error.message}` };
    revalidatePath(`/talent/jobs/${jobId}`);
    revalidatePath("/careers");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not change that" };
  }
}

export async function setJobTeamMember(jobId: string, memberId: string, role: string, on: boolean) {
  const { supabase } = await ctx();
  if (on) await supabase.from("tal_job_team").upsert({ job_id: jobId, member_id: memberId, role });
  else await supabase.from("tal_job_team").delete()
    .eq("job_id", jobId).eq("member_id", memberId).eq("role", role);
  revalidatePath(`/talent/jobs/${jobId}`);
}

export async function setTargetCompany(jobId: string, companyId: string, status: string | null) {
  const { supabase, me } = await ctx();
  if (status === null) {
    await supabase.from("tal_job_target_companies").delete()
      .eq("job_id", jobId).eq("company_id", companyId);
  } else {
    await supabase.from("tal_job_target_companies")
      .upsert({ job_id: jobId, company_id: companyId, status, created_by: me });
  }
  revalidatePath(`/talent/jobs/${jobId}`);
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

/**
 * Puts a person on a job, in the first stage of its workflow.
 *
 * Adding somebody who is already there is not an error worth stopping for --
 * it happens constantly when two recruiters work the same search -- so the
 * existing row is returned instead.
 */
export async function addCandidate(
  jobId: string,
  personId: string,
  opts: { source?: string; source_detail?: string; stageId?: string } = {}
): Promise<
  { ok: true; id: string; alreadyThere: boolean } | { ok: false; error: string }
> {
  try {
    const { supabase, me } = await ctx();

    const { data: existing } = await supabase
      .from("tal_candidates").select("id").eq("job_id", jobId).eq("person_id", personId).maybeSingle();
    if (existing) return { ok: true, id: (existing as { id: string }).id, alreadyThere: true };

    let stageId = opts.stageId;
    if (!stageId) {
      const { data: job } = await supabase
        .from("tal_jobs").select("workflow_id").eq("id", jobId).maybeSingle();
      const workflowId = (job as { workflow_id: string | null } | null)?.workflow_id;
      if (workflowId) {
        const { data: stage } = await supabase
          .from("tal_workflow_stages").select("id").eq("workflow_id", workflowId)
          .order("position").limit(1).maybeSingle();
        stageId = (stage as { id: string } | null)?.id;
      }
    }

    const { data, error } = await supabase
      .from("tal_candidates")
      .insert({
        job_id: jobId, person_id: personId, stage_id: stageId ?? null,
        source: opts.source ?? "sourced", source_detail: opts.source_detail ?? null,
        owner_member_id: me, added_by: me,
        position: Date.now(),
      })
      .select("id")
      .single();
    if (error) return { ok: false, error: `Could not add them to this job: ${error.message}` };

    revalidatePath(`/talent/jobs/${jobId}`);
    revalidatePath(`/talent/people/${personId}`);
    return { ok: true, id: (data as { id: string }).id, alreadyThere: false };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not add them to this job" };
  }
}

/**
 * The only place a candidate's stage changes.
 *
 * The database trigger writes the history row; this adds the human-readable
 * note to the timeline, and moving into a stage marked `placed` sets the
 * candidate to hired so the two can never disagree.
 */
export async function moveCandidate(
  candidateId: string,
  stageId: string,
  position?: number
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { supabase } = await ctx();

    const { data: before } = await supabase
      .from("tal_candidates")
      .select("job_id, person_id, stage_id, status, tal_workflow_stages(name)")
      .eq("id", candidateId).maybeSingle();
    const prior = before as {
      job_id: string; person_id: string; stage_id: string | null; status: string;
      tal_workflow_stages: { name: string } | null;
    } | null;
    if (!prior) return { ok: false, error: "That candidate is no longer on this job" };

    const { data: target } = await supabase
      .from("tal_workflow_stages").select("name,kind").eq("id", stageId).maybeSingle();
    const stage = target as { name: string; kind: string } | null;

    const status =
      stage?.kind === "placed" ? "hired" :
      stage?.kind === "rejected" ? "rejected" :
      prior.status === "hired" || prior.status === "rejected" ? "active" : prior.status;

    const { error } = await supabase
      .from("tal_candidates")
      .update({
        stage_id: stageId,
        status,
        position: position ?? Date.now(),
        rejected_at: stage?.kind === "rejected" ? new Date().toISOString() : null,
      })
      .eq("id", candidateId);
    if (error) return { ok: false, error: `Could not move them: ${error.message}` };

    await logActivity({
      typeSlug: "stage-change",
      person_id: prior.person_id,
      job_id: prior.job_id,
      candidate_id: candidateId,
      subject: `${prior.tal_workflow_stages?.name ?? "Added"} → ${stage?.name ?? "?"}`,
    });

    revalidatePath(`/talent/jobs/${prior.job_id}`);
    revalidatePath(`/talent/people/${prior.person_id}`);
    revalidatePath("/talent/pipeline");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not move them" };
  }
}

/** Only the order inside a stage, for a board dragged into priority. */
export async function reorderCandidate(candidateId: string, position: number, jobId: string) {
  const { supabase } = await ctx();
  await supabase.from("tal_candidates").update({ position }).eq("id", candidateId);
  revalidatePath(`/talent/jobs/${jobId}`);
}

export async function setCandidateStatus(
  candidateId: string,
  status: string,
  reason?: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { supabase } = await ctx();
    const { data: row } = await supabase
      .from("tal_candidates").select("job_id,person_id").eq("id", candidateId).maybeSingle();
    const c = row as { job_id: string; person_id: string } | null;

    const { error } = await supabase
      .from("tal_candidates")
      .update({
        status,
        rejection_reason: status === "rejected" ? reason ?? null : null,
        rejected_at: status === "rejected" ? new Date().toISOString() : null,
      })
      .eq("id", candidateId);
    if (error) return { ok: false, error: `Could not change that: ${error.message}` };

    if (c) {
      revalidatePath(`/talent/jobs/${c.job_id}`);
      revalidatePath(`/talent/people/${c.person_id}`);
    }
    revalidatePath("/talent/pipeline");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not change that" };
  }
}

export async function rateCandidate(candidateId: string, rating: number | null, jobId: string) {
  const { supabase } = await ctx();
  await supabase.from("tal_candidates").update({ rating }).eq("id", candidateId);
  revalidatePath(`/talent/jobs/${jobId}`);
}

export async function removeCandidate(candidateId: string, jobId: string) {
  const { supabase } = await ctx();
  const { error } = await supabase.from("tal_candidates").delete().eq("id", candidateId);
  if (error) throw new Error(`Could not remove them: ${error.message}`);
  revalidatePath(`/talent/jobs/${jobId}`);
}

/** Loxo's "move to a different job": the same person, a different search. */
export async function moveCandidateToJob(candidateId: string, targetJobId: string) {
  const { supabase } = await ctx();
  const { data: row } = await supabase
    .from("tal_candidates").select("person_id, job_id, source").eq("id", candidateId).maybeSingle();
  const c = row as { person_id: string; job_id: string; source: string } | null;
  if (!c) throw new Error("That candidate no longer exists");

  await addCandidate(targetJobId, c.person_id, { source: c.source });
  await supabase.from("tal_candidates").delete().eq("id", candidateId);
  revalidatePath(`/talent/jobs/${c.job_id}`);
  revalidatePath(`/talent/jobs/${targetJobId}`);
}

// ---------------------------------------------------------------------------
// Placements
// ---------------------------------------------------------------------------

export async function createPlacement(input: {
  job_id: string;
  candidate_id?: string | null;
  person_id: string;
  company_id?: string | null;
  title?: string | null;
  started_on?: string | null;
  salary?: number | null;
  fee_type?: string;
  fee_percent?: number | null;
  fee_amount?: number | null;
  guarantee_days?: number | null;
  notes?: string | null;
}) {
  const { supabase, me } = await ctx();

  const { data: settings } = await supabase
    .from("tal_settings").select("default_guarantee_days").maybeSingle();
  const guarantee = input.guarantee_days
    ?? (settings as { default_guarantee_days: number } | null)?.default_guarantee_days
    ?? 90;

  // A percentage fee on a known salary is arithmetic, not a second thing to
  // type -- and a typed one that disagrees is an invoice dispute waiting.
  const fee =
    input.fee_amount ??
    (input.fee_type !== "flat" && input.fee_percent && input.salary
      ? Math.round((input.fee_percent / 100) * input.salary)
      : null);

  const { data, error } = await supabase
    .from("tal_placements")
    .insert({
      job_id: input.job_id,
      candidate_id: input.candidate_id || null,
      person_id: input.person_id,
      company_id: input.company_id || null,
      title: input.title ?? null,
      started_on: input.started_on || null,
      status: input.started_on && input.started_on <= new Date().toISOString().slice(0, 10)
        ? "active" : "pending",
      salary: input.salary ?? null,
      fee_type: input.fee_type ?? "percentage",
      fee_percent: input.fee_percent ?? null,
      fee_amount: fee,
      guarantee_days: guarantee,
      notes: input.notes ?? null,
      created_by: me,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Could not record that placement: ${error.message}`);

  if (me) {
    await supabase.from("tal_placement_splits")
      .insert({ placement_id: (data as { id: string }).id, member_id: me, role: "recruiter", percent: 100 });
  }

  await logActivity({
    typeSlug: "system", person_id: input.person_id, job_id: input.job_id,
    candidate_id: input.candidate_id ?? null, subject: "Placed",
  });

  revalidatePath("/talent/placements");
  revalidatePath(`/talent/jobs/${input.job_id}`);
  return (data as { id: string }).id;
}

export async function updatePlacement(placementId: string, patch: Record<string, unknown>) {
  const { supabase } = await ctx();
  const allowed = new Set([
    "status", "started_on", "ended_on", "salary", "fee_type", "fee_percent",
    "fee_amount", "bill_rate", "pay_rate", "invoice_status", "invoiced_on",
    "paid_on", "notes", "fell_off_on", "fell_off_reason", "guarantee_days", "title",
  ]);
  const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.has(k)));
  if (!Object.keys(clean).length) return;

  const { error } = await supabase.from("tal_placements").update(clean).eq("id", placementId);
  if (error) throw new Error(`Could not save: ${error.message}`);
  revalidatePath("/talent/placements");
}

export async function setPlacementSplit(
  placementId: string,
  memberId: string,
  role: string,
  percent: number | null
) {
  const { supabase } = await ctx();
  if (percent === null) {
    await supabase.from("tal_placement_splits").delete()
      .eq("placement_id", placementId).eq("member_id", memberId).eq("role", role);
  } else {
    await supabase.from("tal_placement_splits")
      .upsert({ placement_id: placementId, member_id: memberId, role, percent });
  }
  revalidatePath("/talent/placements");
}

// ---------------------------------------------------------------------------
// Deals
// ---------------------------------------------------------------------------

export async function saveDeal(input: {
  id?: string;
  name: string;
  company_id?: string | null;
  contact_person_id?: string | null;
  owner_member_id?: string | null;
  stage?: string;
  value?: number | null;
  probability?: number | null;
  expected_close_on?: string | null;
  source?: string | null;
  notes?: string | null;
}) {
  const { supabase, me } = await ctx();
  if (!input.name?.trim()) throw new Error("A name is required");

  const stage = input.stage ?? "new";
  const row = {
    name: input.name.trim(),
    company_id: input.company_id || null,
    contact_person_id: input.contact_person_id || null,
    owner_member_id: input.owner_member_id ?? me,
    stage,
    // Status follows the stage rather than being a second thing to remember.
    status: stage === "won" ? "won" : stage === "lost" ? "lost" : "open",
    closed_at: stage === "won" || stage === "lost" ? new Date().toISOString() : null,
    value: input.value ?? null,
    probability: input.probability ?? null,
    expected_close_on: input.expected_close_on || null,
    source: input.source ?? null,
    notes: input.notes ?? null,
  };

  const { data, error } = input.id
    ? await supabase.from("tal_deals").update(row).eq("id", input.id).select("id").single()
    : await supabase.from("tal_deals").insert({ ...row, created_by: me }).select("id").single();
  if (error) throw new Error(`Could not save that deal: ${error.message}`);

  revalidatePath("/talent/deals");
  return (data as { id: string }).id;
}

export async function setDealStage(
  dealId: string,
  stage: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { supabase } = await ctx();
    const { error } = await supabase
      .from("tal_deals")
      .update({
        stage,
        status: stage === "won" ? "won" : stage === "lost" ? "lost" : "open",
        closed_at: stage === "won" || stage === "lost" ? new Date().toISOString() : null,
      })
      .eq("id", dealId);
    if (error) return { ok: false, error: `Could not move that deal: ${error.message}` };
    revalidatePath("/talent/deals");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not move that deal" };
  }
}
