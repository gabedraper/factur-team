"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { currentMemberId } from "@/lib/org";
import { assertTalent } from "@/lib/talent/access";
import { splitName } from "@/lib/talent/format";
import type { Contact } from "@/lib/talent/types";

/**
 * Writes against people, companies and the activity timeline.
 *
 * Every one of these asserts the permission itself rather than trusting the
 * page that rendered the button, and every one goes through the caller's own
 * client so the policies apply a second time underneath. Belt and braces on
 * purpose: a server action is a public HTTP endpoint.
 */

async function ctx() {
  await assertTalent("recruit");
  return { supabase: await createClient(), me: await currentMemberId() };
}

/** Turns "a@b.com, c@d.com" into the jsonb array the column holds. */
function toContacts(raw: string | null | undefined, type = "work"): Contact[] {
  if (!raw?.trim()) return [];
  return raw
    .split(/[,;\n]/)
    .map((v) => v.trim())
    .filter(Boolean)
    .map((value, i) => ({ value, type, primary: i === 0 }));
}

function toList(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  return [...new Set(raw.split(/[,;\n]/).map((v) => v.trim()).filter(Boolean))];
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export type PersonInput = {
  first_name?: string | null;
  last_name?: string | null;
  /** Used by the quick-add box, which asks for one name field. */
  full_name?: string | null;
  title?: string | null;
  company_id?: string | null;
  company_name?: string | null;
  emails?: string | null;
  phones?: string | null;
  linkedin_url?: string | null;
  github_url?: string | null;
  personal_website?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  person_types?: string[];
  skills?: string | null;
  summary?: string | null;
  seniority?: string | null;
  years_experience?: number | null;
  current_salary?: number | null;
  salary_expectation?: number | null;
  compensation_notes?: string | null;
  source?: string;
  source_detail?: string | null;
  owner_member_id?: string | null;
  do_not_contact?: boolean;
};

function personRow(input: PersonInput, me: string | null) {
  const split = input.full_name ? splitName(input.full_name) : null;
  return {
    first_name: input.first_name ?? split?.first ?? null,
    last_name: input.last_name ?? split?.last ?? null,
    title: input.title ?? null,
    company_id: input.company_id || null,
    company_name: input.company_name ?? null,
    emails: toContacts(input.emails),
    phones: toContacts(input.phones, "mobile"),
    linkedin_url: input.linkedin_url ?? null,
    github_url: input.github_url ?? null,
    personal_website: input.personal_website ?? null,
    city: input.city ?? null,
    state: input.state ?? null,
    country: input.country ?? null,
    person_types: input.person_types?.length ? input.person_types : ["candidate"],
    skills: toList(input.skills),
    summary: input.summary ?? null,
    seniority: input.seniority ?? null,
    years_experience: input.years_experience ?? null,
    current_salary: input.current_salary ?? null,
    salary_expectation: input.salary_expectation ?? null,
    compensation_notes: input.compensation_notes ?? null,
    source: input.source ?? "manual",
    source_detail: input.source_detail ?? null,
    owner_member_id: input.owner_member_id ?? me,
    do_not_contact: input.do_not_contact ?? false,
  };
}

/**
 * Before writing a new person, say who they might already be.
 *
 * This is offered rather than enforced. Two people genuinely do share a name,
 * and a system that refuses the second one teaches recruiters to type a
 * middle initial to get past it -- which is worse than a duplicate.
 */
export async function findPossibleDuplicates(input: { emails?: string | null; full_name?: string | null; linkedin_url?: string | null }) {
  await assertTalent("view");
  const supabase = await createClient();
  const email = toContacts(input.emails)[0]?.value?.toLowerCase();
  const name = input.full_name?.trim();

  const clauses: string[] = [];
  if (email) clauses.push(`primary_email.eq.${email}`);
  if (input.linkedin_url?.trim()) clauses.push(`linkedin_url.ilike.${input.linkedin_url.trim()}`);
  if (name) clauses.push(`name.ilike.${name}`);
  if (!clauses.length) return [];

  const { data } = await supabase
    .from("tal_person_summary")
    .select("id,name,title,company,primary_email,last_activity_at")
    .or(clauses.join(","))
    .limit(5);
  return (data ?? []) as { id: string; name: string; title: string | null; company: string | null; primary_email: string | null; last_activity_at: string | null }[];
}

export async function createPerson(
  input: PersonInput
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const { supabase, me } = await ctx();
    const row = personRow(input, me);
    if (!row.first_name && !row.last_name) throw new Error("A name is required");

    const { data, error } = await supabase
      .from("tal_people")
      .insert({ ...row, created_by: me })
      .select("id")
      .single();
    if (error) throw new Error(`Could not add that person: ${error.message}`);

    const id = (data as { id: string }).id;
    await scoreReadiness(id);
    revalidatePath("/talent/people");
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not add that person." };
  }
}

