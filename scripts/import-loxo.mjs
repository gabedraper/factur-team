/*
 * Loxo -> talent system migration.
 *
 *   node scripts/import-loxo.mjs --dry-run     # read Loxo, write nothing, report
 *   node scripts/import-loxo.mjs               # do it
 *   node scripts/import-loxo.mjs --only=config # one stage at a time
 *   node scripts/import-loxo.mjs --resumes     # also pull the CV files (slow)
 *
 * Environment:
 *   LOXO_API_KEY, LOXO_AGENCY_SLUG, LOXO_DOMAIN (default app.loxo.co)
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * ---------------------------------------------------------------------------
 * The point of this script is that nobody has to set anything up again.
 *
 * Moving the records is the easy half. What actually costs a recruiter their
 * week is rebuilding the *configuration* -- the pipeline stages they tuned over
 * two years, the custom fields, the scorecards, the lists. So the `config`
 * stage runs first and brings all of that across as real records on this side,
 * and every later stage hangs off what it created. A candidate lands in the
 * stage they were actually in, with its original name, because that stage now
 * exists here.
 *
 * Two properties this is built around:
 *
 * It is **re-runnable**. Every row carries external_source='loxo' and the Loxo
 * id, and every write is an upsert on that pair. A run that dies on record
 * 4,000 of 12,000 is resumed by running it again -- not by working out what
 * already landed.
 *
 * It **never invents a pipeline stage**. Stages come from /workflows, so the
 * mapping is by id and cannot drift. Anything that still fails to match keeps
 * its original name in `external_stage` and is listed at the end.
 *
 * ---------------------------------------------------------------------------
 * The one thing that cannot come across: EMAIL TEMPLATES.
 *
 * Loxo's API has no email or SMS template endpoint. It exposes form templates
 * and scorecard templates, and it exposes campaigns (whose message bodies do
 * come across, below) -- but the standalone templates under Settings are not
 * reachable programmatically. There is no way around this from the outside.
 *
 * They have to be copied over by hand. /settings/talent has a bulk paste box to
 * make that twenty minutes rather than an afternoon, and it is worth asking
 * Loxo support for an export before doing it manually.
 * ---------------------------------------------------------------------------
 */

import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const API_KEY = process.env.LOXO_API_KEY;
const SLUG = process.env.LOXO_AGENCY_SLUG;
const DOMAIN = process.env.LOXO_DOMAIN || "app.loxo.co";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const WITH_RESUMES = args.includes("--resumes");
const ONLY = args.find((a) => a.startsWith("--only="))?.split("=")[1] ?? null;
const LIMIT = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 0) || null;

if (!API_KEY || !SLUG) {
  throw new Error(
    "Set LOXO_API_KEY and LOXO_AGENCY_SLUG in the environment before running this script.\n" +
    "Both come from Loxo: Settings -> API Keys -> + Add."
  );
}
if (!DRY && (!SUPABASE_URL || !SUPABASE_KEY)) {
  throw new Error(
    "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment, " +
    "or pass --dry-run to read Loxo without writing anything."
  );
}

const db = DRY ? null : createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

const BASE = `https://${DOMAIN}/api/${SLUG}`;
const SOURCE = "loxo";

const report = {
  workflows: 0, stages: 0, activityTypes: 0, dynamicFields: 0,
  scorecardTemplates: 0, noteTemplates: 0, lists: 0, listMembers: 0,
  companies: 0, people: 0, jobs: 0, candidates: 0, activities: 0,
  placements: 0, scorecards: 0, campaigns: 0, interviews: 0,
  deals: 0, documents: 0,
  unmappedStages: new Map(), skipped: [], errors: [], notes: [],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Filled by the config stage and read by everything after it.
const stageIdByLoxoId = new Map();   // loxo workflow_stage id -> our stage id
const stageNameByLoxoId = new Map();
const workflowIdByLoxoId = new Map();
let defaultWorkflowId = null;

// ---------------------------------------------------------------------------
// Loxo
// ---------------------------------------------------------------------------

async function get(path, attempt = 0) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { accept: "application/json", authorization: `Bearer ${API_KEY}` },
  });

  if (res.status === 429 && attempt < 5) {
    const wait = Number(res.headers.get("retry-after")) * 1000 || 2000 * (attempt + 1);
    console.log(`    rate limited, waiting ${Math.round(wait / 1000)}s`);
    await sleep(wait);
    return get(path, attempt + 1);
  }
  if (res.status >= 500 && attempt < 3) {
    await sleep(2000 * (attempt + 1));
    return get(path, attempt + 1);
  }

  const text = await res.text();
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

/** Endpoints a given Loxo plan may not expose. Absent is not a failure. */
async function optional(path) {
  try {
    return await get(path);
  } catch (e) {
    if (/-> 40[0-9]/.test(e.message)) {
      report.notes.push(`${path} is not available on this Loxo plan — skipped`);
      return null;
    }
    throw e;
  }
}

