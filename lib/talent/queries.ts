import "server-only";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import type {
  Activity, ActivityType, Company, Integration, Job, JobSummary, Member,
  Person, PersonSummary, PipelineRow, TalentSettings, Task, Workflow, WorkflowStage,
} from "./types";

/**
 * Every read the talent screens do.
 *
 * These go through the signed-in person's own client so the policies on the
 * tables apply, rather than through the service client the older parts of this
 * app reach for. The talent policies are permission-based and identical for
 * every viewer, so there is nothing a service client would unlock and a great
 * deal it would quietly bypass.
 *
 * The service client appears in exactly one place below -- the member list --
 * because org_members is not readable under the talent policies and a recruiter
 * still has to be able to pick an owner.
 */

function db() {
  return createClient();
}

/** Anything that came back null becomes an empty list, never a crash. */
function rows<T>(data: unknown): T[] {
  return (data ?? []) as T[];
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export type PeopleFilter = {
  q?: string;
  type?: string;
  ownerId?: string;
  companyId?: string;
  skill?: string;
  hasEmail?: boolean;
  hasResume?: boolean;
  listId?: string;
  sort?: "recent" | "name" | "readiness" | "added";
  limit?: number;
  offset?: number;
};

export async function listPeople(f: PeopleFilter = {}) {
  const supabase = await db();
  const limit = Math.min(f.limit ?? 50, 200);

  let query = supabase
    .from("tal_person_summary")
    .select("*", { count: "exact" })
    .range(f.offset ?? 0, (f.offset ?? 0) + limit - 1);

  /*
   * Free text searches the flat columns rather than the tsvector, because a
   * recruiter typing three letters of a surname expects a prefix match and
   * full-text search will not give them one. The tsvector earns its keep on the
   * resume-content search below, where prefix matching is not what is wanted.
   */
  if (f.q?.trim()) {
    const term = f.q.trim().replace(/[%,()]/g, " ");
    query = query.or(
      [
        `name.ilike.%${term}%`,
        `primary_email.ilike.%${term}%`,
        `title.ilike.%${term}%`,
        `company.ilike.%${term}%`,
      ].join(",")
    );
  }
  if (f.type) query = query.contains("person_types", [f.type]);
  if (f.skill) query = query.contains("skills", [f.skill]);
  if (f.ownerId) query = query.eq("owner_member_id", f.ownerId);
  if (f.companyId) query = query.eq("company_id", f.companyId);
  if (f.hasEmail) query = query.not("primary_email", "is", null);
  if (f.hasResume) query = query.gt("resume_count", 0);

  switch (f.sort) {
    case "name": query = query.order("name"); break;
    case "readiness": query = query.order("readiness_score", { ascending: false, nullsFirst: false }); break;
    case "added": query = query.order("created_at", { ascending: false }); break;
    default: query = query.order("last_activity_at", { ascending: false, nullsFirst: false })
                          .order("created_at", { ascending: false });
  }

  const { data, count, error } = await query;
  if (error) throw new Error(`Could not load people: ${error.message}`);
  return { people: rows<PersonSummary>(data), total: count ?? 0 };
}

/**
 * Resume-content search, which is a different question from the name search
 * above: "who have we got who has actually done this". Kept separate so the
 * two never quietly become one slow query.
 */
export async function searchResumes(term: string, limit = 50) {
  if (!term.trim()) return [];
  const supabase = await db();
  const { data, error } = await supabase
    .from("tal_people")
    .select("id,name,title,company_name,primary_email,city,state,skills,last_activity_at")
    .textSearch("search_tsv", term.trim(), { type: "websearch", config: "english" })
    .is("merged_into_id", null)
    .limit(limit);
  if (error) throw new Error(`Resume search failed: ${error.message}`);
  return rows<{
    id: string; name: string; title: string | null; company_name: string | null;
    primary_email: string | null; city: string | null; state: string | null;
    skills: string[]; last_activity_at: string | null;
  }>(data);
}

export async function getPerson(personId: string) {
  const supabase = await db();

  const { data: person, error } = await supabase
    .from("tal_people").select("*").eq("id", personId).maybeSingle();
  if (error) throw new Error(`Could not load that person: ${error.message}`);
  if (!person) return null;

  const [history, education, documents, pipelines, activities, tasks, tags, scorecards] =
    await Promise.all([
      supabase.from("tal_person_jobs").select("*").eq("person_id", personId)
        .order("position").order("started_on", { ascending: false }),
      supabase.from("tal_person_educations").select("*").eq("person_id", personId).order("position"),
      supabase.from("tal_documents").select("*").eq("person_id", personId)
        .order("created_at", { ascending: false }),
      supabase.from("tal_master_pipeline").select("*").eq("person_id", personId)
        .order("created_at", { ascending: false }),
      supabase.from("tal_activities")
        .select("*, tal_activity_types(name,slug,category,color)")
        .eq("person_id", personId)
        .order("pinned", { ascending: false })
        .order("occurred_at", { ascending: false })
        .limit(100),
      supabase.from("tal_tasks").select("*").eq("person_id", personId)
        .is("done_at", null).order("due_at", { nullsFirst: false }),
      supabase.from("tal_tag_links").select("tag_id, tal_tags(id,label,color)")
        .eq("entity_type", "person").eq("entity_id", personId),
      supabase.from("tal_scorecards")
        .select("*, tal_jobs(title)").eq("person_id", personId)
        .order("created_at", { ascending: false }),
    ]);

  return {
    person: person as unknown as Person,
    history: rows<Record<string, unknown>>(history.data),
    education: rows<Record<string, unknown>>(education.data),
    documents: rows<Record<string, unknown>>(documents.data),
    pipelines: rows<PipelineRow>(pipelines.data),
    activities: rows<Activity & { tal_activity_types: ActivityType | null }>(activities.data),
    tasks: rows<Task>(tasks.data),
    tags: rows<{ tag_id: string; tal_tags: { id: string; label: string; color: string } | null }>(tags.data)
      .map((t) => t.tal_tags).filter(Boolean) as { id: string; label: string; color: string }[],
    scorecards: rows<Record<string, unknown>>(scorecards.data),
  };
}

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

export async function listCompanies(f: { q?: string; kind?: string; limit?: number } = {}) {
  const supabase = await db();
  let query = supabase
    .from("tal_companies")
    .select("*, tal_people(count), tal_jobs(count)", { count: "exact" })
    .order("name")
    .limit(Math.min(f.limit ?? 200, 500));

  if (f.q?.trim()) {
    const term = f.q.trim().replace(/[%,()]/g, " ");
    query = query.or(`name.ilike.%${term}%,domain.ilike.%${term}%,industry.ilike.%${term}%`);
  }
  if (f.kind) query = query.eq("kind", f.kind);

  const { data, count, error } = await query;
  if (error) throw new Error(`Could not load companies: ${error.message}`);
  return {
    companies: rows<Company & { tal_people: { count: number }[]; tal_jobs: { count: number }[] }>(data),
    total: count ?? 0,
  };
}

export async function getCompany(companyId: string) {
  const supabase = await db();
  const { data: company } = await supabase
    .from("tal_companies").select("*").eq("id", companyId).maybeSingle();
  if (!company) return null;

  const [people, jobs, activities, deals] = await Promise.all([
    supabase.from("tal_person_summary").select("*").eq("company_id", companyId).order("name"),
    supabase.from("tal_job_summary").select("*").eq("company_id", companyId)
      .order("created_at", { ascending: false }),
    supabase.from("tal_activities")
      .select("*, tal_activity_types(name,slug,category,color)")
      .eq("company_id", companyId).order("occurred_at", { ascending: false }).limit(50),
    supabase.from("tal_deals").select("*").eq("company_id", companyId)
      .order("created_at", { ascending: false }),
  ]);

  return {
    company: company as unknown as Company,
    people: rows<PersonSummary>(people.data),
    jobs: rows<JobSummary>(jobs.data),
    activities: rows<Activity & { tal_activity_types: ActivityType | null }>(activities.data),
    deals: rows<Record<string, unknown>>(deals.data),
  };
}

// ---------------------------------------------------------------------------
// Jobs and pipelines
// ---------------------------------------------------------------------------

export async function listJobs(f: { q?: string; status?: string; ownerId?: string; companyId?: string } = {}) {
  const supabase = await db();
  let query = supabase.from("tal_job_summary").select("*");

  if (f.q?.trim()) {
    const term = f.q.trim().replace(/[%,()]/g, " ");
    query = query.or(`title.ilike.%${term}%,company_name.ilike.%${term}%`);
  }
  // "open" is the default view of a jobs list and is three statuses, not one.
  if (f.status === "open" || !f.status) query = query.in("status", ["active", "on_hold", "draft"]);
  else if (f.status !== "all") query = query.eq("status", f.status);
  if (f.ownerId) query = query.eq("owner_member_id", f.ownerId);
  if (f.companyId) query = query.eq("company_id", f.companyId);

  const { data, error } = await query
    .order("status")
    .order("last_activity_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Could not load jobs: ${error.message}`);
  return rows<JobSummary>(data);
}

export async function getJob(jobId: string) {
  const supabase = await db();

  const { data: job, error } = await supabase
    .from("tal_jobs").select("*, tal_companies(id,name,domain,city,state)")
    .eq("id", jobId).maybeSingle();
  if (error) throw new Error(`Could not load that job: ${error.message}`);
  if (!job) return null;

  const workflowId = (job as { workflow_id: string | null }).workflow_id;

  const [stages, candidates, activities, targets, team, submissions, interviews, matches, tasks] =
    await Promise.all([
      workflowId
        ? supabase.from("tal_workflow_stages").select("*").eq("workflow_id", workflowId).order("position")
        : Promise.resolve({ data: [] }),
      supabase.from("tal_master_pipeline").select("*").eq("job_id", jobId)
        .order("stage_position", { nullsFirst: true }).order("created_at", { ascending: false }),
      supabase.from("tal_activities")
        .select("*, tal_activity_types(name,slug,category,color)")
        .eq("job_id", jobId).order("occurred_at", { ascending: false }).limit(60),
      supabase.from("tal_job_target_companies")
        .select("*, tal_companies(id,name,domain,industry,city,state)").eq("job_id", jobId),
      supabase.from("tal_job_team")
        .select("*, org_members!tal_job_team_member_id_fkey(id,full_name,email)").eq("job_id", jobId),
      supabase.from("tal_submissions").select("*, tal_people(id,name,title)")
        .eq("job_id", jobId).order("created_at", { ascending: false }),
      supabase.from("tal_interviews").select("*, tal_people(id,name)")
        .eq("job_id", jobId).order("starts_at", { ascending: false }).limit(50),
      supabase.from("tal_ai_matches").select("*, tal_people(id,name,title,company_name)")
        .eq("job_id", jobId).eq("status", "suggested").order("score", { ascending: false }).limit(25),
      supabase.from("tal_tasks").select("*").eq("job_id", jobId).is("done_at", null)
        .order("due_at", { nullsFirst: false }),
    ]);

  return {
    job: job as unknown as Job & { tal_companies: { id: string; name: string } | null },
    stages: rows<WorkflowStage>(stages.data),
    candidates: rows<PipelineRow>(candidates.data),
    activities: rows<Activity & { tal_activity_types: ActivityType | null }>(activities.data),
    targets: rows<Record<string, unknown>>(targets.data),
    team: rows<Record<string, unknown>>(team.data),
    submissions: rows<Record<string, unknown>>(submissions.data),
    interviews: rows<Record<string, unknown>>(interviews.data),
    matches: rows<Record<string, unknown>>(matches.data),
    tasks: rows<Task>(tasks.data),
  };
}

export type PipelineFilter = {
  ownerId?: string;
  stageKind?: string;
  jobId?: string;
  stale?: boolean;
  status?: string;
};

/** Loxo's Master Pipeline: everything live, across every search. */
export async function masterPipeline(f: PipelineFilter = {}) {
  const supabase = await db();
  let query = supabase.from("tal_master_pipeline").select("*");

  query = f.status && f.status !== "all"
    ? query.eq("status", f.status)
    : query.eq("status", "active");

  if (f.ownerId) query = query.eq("owner_member_id", f.ownerId);
  if (f.stageKind) query = query.eq("stage_kind", f.stageKind);
  if (f.jobId) query = query.eq("job_id", f.jobId);
  // Stale is the whole reason this screen exists: who has nobody looked at.
  if (f.stale) query = query.gte("days_since_touch", 7);

  const { data, error } = await query
    .order("days_since_touch", { ascending: false })
    .limit(500);
  if (error) throw new Error(`Could not load the pipeline: ${error.message}`);
  return rows<PipelineRow>(data);
}

export async function listWorkflows() {
  const supabase = await db();
  const [{ data: workflows }, { data: stages }] = await Promise.all([
    supabase.from("tal_workflows").select("*").order("name"),
    supabase.from("tal_workflow_stages").select("*").order("position"),
  ]);
  const byWorkflow = new Map<string, WorkflowStage[]>();
  for (const s of rows<WorkflowStage>(stages)) {
    byWorkflow.set(s.workflow_id, [...(byWorkflow.get(s.workflow_id) ?? []), s]);
  }
  return rows<Workflow>(workflows).map((w) => ({ ...w, stages: byWorkflow.get(w.id) ?? [] }));
}

// ---------------------------------------------------------------------------
// Work in flight
// ---------------------------------------------------------------------------

export async function listTasks(f: { memberId?: string; openOnly?: boolean } = {}) {
  const supabase = await db();
  let query = supabase
    .from("tal_tasks")
    .select("*, tal_people(id,name), tal_jobs(id,title), tal_companies(id,name)")
    .order("due_at", { nullsFirst: false });
  if (f.memberId) query = query.eq("assigned_member_id", f.memberId);
  if (f.openOnly !== false) query = query.is("done_at", null);
  const { data } = await query.limit(300);
  return rows<Record<string, unknown>>(data);
}

export async function listInterviews(f: { from?: string; to?: string; memberId?: string } = {}) {
  const supabase = await db();
  let query = supabase
    .from("tal_interviews")
    /*
     * Named explicitly: tal_interviews points at org_members twice, through
     * organizer_member_id and created_by, and an unqualified embed is rejected
     * as ambiguous rather than picking one.
     */
    .select(
      "*, tal_people(id,name,title), tal_jobs(id,title)," +
      "org_members!tal_interviews_organizer_member_id_fkey(full_name)"
    )
    .order("starts_at");
  if (f.from) query = query.gte("starts_at", f.from);
  if (f.to) query = query.lte("starts_at", f.to);
  if (f.memberId) query = query.eq("organizer_member_id", f.memberId);
  const { data } = await query.limit(300);
  return rows<Record<string, unknown>>(data);
}

export async function listPlacements(f: { status?: string } = {}) {
  const supabase = await db();
  let query = supabase
    .from("tal_placements")
    .select("*, tal_people(id,name), tal_jobs(id,title), tal_companies(id,name), tal_placement_splits(member_id,role,percent)")
    .order("started_on", { ascending: false, nullsFirst: false });
  if (f.status && f.status !== "all") query = query.eq("status", f.status);
  const { data } = await query.limit(300);
  return rows<Record<string, unknown>>(data);
}

export async function listDeals(f: { status?: string } = {}) {
  const supabase = await db();
  let query = supabase
    .from("tal_deals")
    // Same two-paths problem as interviews: owner_member_id and created_by.
    .select(
      "*, tal_companies(id,name), tal_people(id,name)," +
      "org_members!tal_deals_owner_member_id_fkey(full_name)"
    )
    .order("expected_close_on", { nullsFirst: false });
  query = f.status && f.status !== "all" ? query.eq("status", f.status) : query.eq("status", "open");
  const { data } = await query.limit(300);
  return rows<Record<string, unknown>>(data);
}

export async function listCampaigns() {
  const supabase = await db();
  const { data } = await supabase
    .from("tal_campaigns")
    .select("*, tal_jobs(id,title), tal_campaign_steps(count), tal_campaign_members(count)")
    .order("created_at", { ascending: false });
  return rows<Record<string, unknown>>(data);
}

export async function getCampaign(campaignId: string) {
  const supabase = await db();
  const [{ data: campaign }, { data: steps }, { data: members }, { data: sends }] = await Promise.all([
    supabase.from("tal_campaigns").select("*, tal_jobs(id,title)").eq("id", campaignId).maybeSingle(),
    supabase.from("tal_campaign_steps").select("*").eq("campaign_id", campaignId).order("position"),
    supabase.from("tal_campaign_members")
      .select("*, tal_people(id,name,title,primary_email,do_not_contact)")
      .eq("campaign_id", campaignId).order("enrolled_at", { ascending: false }).limit(500),
    // The prepared queue, which is what the send button acts on.
    supabase.from("tal_campaign_sends")
      .select("id,status,to_address,subject,sent_at,tal_campaign_members!inner(campaign_id)")
      .eq("tal_campaign_members.campaign_id", campaignId)
      .order("created_at", { ascending: false }).limit(500),
  ]);
  if (!campaign) return null;
  return {
    campaign: campaign as Record<string, unknown>,
    steps: rows<Record<string, unknown>>(steps),
    members: rows<Record<string, unknown>>(members),
    sends: rows<Record<string, unknown>>(sends),
  };
}

export async function listApplications(f: { status?: string } = {}) {
  const supabase = await db();
  let query = supabase
    .from("tal_applications")
    .select("*, tal_jobs(id,title,public_slug)")
    .order("created_at", { ascending: false });
  query = f.status && f.status !== "all" ? query.eq("status", f.status) : query.eq("status", "new");
  const { data } = await query.limit(300);
  return rows<Record<string, unknown>>(data);
}

export async function listLists(entity?: string) {
  const supabase = await db();
  let query = supabase
    .from("tal_lists")
    .select("*, tal_list_members(count), org_members!tal_lists_owner_member_id_fkey(full_name)")
    .order("name");
  if (entity) query = query.eq("entity", entity);
  const { data } = await query;
  return rows<Record<string, unknown>>(data);
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

export async function jobFunnel(jobId: string) {
  const supabase = await db();
  const { data, error } = await supabase.rpc("tal_job_funnel", { p_job_id: jobId });
  if (error) throw new Error(`Could not build the funnel: ${error.message}`);
  return rows<{
    stage_id: string; stage_name: string; stage_kind: string; stage_position: number;
    reached: number; still_there: number; median_days: number | null;
  }>(data);
}

export async function activityReport(from: string, to: string) {
  const supabase = await db();
  const { data, error } = await supabase.rpc("tal_activity_report", { p_from: from, p_to: to });
  if (error) throw new Error(`Could not build the activity report: ${error.message}`);
  return rows<{
    member_id: string; member_name: string | null; calls: number; emails: number;
    meetings: number; notes: number; submissions: number; placements: number; total: number;
  }>(data);
}

export async function duplicatePeople() {
  const supabase = await db();
  const { data, error } = await supabase.rpc("tal_duplicate_people");
  if (error) throw new Error(`Could not check for duplicates: ${error.message}`);
  return rows<{
    a_id: string; a_name: string; a_email: string | null; a_created: string;
    b_id: string; b_name: string; b_email: string | null; b_created: string;
    basis: string; confidence: string;
  }>(data);
}

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

export async function listActivityTypes() {
  const supabase = await db();
  const { data } = await supabase
    .from("tal_activity_types").select("*").eq("active", true).order("position");
  return rows<ActivityType>(data);
}

export async function getSettings(): Promise<TalentSettings> {
  const supabase = await db();
  const { data } = await supabase.from("tal_settings").select("*").maybeSingle();
  return (data ?? {
    agency_name: "Factur", careers_page_enabled: false, careers_page_heading: "Open roles",
    careers_page_intro: null, careers_apply_email: null, default_workflow_id: null,
    default_guarantee_days: 90, outreach_mode: "semi", duplicate_check_on_add: true,
  }) as TalentSettings;
}

export async function listIntegrations(): Promise<Integration[]> {
  const supabase = await db();
  const { data } = await supabase.from("tal_integrations").select("*").order("position");
  return rows<Integration>(data);
}

/**
 * One integration's state, for a feature that has to decide whether to work or
 * to explain itself. Returns a not-connected shell for an unknown slug so a
 * caller never has to handle null.
 */
export async function integrationStatus(slug: string): Promise<Integration> {
  const all = await listIntegrations();
  return (
    all.find((i) => i.slug === slug) ?? {
      slug, name: slug, category: "Unknown", powers: "", status: "not_connected",
      requires: null, config: {}, last_error: null, connected_at: null,
    }
  );
}

/**
 * The people who can own a record. org_members sits outside the talent
 * policies, so this is the one read that uses the service client -- picking an
 * owner must not depend on the recruiter also being allowed to read the org
 * chart.
 */
export async function listMembers(): Promise<Member[]> {
  const { data } = await createServiceClient()
    .from("org_members").select("id,full_name,email").eq("active", true).order("full_name");
  return rows<Member>(data);
}

export async function listTags(scope?: string) {
  const supabase = await db();
  let query = supabase.from("tal_tags").select("*").order("label");
  if (scope) query = query.in("scope", [scope, "all"]);
  const { data } = await query;
  return rows<{ id: string; label: string; color: string; scope: string }>(data);
}

export async function listNoteTemplates(scope?: string) {
  const supabase = await db();
  let query = supabase.from("tal_note_templates").select("*").eq("active", true).order("position");
  if (scope) query = query.eq("scope", scope);
  const { data } = await query;
  return rows<{ id: string; name: string; scope: string; body: string }>(data);
}

export async function listEmailTemplates(audience?: string) {
  const supabase = await db();
  let query = supabase.from("tal_email_templates").select("*").eq("active", true).order("name");
  if (audience) query = query.eq("audience", audience);
  const { data } = await query;
  return rows<{ id: string; name: string; audience: string; subject: string; body: string }>(data);
}

/**
 * The talent home screen in one round of queries: what is mine, what is late,
 * and what is happening today.
 */
export async function todayFor(memberId: string | null) {
  const supabase = await db();
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const endOfWeek = new Date(); endOfWeek.setDate(endOfWeek.getDate() + 7);

  const [tasks, interviews, stale, mine, applications, submissions] = await Promise.all([
    memberId
      ? supabase.from("tal_tasks")
          .select("*, tal_people(id,name), tal_jobs(id,title)")
          .eq("assigned_member_id", memberId).is("done_at", null)
          .order("due_at", { nullsFirst: false }).limit(25)
      : Promise.resolve({ data: [] }),
    supabase.from("tal_interviews")
      .select("*, tal_people(id,name), tal_jobs(id,title)")
      .gte("starts_at", startOfDay.toISOString())
      .lte("starts_at", endOfWeek.toISOString())
      .eq("status", "scheduled").order("starts_at").limit(25),
    memberId
      ? supabase.from("tal_master_pipeline").select("*")
          .eq("owner_member_id", memberId).eq("status", "active")
          .gte("days_since_touch", 7).order("days_since_touch", { ascending: false }).limit(25)
      : Promise.resolve({ data: [] }),
    memberId
      ? supabase.from("tal_job_summary").select("*")
          .eq("owner_member_id", memberId).in("status", ["active", "on_hold"])
          .order("last_activity_at", { ascending: false, nullsFirst: false }).limit(15)
      : Promise.resolve({ data: [] }),
    supabase.from("tal_applications").select("id", { count: "exact", head: true }).eq("status", "new"),
    supabase.from("tal_submissions").select("*, tal_people(name), tal_jobs(title)")
      .in("status", ["shared", "viewed"]).order("shared_at", { ascending: false }).limit(10),
  ]);

  return {
    tasks: rows<Record<string, unknown>>(tasks.data),
    interviews: rows<Record<string, unknown>>(interviews.data),
    stale: rows<PipelineRow>(stale.data),
    jobs: rows<JobSummary>(mine.data),
    newApplications: applications.count ?? 0,
    awaitingFeedback: rows<Record<string, unknown>>(submissions.data),
  };
}

/**
 * Factur's own client list, so a talent company can be pointed at the client it
 * already is. Read through the service client for the same reason as members:
 * org_clients is governed by the app's own rules, not the talent ones.
 */
export async function listOrgClients(): Promise<{ id: string; name: string }[]> {
  const { data } = await createServiceClient()
    .from("org_clients").select("id,name").eq("active", true).order("name");
  return rows<{ id: string; name: string }>(data);
}