export async function updatePerson(personId: string, input: PersonInput) {
  const { supabase, me } = await ctx();
  const row = personRow(input, me);
  // The owner is only reassigned when the form actually said so, otherwise
  // editing a phone number would quietly take the record off its recruiter.
  if (input.owner_member_id === undefined) delete (row as Record<string, unknown>).owner_member_id;

  const { error } = await supabase.from("tal_people").update(row).eq("id", personId);
  if (error) throw new Error(`Could not save that person: ${error.message}`);

  await scoreReadiness(personId);
  revalidatePath(`/talent/people/${personId}`);
  revalidatePath("/talent/people");
}

/** A single field edited in place, which is how most of a profile gets filled in. */
export async function setPersonField(personId: string, field: string, value: unknown) {
  const { supabase } = await ctx();
  const allowed = new Set([
    "title", "company_name", "company_id", "city", "state", "country", "summary",
    "linkedin_url", "github_url", "personal_website", "seniority", "years_experience",
    "current_salary", "salary_expectation", "compensation_notes", "do_not_contact",
    "owner_member_id", "person_types", "skills", "resume_text",
  ]);
  if (!allowed.has(field)) throw new Error(`${field} is not editable here`);

  const { error } = await supabase.from("tal_people").update({ [field]: value }).eq("id", personId);
  if (error) throw new Error(`Could not save: ${error.message}`);
  await scoreReadiness(personId);
  revalidatePath(`/talent/people/${personId}`);
}

export async function setPersonContacts(
  personId: string,
  kind: "emails" | "phones",
  values: Contact[]
) {
  const { supabase } = await ctx();
  // The first entry is the primary one, because that is what the generated
  // column reads. Reordering here is how somebody changes it.
  const cleaned = values.filter((v) => v.value?.trim()).map((v) => ({ ...v, value: v.value.trim() }));
  const { error } = await supabase.from("tal_people").update({ [kind]: cleaned }).eq("id", personId);
  if (error) throw new Error(`Could not save contact details: ${error.message}`);
  await scoreReadiness(personId);
  revalidatePath(`/talent/people/${personId}`);
}

async function scoreReadiness(personId: string) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("tal_readiness_score", { p_person_id: personId });
  if (typeof data === "number") {
    await supabase.from("tal_people").update({ readiness_score: data }).eq("id", personId);
  }
}

export async function refreshAllReadiness() {
  await assertTalent("recruit");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("tal_refresh_readiness");
  if (error) throw new Error(`Could not recalculate: ${error.message}`);
  revalidatePath("/talent/people");
  return (data as number) ?? 0;
}

export async function mergePeople(
  keepId: string,
  mergeId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await assertTalent("recruit");
    const supabase = await createClient();
    const { error } = await supabase.rpc("tal_merge_people", { p_keep: keepId, p_merge: mergeId });
    if (error) throw new Error(`Could not merge: ${error.message}`);
    revalidatePath("/talent/people");
    revalidatePath("/talent/duplicates");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not merge." };
  }
}

// ---------------------------------------------------------------------------
// Work history and education
// ---------------------------------------------------------------------------