function listOf(body) {
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object") {
    for (const v of Object.values(body)) if (Array.isArray(v)) return v;
  }
  return [];
}

/**
 * Walks a whole endpoint.
 *
 * Loxo paginates two ways depending on the resource -- a scroll_id on the big
 * collections, page numbers on the small ones -- so this follows whichever the
 * response actually offers rather than being told which to expect.
 */
async function* walk(path, perPage = 100) {
  let scrollId = null;
  let page = 1;
  let seen = 0;

  for (;;) {
    const sep = path.includes("?") ? "&" : "?";
    const q = scrollId
      ? `${sep}per_page=${perPage}&scroll_id=${encodeURIComponent(scrollId)}`
      : `${sep}per_page=${perPage}&page=${page}`;

    let body;
    try {
      body = await get(`${path}${q}`);
    } catch (e) {
      if (/-> 40[0-9]/.test(e.message)) {
        report.notes.push(`${path} is not available on this Loxo plan — skipped`);
        return;
      }
      throw e;
    }

    const rows = listOf(body);
    if (!rows.length) return;

    for (const row of rows) {
      yield row;
      seen++;
      if (LIMIT && seen >= LIMIT) return;
    }

    const nextScroll = body?.scroll_id ?? null;
    if (nextScroll && nextScroll !== scrollId) {
      scrollId = nextScroll;
    } else if (!nextScroll && rows.length === perPage) {
      page++;
    } else {
      return;
    }
    await sleep(120);
  }
}

// ---------------------------------------------------------------------------
// Field plucking
// ---------------------------------------------------------------------------

function pick(obj, ...keys) {
  for (const k of keys) {
    const v = k.split(".").reduce((o, part) => (o == null ? o : o[part]), obj);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
}

function nameOf(v) {
  if (!v) return null;
  if (typeof v === "string") return v;
  return pick(v, "name", "title", "label", "value");
}

function domainFrom(url) {
  if (!url) return null;
  try {
    return new URL(String(url).startsWith("http") ? url : `https://${url}`)
      .hostname.replace(/^www\./, "").toLowerCase();
  } catch { return null; }
}

function splitName(full, first, last) {
  if (first || last) return { first: first ?? null, last: last ?? null };
  const parts = String(full ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first: null, last: null };
  if (parts.length === 1) return { first: parts[0], last: null };
  return { first: parts.slice(0, -1).join(" "), last: parts.at(-1) };
}

function contacts(list, valueKeys, typeKeys) {
  return (list ?? [])
    .map((e, i) => {
      const value = typeof e === "string" ? e : pick(e, ...valueKeys);
      if (!value) return null;
      return {
        value: String(value).trim(),
        type: typeof e === "string" ? null : nameOf(pick(e, ...typeKeys)),
        primary: i === 0,
      };
    })
    .filter(Boolean);
}

const isoDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};
const isoStamp = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

async function put(table, row) {
  if (DRY) return "dry-run";
  const { data, error } = await db
    .from(table)
    .upsert({ ...row, external_source: SOURCE }, { onConflict: "external_source,external_id" })
    .select("id")
    .single();
  if (error) throw new Error(`${table}: ${error.message}`);
  return data.id;
}

async function existingMap(table) {
  const map = new Map();
  if (DRY) return map;
  let from = 0;
  for (;;) {
    const { data, error } = await db
      .from(table).select("id,external_id")
      .eq("external_source", SOURCE).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    for (const r of data) map.set(r.external_id, r.id);
    if (data.length < 1000) return map;
    from += 1000;
  }
}

// ---------------------------------------------------------------------------
// Stage 1 — configuration. Everything that would otherwise be rebuilt by hand.
// ---------------------------------------------------------------------------

const STAGE_HINTS = [
  [/(source|identif|research)/i, "sourced"],
  [/(contact|outreach|reach)/i, "contacted"],
  [/(respond|repl|engag|interest)/i, "responded"],
  [/(screen|qualif|prescreen|phone)/i, "screening"],
  [/(submit|present|shortlist|client.review)/i, "submitted"],
  [/(interview|onsite|meeting)/i, "interview"],
  [/(offer|negotiat)/i, "offer"],
  [/(placed|hired|start|accept)/i, "placed"],
  [/(reject|decline|pass|withdraw|not.?interest|lost)/i, "rejected"],
];
const stageKind = (name) => STAGE_HINTS.find(([re]) => re.test(name))?.[1] ?? "other";
const COLOURS = ["slate", "sky", "cyan", "indigo", "violet", "amber", "orange", "emerald", "rose"];