export async function saveWorkHistory(
  personId: string,
  entry: {
    id?: string; company_name?: string | null; company_id?: string | null;
    title?: string | null; started_on?: string | null; ended_on?: string | null;
    is_current?: boolean; description?: string | null; location?: string | null;
  }
) {
  const { supabase } = await ctx();
  const row = {
    person_id: personId,
    company_name: entry.company_name ?? null,
    company_id: entry.company_id || null,
    title: entry.title ?? null,
    started_on: entry.started_on || null,
    ended_on: entry.is_current ? null : entry.ended_on || null,
    is_current: entry.is_current ?? false,
    description: entry.description ?? null,
    location: entry.location ?? null,
  };
  const { error } = entry.id
    ? await supabase.from("tal_person_jobs").update(row).eq("id", entry.id)
    : await supabase.from("tal_person_jobs").insert(row);
  if (error) throw new Error(`Could not save that role: ${error.message}`);
  await scoreReadiness(personId);
  revalidatePath(`/talent/people/${personId}`);
}

export async function deleteWorkHistory(personId: string, id: string) {
  const { supabase } = await ctx();
  await supabase.from("tal_person_jobs").delete().eq("id", id);
  revalidatePath(`/talent/people/${personId}`);
}

export async function saveEducation(
  personId: string,
  entry: {
    id?: string; school?: string | null; degree?: string | null;
    field_of_study?: string | null; started_on?: string | null; ended_on?: string | null;
  }
) {
  const { supabase } = await ctx();
  const row = {
    person_id: personId,
    school: entry.school ?? null,
    degree: entry.degree ?? null,
    field_of_study: entry.field_of_study ?? null,
    started_on: entry.started_on || null,
    ended_on: entry.ended_on || null,
  };
  const { error } = entry.id
    ? await supabase.from("tal_person_educations").update(row).eq("id", entry.id)
    : await supabase.from("tal_person_educations").insert(row);
  if (error) throw new Error(`Could not save that qualification: ${error.message}`);
  revalidatePath(`/talent/people/${personId}`);
}

export async function deleteEducation(personId: string, id: string) {
  const { supabase } = await ctx();
  await supabase.from("tal_person_educations").delete().eq("id", id);
  revalidatePath(`/talent/people/${personId}`);
}

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

export type CompanyInput = {
  name: string;
  domain?: string | null;
  website?: string | null;
  linkedin_url?: string | null;
  industry?: string | null;
  headcount_label?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  phone?: string | null;
  description?: string | null;
  kind?: string;
  status?: string;
  org_client_id?: string | null;
  owner_member_id?: string | null;
};

function companyRow(input: CompanyInput, me: string | null) {
  return {
    name: input.name.trim(),
    // A domain is the only reliable key a company has, so it is normalised
    // rather than stored as typed -- "https://Acme.com/" and "acme.com" are
    // the same company and the unique index has to agree.
    domain: input.domain?.trim()
      ? input.domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]
      : null,
    website: input.website?.trim() || null,
    linkedin_url: input.linkedin_url?.trim() || null,
    industry: input.industry ?? null,
    headcount_label: input.headcount_label ?? null,
    city: input.city ?? null,
    state: input.state ?? null,
    country: input.country ?? null,
    phone: input.phone ?? null,
    description: input.description ?? null,
    kind: input.kind ?? "prospect",
    status: input.status ?? "active",
    org_client_id: input.org_client_id || null,
    owner_member_id: input.owner_member_id ?? me,
  };
}

export async function createCompany(
  input: CompanyInput
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const { supabase, me } = await ctx();
    if (!input.name?.trim()) throw new Error("A company name is required");

    const { data, error } = await supabase
      .from("tal_companies")
      .insert({ ...companyRow(input, me), created_by: me })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") throw new Error("A company with that domain is already here");
      throw new Error(`Could not add that company: ${error.message}`);
    }
    revalidatePath("/talent/companies");
    return { ok: true, id: (data as { id: string }).id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not add that company." };
  }
}

export async function updateCompany(
  companyId: string,
  input: CompanyInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { supabase, me } = await ctx();
    const { error } = await supabase.from("tal_companies").update(companyRow(input, me)).eq("id", companyId);
    if (error) throw new Error(`Could not save that company: ${error.message}`);
    revalidatePath(`/talent/companies/${companyId}`);
    revalidatePath("/talent/companies");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save that company." };
  }
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