async function importConfig() {
  console.log("\nConfiguration");

  // --- Pipelines. The thing a recruiter would most hate to rebuild. --------
  const workflows = listOf(await optional("/workflows"));
  for (const [i, w] of workflows.entries()) {
    const name = pick(w, "name", "title") ?? `Workflow ${w.id}`;
    const slug = `loxo-${String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`.slice(0, 60);

    let workflowId = "dry-run";
    if (!DRY) {
      const { data: have } = await db.from("tal_workflows").select("id").eq("slug", slug).maybeSingle();
      if (have) workflowId = have.id;
      else {
        const { data, error } = await db.from("tal_workflows")
          .insert({
            name, slug,
            description: "Brought across from Loxo, stages and order intact.",
            is_default: false,
          })
          .select("id").single();
        if (error) throw new Error(`workflow ${name}: ${error.message}`);
        workflowId = data.id;
      }
    }
    workflowIdByLoxoId.set(String(w.id), workflowId);
    if (i === 0) defaultWorkflowId = workflowId;
    report.workflows++;

    // Stages come from Loxo in their real order, so the board looks the same.
    const stages = listOf(await optional(`/workflow_stages?workflow_id=${w.id}`));
    for (const [pos, s] of stages.entries()) {
      const stageName = pick(s, "name", "title") ?? `Stage ${s.id}`;
      stageNameByLoxoId.set(String(s.id), stageName);

      if (DRY) { stageIdByLoxoId.set(String(s.id), "dry-run"); report.stages++; continue; }

      const { data: had } = await db.from("tal_workflow_stages")
        .select("id").eq("workflow_id", workflowId).ilike("name", stageName).maybeSingle();

      let stageId = had?.id;
      if (!stageId) {
        const kind = stageKind(stageName);
        const { data, error } = await db.from("tal_workflow_stages")
          .insert({
            workflow_id: workflowId, name: stageName, kind,
            position: Number(pick(s, "position", "order", "sort_order") ?? pos),
            color: COLOURS[Math.min(pos, COLOURS.length - 1)],
            is_terminal: kind === "placed" || kind === "rejected",
          })
          .select("id").single();
        if (error) throw new Error(`stage ${stageName}: ${error.message}`);
        stageId = data.id;
      }
      stageIdByLoxoId.set(String(s.id), stageId);
      report.stages++;
    }
  }
  console.log(`  ${report.workflows} pipelines, ${report.stages} stages`);

  // --- Activity types, so her logged history keeps its own vocabulary. -----
  for (const t of listOf(await optional("/activity_types"))) {
    const name = pick(t, "name", "label");
    if (!name || DRY) { report.activityTypes++; continue; }
    const slug = `loxo-${String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`.slice(0, 60);
    const { data: had } = await db.from("tal_activity_types")
      .select("id").or(`slug.eq.${slug},name.ilike.${name}`).maybeSingle();
    if (had) continue;
    await db.from("tal_activity_types").insert({
      name, slug,
      category: /call/i.test(name) ? "call" : /email/i.test(name) ? "email"
              : /sms|text/i.test(name) ? "sms"
              : /meet|interview/i.test(name) ? "meeting" : "note",
      counts_as_progression: true,
    });
    report.activityTypes++;
  }
  console.log(`  ${report.activityTypes} activity types`);

  // --- Custom fields. -----------------------------------------------------
  for (const f of listOf(await optional("/dynamic_fields"))) {
    const label = pick(f, "name", "label") ?? null;
    if (!label || DRY) { report.dynamicFields++; continue; }
    const entity = String(pick(f, "model", "entity", "resource") ?? "person").toLowerCase();
    if (!["person", "company", "job", "candidate", "placement"].includes(entity)) continue;

    const type = String(pick(f, "field_type", "type", "kind") ?? "text").toLowerCase();
    await db.from("tal_dynamic_fields").upsert({
      entity,
      key: String(label).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
      label,
      field_type:
        /number|integer|decimal/.test(type) ? "number" :
        /date/.test(type) ? "date" :
        /bool|check/.test(type) ? "boolean" :
        /multi/.test(type) ? "multiselect" :
        /select|list|option|picklist/.test(type) ? "select" :
        /url|link/.test(type) ? "url" :
        /textarea|long/.test(type) ? "textarea" : "text",
      options: (listOf(pick(f, "options", "values", "choices")) ?? []).map((o) => nameOf(o) ?? o),
      position: Number(pick(f, "position") ?? 0),
    }, { onConflict: "entity,key" });
    report.dynamicFields++;
  }
  console.log(`  ${report.dynamicFields} custom fields`);

  // --- Scorecard templates. -----------------------------------------------
  for (const t of listOf(await optional("/scorecard_templates"))) {
    const name = pick(t, "name", "title");
    if (!name || DRY) { report.scorecardTemplates++; continue; }
    const criteria = listOf(pick(t, "rating_attributes", "attributes", "criteria")).map((c) => ({
      key: String(nameOf(c) ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_"),
      label: nameOf(c) ?? "",
      description: pick(c, "description") ?? "",
    }));
    const { data: had } = await db.from("tal_scorecard_templates")
      .select("id").ilike("name", name).maybeSingle();
    if (had) await db.from("tal_scorecard_templates").update({ criteria }).eq("id", had.id);
    else await db.from("tal_scorecard_templates").insert({ name, criteria });
    report.scorecardTemplates++;
  }

  // --- Form templates become note templates: same job, our shape. ---------
  for (const t of listOf(await optional("/form_templates"))) {
    const name = pick(t, "name", "title");
    if (!name || DRY) { report.noteTemplates++; continue; }
    const full = await optional(`/form_templates/${t.id}`);
    const questions = listOf(pick(full ?? t, "questions", "form_questions", "fields"));
    const body = questions.map((q) => `${nameOf(q) ?? ""}\n`).join("\n");
    const { data: had } = await db.from("tal_note_templates").select("id").ilike("name", name).maybeSingle();
    if (had) await db.from("tal_note_templates").update({ body }).eq("id", had.id);
    else await db.from("tal_note_templates").insert({ name, scope: "person", body });
    report.noteTemplates++;
  }
  console.log(`  ${report.scorecardTemplates} scorecards, ${report.noteTemplates} note templates`);

  // --- Lists. -------------------------------------------------------------
  for (const l of listOf(await optional("/person_lists"))) {
    const name = pick(l, "name", "title");
    if (!name || DRY) { report.lists++; continue; }
    const { data: had } = await db.from("tal_lists").select("id").ilike("name", name).eq("entity", "person").maybeSingle();
    const listId = had?.id ?? (await db.from("tal_lists")
      .insert({ name, entity: "person", description: "From Loxo" })
      .select("id").single()).data?.id;
    if (listId) report.lists++;
  }
  console.log(`  ${report.lists} lists`);

  report.notes.push(
    "Email and SMS templates have no Loxo API endpoint and could not be migrated. " +
    "Copy them in at /settings/talent -> Templates (there is a bulk paste box)."
  );
}

// ---------------------------------------------------------------------------
// Stage 2 — records
// ---------------------------------------------------------------------------

async function importCompanies() {
  console.log("\nCompanies");
  for await (const c of walk("/companies")) {
    const website = pick(c, "url", "website", "domain");
    await put("tal_companies", {
      external_id: String(c.id),
      name: pick(c, "name") ?? "(unnamed)",
      domain: domainFrom(website),
      website: website ? String(website) : null,
      linkedin_url: pick(c, "linkedin_url", "linkedin"),
      description: pick(c, "description", "blurb", "notes"),
      industry: nameOf(pick(c, "industry", "company_type")),
      headcount_label: pick(c, "size", "employee_count", "headcount"),
      city: pick(c, "city", "address.city", "location.city"),
      state: pick(c, "state", "address.state", "location.state"),
      country: pick(c, "country", "address.country"),
      phone: pick(c, "phone", "phones.0.value"),
      kind: "prospect",
      created_at: isoStamp(pick(c, "created_at")) ?? undefined,
    });
    report.companies++;
    if (report.companies % 100 === 0) console.log(`  ${report.companies}…`);
  }
  console.log(`  ${report.companies} companies`);
}

async function importPeople() {
  console.log("\nPeople");
  const companies = await existingMap("tal_companies");

  for await (const p of walk("/people")) {
    const { first, last } = splitName(pick(p, "name"), pick(p, "first_name"), pick(p, "last_name"));

    // Inlined when Loxo gives them, fetched when it does not. On a large
    // database that choice is the difference between an afternoon and a day.
    let emails = p.emails ?? p.email_addresses;
    let phones = p.phones ?? p.phone_numbers;
    if (!emails) emails = listOf(await optional(`/people/${p.id}/emails`));
    if (!phones) phones = listOf(await optional(`/people/${p.id}/phones`));

    const companyId = pick(p, "company.id", "company_id");

    const personId = await put("tal_people", {
      external_id: String(p.id),
      first_name: first,
      last_name: last,
      title: pick(p, "title", "current_title", "job_title"),
      company_id: companyId ? companies.get(String(companyId)) ?? null : null,
      company_name: nameOf(pick(p, "company", "current_company", "employer")),
      emails: contacts(emails, ["value", "email", "address"], ["email_type", "type"]),
      phones: contacts(phones, ["value", "phone", "number"], ["phone_type", "type"]),
      linkedin_url: pick(p, "linkedin_url", "linkedin"),
      personal_website: pick(p, "website", "blog_url"),
      city: pick(p, "city", "location.city", "address.city"),
      state: pick(p, "state", "location.state", "address.state"),
      country: pick(p, "country", "location.country"),
      person_types: [String(nameOf(pick(p, "person_type")) ?? "candidate").toLowerCase()],
      skills: listOf(pick(p, "skillsets", "skills")).map((s) => nameOf(s) ?? s).filter(Boolean),
      /*
       * Loxo calls this `description` and its users call it the intake note.
       * It is the single most valuable free-text field in the system and the
       * one a recruiter would most notice missing.
       */
      summary: pick(p, "description", "blurb", "summary", "notes"),
      current_salary: pick(p, "current_compensation", "salary"),
      salary_expectation: pick(p, "compensation", "desired_compensation"),
      source: "import",
      source_detail: `Loxo — ${nameOf(pick(p, "source_type")) ?? "migrated"}`,
      do_not_contact: !!pick(p, "do_not_contact", "blocked", "opted_out"),
      created_at: isoStamp(pick(p, "created_at")) ?? undefined,
    });

    for (const [path, table, map] of [
      ["person_job_profiles", "tal_person_jobs", (j, i) => ({
        person_id: personId,
        company_name: nameOf(pick(j, "company", "company_name")),
        title: pick(j, "title", "position"),
        description: pick(j, "description", "summary"),
        started_on: isoDate(pick(j, "start_date", "started_at")),
        ended_on: isoDate(pick(j, "end_date", "ended_at")),
        is_current: !!pick(j, "current", "is_current"),
        position: i,
      })],
      ["person_education_profiles", "tal_person_educations", (e, i) => ({
        person_id: personId,
        school: nameOf(pick(e, "school", "institution")),
        degree: nameOf(pick(e, "degree")),
        field_of_study: pick(e, "field_of_study", "major"),
        started_on: isoDate(pick(e, "start_date")),
        ended_on: isoDate(pick(e, "end_date")),
        position: i,
      })],
    ]) {
      // Loxo nests these under the person; the endpoint names above are the
      // top-level ones, so ask the person-scoped route.
      const scoped = path.replace("person_", "");
      const rows = listOf(await optional(`/people/${p.id}/${scoped}`));
      if (!rows.length || DRY) continue;
      // Replaced wholesale: no stable id to upsert against, and a re-run must
      // not stack three copies of the same job history.
      await db.from(table).delete().eq("person_id", personId);
      await db.from(table).insert(rows.map(map));
    }

    if (WITH_RESUMES) await importResumes(p.id, personId);

    report.people++;
    if (report.people % 50 === 0) console.log(`  ${report.people}…`);
    await sleep(60);
  }
  console.log(`  ${report.people} people`);
}

async function importResumes(loxoPersonId, personId) {
  const resumes = listOf(await optional(`/people/${loxoPersonId}/resumes`));
  for (const r of resumes) {
    const url = pick(r, "download_url", "url", "file_url", "s3_url");
    const name = pick(r, "name", "filename", "file_name") ?? "Resume";
    if (!url || DRY) continue;

    try {
      const file = await fetch(url, { headers: { authorization: `Bearer ${API_KEY}` } });
      if (!file.ok) throw new Error(`download ${file.status}`);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const safe = String(name).replace(/[^\w.\-]+/g, "_");
      const path = `${personId}/loxo-${r.id ?? Date.now()}-${safe}`;

      const { error: upErr } = await db.storage
        .from("talent-documents")
        .upload(path, bytes, {
          contentType: file.headers.get("content-type") ?? "application/pdf",
          upsert: true,
        });
      if (upErr) throw new Error(upErr.message);

      await put("tal_documents", {
        external_id: String(r.id ?? path),
        person_id: personId, name, kind: "resume",
        storage_path: path, size_bytes: bytes.length,
        mime_type: file.headers.get("content-type"),
      });
      report.documents++;
    } catch (e) {
      report.errors.push(`resume for person ${loxoPersonId}: ${e.message}`);
    }
  }
}

async function importJobs() {
  console.log("\nJobs");
  const companies = await existingMap("tal_companies");

  for await (const j of walk("/jobs")) {
    const companyId = pick(j, "company.id", "company_id");
    const status = String(nameOf(pick(j, "status", "job_status")) ?? "").toLowerCase();
    const loxoWorkflowId = String(pick(j, "workflow_id", "workflow.id") ?? "");

    await put("tal_jobs", {
      external_id: String(j.id),
      title: pick(j, "title", "name") ?? "(untitled)",
      company_id: companyId ? companies.get(String(companyId)) ?? null : null,
      workflow_id: workflowIdByLoxoId.get(loxoWorkflowId) ?? defaultWorkflowId,
      status:
        /active|open/.test(status) ? "active" :
        /hold/.test(status) ? "on_hold" :
        /fill|placed|closed.won/.test(status) ? "filled" :
        /closed|cancel|lost/.test(status) ? "closed" : "draft",
      job_kind: "contingency",
      description: pick(j, "description", "public_description"),
      requirements: pick(j, "requirements", "qualifications"),
      internal_notes: pick(j, "internal_notes", "notes"),
      city: pick(j, "city", "address.city", "location.city"),
      state: pick(j, "state", "address.state", "location.state"),
      country: pick(j, "country"),
      salary_min: pick(j, "salary_min", "compensation_min"),
      salary_max: pick(j, "salary_max", "compensation_max"),
      openings: pick(j, "openings", "positions") ?? 1,
      opened_on: isoDate(pick(j, "published_at", "created_at")),
      created_at: isoStamp(pick(j, "created_at")) ?? undefined,
      // Never published by an import: putting somebody else's advert live on
      // your careers page is not a migration decision.
      published: false,
    });
    report.jobs++;
  }
  console.log(`  ${report.jobs} jobs`);
}

/**
 * Pipelines, from the agency-wide endpoint rather than job by job.
 *
 * /candidates returns the person, the job and the workflow stage in one pass,
 * which on a few hundred jobs is a few requests instead of a few hundred.
 */
async function importCandidates() {
  console.log("\nPipelines");
  const jobs = await existingMap("tal_jobs");
  const people = await existingMap("tal_people");

  for await (const c of walk("/candidates")) {
    const loxoJobId = String(pick(c, "job.id", "job_id") ?? "");
    const loxoPersonId = String(pick(c, "person.id", "person_id") ?? "");
    const jobId = jobs.get(loxoJobId);
    const personId = people.get(loxoPersonId);

    if (!jobId || !personId) {
      report.skipped.push(`candidate ${c.id}: ${!jobId ? "job" : "person"} not imported`);
      continue;
    }

    const loxoStageId = String(pick(c, "workflow_stage.id", "workflow_stage_id") ?? "");
    const stageName =
      nameOf(pick(c, "workflow_stage", "stage")) ?? stageNameByLoxoId.get(loxoStageId) ?? null;
    const stageId = stageIdByLoxoId.get(loxoStageId) ?? null;

    if (stageName && !stageId && !DRY) {
      report.unmappedStages.set(stageName, (report.unmappedStages.get(stageName) ?? 0) + 1);
    }

    await put("tal_candidates", {
      external_id: String(c.id ?? `${loxoJobId}:${loxoPersonId}`),
      external_stage: stageName,
      job_id: jobId,
      person_id: personId,
      stage_id: stageId,
      status: pick(c, "rejected") ? "rejected"
            : /placed|hired/i.test(stageName ?? "") ? "hired"
            : /reject|decline|pass/i.test(stageName ?? "") ? "rejected" : "active",
      rejection_reason: nameOf(pick(c, "rejection_reason")),
      source: "import",
      source_detail: "Loxo migration",
      created_at: isoStamp(pick(c, "created_at")) ?? undefined,
    });
    report.candidates++;
    if (report.candidates % 200 === 0) console.log(`  ${report.candidates}…`);
  }
  console.log(`  ${report.candidates} candidates`);
}

async function importActivities() {
  console.log("\nActivity");
  const people = await existingMap("tal_people");
  const jobs = await existingMap("tal_jobs");

  const types = new Map();
  if (!DRY) {
    const { data } = await db.from("tal_activity_types").select("id,name");
    for (const t of data ?? []) types.set(t.name.toLowerCase(), t.id);
  }

  for await (const e of walk("/person_events")) {
    const personId = people.get(String(pick(e, "person.id", "person_id") ?? ""));
    if (!personId) continue;

    const typeName = nameOf(pick(e, "activity_type", "event_type", "type"));
    await put("tal_activities", {
      external_id: String(e.id),
      person_id: personId,
      job_id: jobs.get(String(pick(e, "job.id", "job_id") ?? "")) ?? null,
      activity_type_id: typeName ? types.get(typeName.toLowerCase()) ?? null : null,
      subject: pick(e, "subject", "title", "name") ?? typeName,
      body: pick(e, "notes", "body", "description", "content"),
      pinned: !!pick(e, "pinned"),
      occurred_at: isoStamp(pick(e, "created_at", "occurred_at", "date")) ?? new Date().toISOString(),
    });
    report.activities++;
    if (report.activities % 500 === 0) console.log(`  ${report.activities}…`);
  }
  console.log(`  ${report.activities} activities`);
}

async function importPlacements() {
  console.log("\nPlacements");
  const jobs = await existingMap("tal_jobs");
  const people = await existingMap("tal_people");
  const companies = await existingMap("tal_companies");

  for await (const pl of walk("/placements")) {
    const jobId = jobs.get(String(pick(pl, "job.id", "job_id") ?? ""));
    const personId = people.get(String(pick(pl, "person.id", "person_id") ?? ""));
    if (!jobId || !personId) continue;

    await put("tal_placements", {
      external_id: String(pl.id),
      job_id: jobId,
      person_id: personId,
      company_id: companies.get(String(pick(pl, "company.id", "company_id") ?? "")) ?? null,
      title: pick(pl, "title", "job_title"),
      started_on: isoDate(pick(pl, "start_date", "started_at")),
      ended_on: isoDate(pick(pl, "end_date")),
      salary: pick(pl, "salary", "compensation"),
      fee_amount: pick(pl, "fee", "fee_amount", "placement_fee"),
      fee_percent: pick(pl, "fee_percentage", "fee_percent"),
      status: pick(pl, "end_date") ? "completed" : "active",
      notes: pick(pl, "notes"),
      created_at: isoStamp(pick(pl, "created_at")) ?? undefined,
    });
    report.placements++;
  }
  console.log(`  ${report.placements} placements`);
}

async function importScorecards() {
  console.log("\nScorecards");
  const people = await existingMap("tal_people");
  const jobs = await existingMap("tal_jobs");
  const candidates = await existingMap("tal_candidates");

  for await (const s of walk("/scorecards")) {
    const personId = people.get(String(pick(s, "person.id", "person_id") ?? ""));
    const jobId = jobs.get(String(pick(s, "job.id", "job_id") ?? ""));
    if (!personId || !jobId) continue;

    const rec = String(nameOf(pick(s, "recommendation", "recommendation_type")) ?? "").toLowerCase();
    await put("tal_scorecards", {
      external_id: String(s.id),
      person_id: personId,
      job_id: jobId,
      candidate_id: candidates.get(String(pick(s, "candidate.id", "candidate_id") ?? "")) ?? null,
      overall_rating: pick(s, "rating", "overall_rating"),
      recommendation:
        /strong.*yes|definitely/.test(rec) ? "strong_yes" :
        /strong.*no|definitely.not/.test(rec) ? "strong_no" :
        /yes|hire/.test(rec) ? "yes" :
        /no/.test(rec) ? "no" : rec ? "neutral" : null,
      interviewer_name: nameOf(pick(s, "created_by", "user", "author")),
      notes: pick(s, "notes", "comments"),
      submitted_at: isoStamp(pick(s, "created_at")),
      created_at: isoStamp(pick(s, "created_at")) ?? undefined,
    });
    report.scorecards++;
  }
  console.log(`  ${report.scorecards} scorecards`);
}

/**
 * Campaigns, which matter twice over.
 *
 * They are outreach history, and they are the only place Loxo's API exposes the
 * *wording* a recruiter uses -- the standalone email templates have no
 * endpoint, so a campaign body is the nearest thing to getting her writing
 * across automatically.
 */
async function importCampaigns() {
  console.log("\nCampaigns");
  const people = await existingMap("tal_people");

  for await (const c of walk("/campaigns")) {
    const name = pick(c, "name", "title") ?? `Campaign ${c.id}`;
    if (DRY) { report.campaigns++; continue; }

    const full = (await optional(`/campaigns/${c.id}`)) ?? c;

    const { data: had } = await db.from("tal_campaigns")
      .select("id").eq("external_source", SOURCE).eq("external_id", String(c.id)).maybeSingle();

    let campaignId = had?.id;
    if (!campaignId) {
      const { data, error } = await db.from("tal_campaigns")
        .insert({
          name, status: "archived", mode: "semi", audience: "candidate",
          external_source: SOURCE, external_id: String(c.id),
          created_at: isoStamp(pick(c, "created_at")) ?? undefined,
        })
        .select("id").single();
      if (error) { report.errors.push(`campaign ${name}: ${error.message}`); continue; }
      campaignId = data.id;
    }

    // The wording, which is the part worth keeping.
    const body = pick(full, "body", "html_body", "content", "message") ?? "";
    const subject = pick(full, "subject", "email_subject") ?? name;
    await db.from("tal_campaign_steps").upsert(
      { campaign_id: campaignId, position: 0, channel: "email", delay_days: 0, subject, body },
      { onConflict: "campaign_id,position" }
    );

    for (const r of listOf(await optional(`/campaign_recipients?campaign_id=${c.id}`))) {
      const personId = people.get(String(pick(r, "person.id", "person_id") ?? ""));
      if (!personId) continue;
      await db.from("tal_campaign_members").upsert(
        { campaign_id: campaignId, person_id: personId, status: "completed" },
        { onConflict: "campaign_id,person_id", ignoreDuplicates: true }
      );
    }
    report.campaigns++;
  }
  console.log(`  ${report.campaigns} campaigns`);
}

async function importSchedule() {
  console.log("\nSchedule");
  const people = await existingMap("tal_people");
  const jobs = await existingMap("tal_jobs");

  for await (const s of walk("/schedule_items")) {
    const personId = people.get(String(pick(s, "person.id", "person_id") ?? ""));
    if (!personId) continue;
    const startsAt = isoStamp(pick(s, "starts_at", "start_time", "scheduled_at", "date"));
    if (!startsAt) continue;

    const title = String(pick(s, "name", "title") ?? "");
    await put("tal_interviews", {
      external_id: String(s.id),
      person_id: personId,
      job_id: jobs.get(String(pick(s, "job.id", "job_id") ?? "")) ?? null,
      kind: /interview/i.test(title) ? "interview" : "meeting",
      title: title || null,
      starts_at: startsAt,
      ends_at: isoStamp(pick(s, "ends_at", "end_time")),
      location: pick(s, "location"),
      // Loxo's AI Notetaker outline, where there is one. It is the most useful
      // thing on the record and it is plain text on the way out.
      notes: pick(s, "outline_text", "notes", "description", "transcript_text"),
      status: new Date(startsAt) < new Date() ? "completed" : "scheduled",
    });
    report.interviews++;
  }
  console.log(`  ${report.interviews} scheduled items`);
}

async function importDeals() {
  console.log("\nDeals");
  const companies = await existingMap("tal_companies");

  for await (const d of walk("/deals")) {
    const stage = String(nameOf(pick(d, "deal_stage", "stage", "pipeline_stage")) ?? "").toLowerCase();
    await put("tal_deals", {
      external_id: String(d.id),
      name: pick(d, "name", "title") ?? "(untitled)",
      company_id: companies.get(String(pick(d, "company.id", "company_id") ?? "")) ?? null,
      stage:
        /qualif/.test(stage) ? "qualifying" :
        /propos/.test(stage) ? "proposal" :
        /negoti/.test(stage) ? "negotiation" :
        /won/.test(stage) ? "won" :
        /lost/.test(stage) ? "lost" : "new",
      status: /won/.test(stage) ? "won" : /lost/.test(stage) ? "lost" : "open",
      value: pick(d, "amount", "value", "fee"),
      expected_close_on: isoDate(pick(d, "closes_at", "expected_close_date", "close_date")),
      notes: pick(d, "description", "notes"),
      created_at: isoStamp(pick(d, "created_at")) ?? undefined,
    });
    report.deals++;
  }
  console.log(`  ${report.deals} deals`);
}

// ---------------------------------------------------------------------------

const STAGES = {
  config: importConfig,
  companies: importCompanies,
  people: importPeople,
  jobs: importJobs,
  candidates: importCandidates,
  activities: importActivities,
  placements: importPlacements,
  scorecards: importScorecards,
  campaigns: importCampaigns,
  schedule: importSchedule,
  deals: importDeals,
};

async function main() {
  console.log(`\nLoxo -> talent  ${DRY ? "(DRY RUN — nothing will be written)" : ""}`);
  console.log(`  source: ${BASE}`);
  if (!DRY) console.log(`  target: ${SUPABASE_URL}`);
  if (LIMIT) console.log(`  limit:  ${LIMIT} per collection`);

  /*
   * Order matters and config is first for a reason: every later stage resolves
   * against the pipelines it creates. Running --only=candidates on its own will
   * work, but it needs config to have run at some point or every candidate
   * lands with no stage.
   */
  const run = ONLY ? [ONLY] : Object.keys(STAGES);
  if (ONLY && ONLY !== "config" && !DRY) {
    // Rebuild the stage lookup so a single-stage re-run still maps correctly.
    try { await importConfig(); } catch { /* reported below */ }
  }

  for (const stage of run) {
    if (!STAGES[stage]) {
      throw new Error(`Unknown stage "${stage}". One of: ${Object.keys(STAGES).join(", ")}`);
    }
    try {
      await STAGES[stage]();
    } catch (e) {
      report.errors.push(`${stage}: ${e.message}`);
      console.error(`  ✗ ${stage} stopped: ${e.message}`);
    }
  }

  console.log("\n─────────────────────────────");
  for (const [k, v] of Object.entries(report)) {
    if (typeof v === "number" && v) console.log(`  ${k.padEnd(18)} ${v}`);
  }

  if (report.unmappedStages.size) {
    console.log("\n  Stages that could not be matched (candidates left with no stage):");
    for (const [name, n] of report.unmappedStages) console.log(`    ${name} — ${n}`);
    console.log("  Add these in Settings -> Talent -> Pipelines, then re-run --only=candidates.");
  }
  if (report.notes.length) {
    console.log("\n  Worth knowing:");
    for (const n of [...new Set(report.notes)]) console.log(`    ${n}`);
  }
  if (report.skipped.length) {
    console.log(`\n  Skipped ${report.skipped.length}:`);
    for (const s of report.skipped.slice(0, 10)) console.log(`    ${s}`);
  }
  if (report.errors.length) {
    console.log(`\n  Errors ${report.errors.length}:`);
    for (const s of report.errors.slice(0, 10)) console.log(`    ${s}`);
    console.log("  Re-running is safe — everything already imported is updated, not duplicated.");
  }
  console.log("");
}

main().catch((e) => {
  console.error("\nImport failed:", e.message, "\n");
  process.exit(1);
});