export type ActivityInput = {
  typeSlug: string;
  subject?: string | null;
  body?: string | null;
  direction?: "inbound" | "outbound" | null;
  outcome?: string | null;
  occurred_at?: string | null;
  person_id?: string | null;
  company_id?: string | null;
  job_id?: string | null;
  candidate_id?: string | null;
  deal_id?: string | null;
  metadata?: Record<string, unknown>;
};

/**
 * The one way anything gets onto a timeline.
 *
 * Callers name the activity type by slug rather than by id, so a note logged
 * from a person page and one logged by an automation land on the same type and
 * count the same way in the activity report.
 */
export async function logActivity(
  input: ActivityInput
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const { supabase, me } = await ctx();

    const { data: type } = await supabase
      .from("tal_activity_types").select("id").eq("slug", input.typeSlug).maybeSingle();

    const { data, error } = await supabase
      .from("tal_activities")
      .insert({
        activity_type_id: (type as { id: string } | null)?.id ?? null,
        person_id: input.person_id || null,
        company_id: input.company_id || null,
        job_id: input.job_id || null,
        candidate_id: input.candidate_id || null,
        deal_id: input.deal_id || null,
        subject: input.subject ?? null,
        body: input.body ?? null,
        direction: input.direction ?? null,
        outcome: input.outcome ?? null,
        occurred_at: input.occurred_at || new Date().toISOString(),
        metadata: input.metadata ?? {},
        created_by: me,
      })
      .select("id")
      .single();
    if (error) throw new Error(`Could not log that: ${error.message}`);

    if (input.person_id) revalidatePath(`/talent/people/${input.person_id}`);
    if (input.job_id) revalidatePath(`/talent/jobs/${input.job_id}`);
    if (input.company_id) revalidatePath(`/talent/companies/${input.company_id}`);
    return { ok: true, id: (data as { id: string }).id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not log that." };
  }
}

export async function pinActivity(activityId: string, pinned: boolean, personId?: string) {
  const { supabase } = await ctx();
  await supabase.from("tal_activities").update({ pinned }).eq("id", activityId);
  if (personId) revalidatePath(`/talent/people/${personId}`);
}

export async function deleteActivity(activityId: string, personId?: string) {
  const { supabase } = await ctx();
  const { error } = await supabase.from("tal_activities").delete().eq("id", activityId);
  if (error) throw new Error(`Could not remove that: ${error.message}`);
  if (personId) revalidatePath(`/talent/people/${personId}`);
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

export async function createTag(label: string, color: string, scope = "all") {
  const { supabase, me } = await ctx();
  const { data, error } = await supabase
    .from("tal_tags")
    .insert({ label: label.trim(), color, scope, created_by: me })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") throw new Error("That tag already exists");
    throw new Error(`Could not create that tag: ${error.message}`);
  }
  return (data as { id: string }).id;
}

export async function setTag(
  entityType: "person" | "company" | "job",
  entityId: string,
  tagId: string,
  on: boolean
) {
  const { supabase, me } = await ctx();
  if (on) {
    await supabase
      .from("tal_tag_links")
      .upsert({ tag_id: tagId, entity_type: entityType, entity_id: entityId, created_by: me });
  } else {
    await supabase
      .from("tal_tag_links")
      .delete()
      .eq("tag_id", tagId).eq("entity_type", entityType).eq("entity_id", entityId);
  }
  revalidatePath(`/talent/${entityType === "person" ? "people" : entityType === "job" ? "jobs" : "companies"}/${entityId}`);
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

/**
 * Records a file that the browser has already put in the bucket. The upload
 * itself happens client-side against Supabase Storage, so a large CV never
 * passes through a server action's body limit.
 */
export async function recordDocument(input: {
  person_id?: string | null;
  job_id?: string | null;
  company_id?: string | null;
  name: string;
  kind: string;
  storage_path: string;
  mime_type?: string | null;
  size_bytes?: number | null;
  makePrimary?: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { supabase, me } = await ctx();

    if (input.makePrimary && input.person_id) {
      await supabase.from("tal_documents")
        .update({ is_primary: false })
        .eq("person_id", input.person_id).eq("kind", "resume");
    }

    const { error } = await supabase.from("tal_documents").insert({
      person_id: input.person_id || null,
      job_id: input.job_id || null,
      company_id: input.company_id || null,
      name: input.name,
      kind: input.kind,
      storage_path: input.storage_path,
      mime_type: input.mime_type ?? null,
      size_bytes: input.size_bytes ?? null,
      is_primary: !!input.makePrimary && input.kind === "resume",
      uploaded_by: me,
    });
    if (error) throw new Error(`Could not save that file: ${error.message}`);

    if (input.person_id) {
      const activity = await logActivity({
        typeSlug: "document", person_id: input.person_id, job_id: input.job_id,
        subject: `Added ${input.name}`,
      });
      if (!activity.ok) throw new Error(activity.error);
      await scoreReadiness(input.person_id);
      revalidatePath(`/talent/people/${input.person_id}`);
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save that file." };
  }
}

/**
 * A short-lived URL for a private file. Documents live in a bucket that is not
 * public, so this is the only way to open one -- and the link stops working an
 * hour later, which is the point.
 */
export async function documentUrl(
  storagePath: string
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    await assertTalent("view");
    const supabase = await createClient();
    const { data, error } = await supabase.storage
      .from("talent-documents").createSignedUrl(storagePath, 3600);
    if (error) throw new Error(`Could not open that file: ${error.message}`);
    return { ok: true, url: data.signedUrl };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not open that file." };
  }
}

export async function deleteDocument(documentId: string, personId?: string) {
  const { supabase } = await ctx();
  const { data: doc } = await supabase
    .from("tal_documents").select("storage_path").eq("id", documentId).maybeSingle();
  const path = (doc as { storage_path: string | null } | null)?.storage_path;
  await supabase.from("tal_documents").delete().eq("id", documentId);
  if (path) await supabase.storage.from("talent-documents").remove([path]);
  if (personId) revalidatePath(`/talent/people/${personId}`);
}

// ---------------------------------------------------------------------------
// Lookups for the pickers
// ---------------------------------------------------------------------------

/**
 * A short list of people matching what somebody has typed into a picker.
 *
 * Deliberately its own action rather than a reuse of `listPeople`: a picker
 * wants ten rows and four columns, and running the full list query behind every
 * keystroke would pull counts and subqueries nobody is going to look at.
 */
export async function quickSearchPeople(term: string, limit = 10) {
  await assertTalent("view");
  if (!term.trim()) return [];
  const supabase = await createClient();
  const q = term.trim().replace(/[%,()]/g, " ");

  const { data } = await supabase
    .from("tal_person_summary")
    .select("id,name,title,company,primary_email")
    .or([`name.ilike.%${q}%`, `primary_email.ilike.%${q}%`, `company.ilike.%${q}%`].join(","))
    .order("last_activity_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  return (data ?? []) as {
    id: string; name: string; title: string | null;
    company: string | null; primary_email: string | null;
  }[];
}

export async function quickSearchCompanies(term: string, limit = 10) {
  await assertTalent("view");
  const supabase = await createClient();
  let query = supabase.from("tal_companies").select("id,name,domain,city,state").order("name").limit(limit);
  if (term.trim()) {
    const q = term.trim().replace(/[%,()]/g, " ");
    query = query.or(`name.ilike.%${q}%,domain.ilike.%${q}%`);
  }
  const { data } = await query;
  return (data ?? []) as { id: string; name: string; domain: string | null; city: string | null; state: string | null }[];
}

export async function quickSearchJobs(term: string, limit = 10) {
  await assertTalent("view");
  const supabase = await createClient();
  let query = supabase
    .from("tal_job_summary")
    .select("id,title,company_name,status")
    .in("status", ["active", "on_hold", "draft"])
    .order("last_activity_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (term.trim()) {
    const q = term.trim().replace(/[%,()]/g, " ");
    query = query.or(`title.ilike.%${q}%,company_name.ilike.%${q}%`);
  }
  const { data } = await query;
  return (data ?? []) as { id: string; title: string; company_name: string | null; status: string }[];
}
