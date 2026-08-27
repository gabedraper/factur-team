/*
 * Loxo -> talent system migration.
 *
 *   node scripts/import-loxo.mjs --dry-run     # read Loxo, write nothing, report
 *   node scripts/import-loxo.mjs               # do it
 *   node scripts/import-loxo.mjs --only=people # one stage at a time
 *
 * Environment:
 *   LOXO_API_KEY, LOXO_AGENCY_SLUG, LOXO_DOMAIN (default app.loxo.co)
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Two properties this is built around, both learned the hard way on imports:
 *
 * It is **re-runnable**. Every row carries external_source='loxo' and the Loxo
 * id, and every write is an upsert on that pair. A run that dies on record 4,000
 * of 12,000 is resumed by running it again -- not by working out what already
 * landed. Run it as often as you like; it converges.
 *
 * It **never invents a pipeline stage**. Loxo's stages are read from the data
 * and recreated as real workflows on this side, mapped by name. Anything that
 * cannot be matched keeps its original stage name in `external_stage` and is
 * reported at the end, rather than being quietly dropped into the first column
 * -- which would destroy the only thing a pipeline is for.
 *
 * What this does NOT bring across, and why:
 *   - Resume *files*. The metadata comes over; the binaries need a second pass
 *     that downloads each one and puts it in the talent-documents bucket.
 *     Run with --resumes to do that (slow, and it is the bulk of the transfer).
 *   - Email bodies, if your Loxo mailbox sync holds them. person_events carries
 *     what the API exposes; anything Loxo keeps behind the mail integration
 *     stays there.
 *   - Anything Loxo licenses rather than owns on your behalf. Enriched contact
 *     details attached to your own records come across; their wider index does
 *     not, because it was never yours.
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
  companies: 0, people: 0, jobs: 0, candidates: 0, activities: 0,
  deals: 0, interviews: 0, documents: 0, workflows: 0,
  unmappedStages: new Map(), skipped: [], errors: [],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Loxo
// ---------------------------------------------------------------------------

/** One request, with a wait-and-retry on the rate limiter rather than a crash. */
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

/** Loxo wraps lists under different keys per endpoint; take the first array. */
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

    const body = await get(`${path}${q}`);
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

/** First of several possible key names that actually has a value. */
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
    return new URL(url.startsWith("http") ? url : `https://${url}`)
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

function isoDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function isoStamp(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

/** Upsert on (external_source, external_id) and hand back the id. */
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

/** Every id we have already brought across, so links can be resolved. */
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
// Stages
// ---------------------------------------------------------------------------

/*
 * Loxo's stage names do not have to match this system's. Map by lowercased name
 * first, then by the machine meaning a name implies. Anything left over is
 * reported rather than guessed at.
 */
const STAGE_HINTS = [
  [/(source|identif|research)/i, "sourced"],
  [/(contact|outreach|reach)/i, "contacted"],
  [/(respond|repl|engag|interest)/i, "responded"],
  [/(screen|qualif|prescreen|phone)/i, "screening"],
  [/(submit|present|shortlist)/i, "submitted"],
  [/(interview|onsite|meeting)/i, "interview"],
  [/(offer|negotiat)/i, "offer"],
  [/(placed|hired|start|accept)/i, "placed"],
  [/(reject|decline|pass|withdraw|not.?interest|lost)/i, "rejected"],
];

function stageKind(name) {
  for (const [re, kind] of STAGE_HINTS) if (re.test(name)) return kind;
  return "other";
}

const COLOURS = ["slate", "sky", "cyan", "indigo", "violet", "amber", "orange", "emerald", "rose"];

/**
 * One workflow per distinct set of Loxo stages, built from what the pipeline
 * data actually contains rather than from a stage endpoint that may not be
 * exposed on every plan.
 */
async function ensureWorkflow(name, stageNames) {
  const slug = `loxo-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`.slice(0, 60);

  if (DRY) {
    report.workflows++;
    return { id: "dry-run", stages: new Map(stageNames.map((s) => [s.toLowerCase(), "dry-run"])) };
  }

  let { data: wf } = await db.from("tal_workflows").select("id").eq("slug", slug).maybeSingle();
  if (!wf) {
    const { data, error } = await db
      .from("tal_workflows")
      .insert({ name: `${name} (Loxo)`, slug, description: "Recreated from Loxo during the migration." })
      .select("id").single();
    if (error) throw new Error(`workflow: ${error.message}`);
    wf = data;
    report.workflows++;
  }

  const { data: have } = await db
    .from("tal_workflow_stages").select("id,name").eq("workflow_id", wf.id);
  const byName = new Map((have ?? []).map((s) => [s.name.toLowerCase(), s.id]));

  let position = have?.length ?? 0;
  for (const stage of stageNames) {
    if (byName.has(stage.toLowerCase())) continue;
    const kind = stageKind(stage);
    const { data, error } = await db
      .from("tal_workflow_stages")
      .insert({
        workflow_id: wf.id, name: stage, kind, position: position++,
        color: COLOURS[Math.min(position, COLOURS.length - 1)],
        is_terminal: kind === "placed" || kind === "rejected",
      })
      .select("id").single();
    if (error) throw new Error(`stage: ${error.message}`);
    byName.set(stage.toLowerCase(), data.id);
  }

  return { id: wf.id, stages: byName };
}

// ---------------------------------------------------------------------------
// Stages of the migration
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
    const { first, last } = splitName(
      pick(p, "name"), pick(p, "first_name"), pick(p, "last_name")
    );

    /*
     * Emails and phones are sub-resources, but Loxo often inlines them on the
     * list payload too. Use the inline copy when it is there and only spend a
     * request when it is not -- on a large database that is the difference
     * between one afternoon and three.
     */
    let emails = p.emails ?? p.email_addresses;
    let phones = p.phones ?? p.phone_numbers;
    if (!emails) emails = listOf(await get(`/people/${p.id}/emails`).catch(() => null));
    if (!phones) phones = listOf(await get(`/people/${p.id}/phones`).catch(() => null));

    const companyName = nameOf(pick(p, "company", "current_company", "employer"));
    const companyId = pick(p, "company.id", "company_id");

    const personId = await put("tal_people", {
      external_id: String(p.id),
      first_name: first,
      last_name: last,
      title: pick(p, "title", "current_title", "job_title"),
      company_id: companyId ? companies.get(String(companyId)) ?? null : null,
      company_name: companyName,
      emails: contacts(emails, ["value", "email", "address"], ["email_type", "type"]),
      phones: contacts(phones, ["value", "phone", "number"], ["phone_type", "type"]),
      linkedin_url: pick(p, "linkedin_url", "linkedin"),
      personal_website: pick(p, "website", "blog_url"),
      city: pick(p, "city", "location.city", "address.city"),
      state: pick(p, "state", "location.state", "address.state"),
      country: pick(p, "country", "location.country"),
      person_types: [nameOf(pick(p, "person_type")) ?? "candidate"].map((t) => t.toLowerCase()),
      summary: pick(p, "description", "blurb", "summary", "notes"),
      source: "import",
      source_detail: "Loxo migration",
      do_not_contact: !!pick(p, "do_not_contact", "blocked", "opted_out"),
      created_at: isoStamp(pick(p, "created_at")) ?? undefined,
    });

    // Work history and education, which are always their own calls.
    for (const [path, table, map] of [
      ["job_profiles", "tal_person_jobs", (j, i) => ({
        person_id: personId,
        company_name: nameOf(pick(j, "company", "company_name")),
        title: pick(j, "title", "position"),
        description: pick(j, "description", "summary"),
        started_on: isoDate(pick(j, "start_date", "started_at")),
        ended_on: isoDate(pick(j, "end_date", "ended_at")),
        is_current: !!pick(j, "current", "is_current"),
        position: i,
      })],
      ["education_profiles", "tal_person_educations", (e, i) => ({
        person_id: personId,
        school: nameOf(pick(e, "school", "institution")),
        degree: nameOf(pick(e, "degree")),
        field_of_study: pick(e, "field_of_study", "major"),
        started_on: isoDate(pick(e, "start_date")),
        ended_on: isoDate(pick(e, "end_date")),
        position: i,
      })],
    ]) {
      const rows = listOf(await get(`/people/${p.id}/${path}`).catch(() => null));
      if (!rows.length || DRY) continue;
      // Replaced wholesale: these have no stable id to upsert against, and a
      // re-run must not stack three copies of the same job history.
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

/** Resume files, which are the slow half of any ATS migration. */
async function importResumes(loxoPersonId, personId) {
  const resumes = listOf(await get(`/people/${loxoPersonId}/resumes`).catch(() => null));
  for (const r of resumes) {
    const url = pick(r, "url", "download_url", "file_url", "s3_url");
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

    await put("tal_jobs", {
      external_id: String(j.id),
      title: pick(j, "title", "name") ?? "(untitled)",
      company_id: companyId ? companies.get(String(companyId)) ?? null : null,
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
      // Never published on this side by an import: putting somebody else's
      // advert live on your careers page is not a migration decision.
      published: false,
    });
    report.jobs++;
  }
  console.log(`  ${report.jobs} jobs`);
}

async function importCandidates() {
  console.log("\nPipelines");
  const jobs = await existingMap("tal_jobs");
  const people = await existingMap("tal_people");

  for (const [loxoJobId, jobId] of jobs) {
    const rows = [];
    for await (const c of walk(`/jobs/${loxoJobId}/candidates`)) rows.push(c);
    if (!rows.length) continue;

    const stageNames = [...new Set(
      rows.map((c) => nameOf(pick(c, "workflow_stage", "stage", "job_candidate_stage"))).filter(Boolean)
    )];
    const jobTitle = `Job ${loxoJobId}`;
    const wf = stageNames.length ? await ensureWorkflow(jobTitle, stageNames) : null;

    if (wf && !DRY) await db.from("tal_jobs").update({ workflow_id: wf.id }).eq("id", jobId);

    for (const c of rows) {
      const loxoPersonId = String(pick(c, "person.id", "person_id", "candidate_id", "id"));
      const personId = people.get(loxoPersonId);
      if (!personId) {
        report.skipped.push(`candidate on job ${loxoJobId}: person ${loxoPersonId} not imported`);
        continue;
      }

      const stageName = nameOf(pick(c, "workflow_stage", "stage", "job_candidate_stage"));
      const stageId = stageName ? wf?.stages.get(stageName.toLowerCase()) ?? null : null;
      if (stageName && !stageId && !DRY) {
        report.unmappedStages.set(stageName, (report.unmappedStages.get(stageName) ?? 0) + 1);
      }

      await put("tal_candidates", {
        external_id: `${loxoJobId}:${loxoPersonId}`,
        external_stage: stageName,
        job_id: jobId,
        person_id: personId,
        stage_id: stageId,
        status: /reject|decline|pass/i.test(stageName ?? "") ? "rejected"
              : /placed|hired/i.test(stageName ?? "") ? "hired" : "active",
        source: "import",
        source_detail: "Loxo migration",
        created_at: isoStamp(pick(c, "created_at")) ?? undefined,
      });
      report.candidates++;
    }
    await sleep(120);
  }
  console.log(`  ${report.candidates} candidates`);
}

async function importActivities() {
  console.log("\nActivity");
  const people = await existingMap("tal_people");

  // Loxo's activity types mapped onto ours by name, creating what is missing.
  const types = new Map();
  if (!DRY) {
    const { data } = await db.from("tal_activity_types").select("id,name,slug");
    for (const t of data ?? []) types.set(t.name.toLowerCase(), t.id);
  }

  async function typeFor(name) {
    if (!name || DRY) return null;
    const key = name.toLowerCase();
    if (types.has(key)) return types.get(key);
    const slug = key.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const { data } = await db.from("tal_activity_types")
      .insert({
        name, slug,
        category: /call/i.test(name) ? "call" : /email/i.test(name) ? "email"
                : /meet|interview/i.test(name) ? "meeting" : "note",
        counts_as_progression: true,
      })
      .select("id").single();
    if (data) types.set(key, data.id);
    return data?.id ?? null;
  }

  for await (const e of walk("/person_events")) {
    const loxoPersonId = String(pick(e, "person.id", "person_id") ?? "");
    const personId = people.get(loxoPersonId);
    if (!personId) continue;

    const typeName = nameOf(pick(e, "activity_type", "event_type", "type"));
    await put("tal_activities", {
      external_id: String(e.id),
      person_id: personId,
      activity_type_id: await typeFor(typeName),
      subject: pick(e, "subject", "title", "name"),
      body: pick(e, "notes", "body", "description", "content"),
      occurred_at: isoStamp(pick(e, "created_at", "occurred_at", "date")) ?? new Date().toISOString(),
    });
    report.activities++;
    if (report.activities % 200 === 0) console.log(`  ${report.activities}…`);
  }
  console.log(`  ${report.activities} activities`);
}

async function importDeals() {
  console.log("\nDeals");
  const companies = await existingMap("tal_companies");

  for await (const d of walk("/deals")) {
    const companyId = pick(d, "company.id", "company_id");
    const stage = String(nameOf(pick(d, "deal_stage", "stage", "workflow_stage")) ?? "").toLowerCase();

    await put("tal_deals", {
      external_id: String(d.id),
      name: pick(d, "name", "title") ?? "(untitled)",
      company_id: companyId ? companies.get(String(companyId)) ?? null : null,
      stage:
        /qualif/.test(stage) ? "qualifying" :
        /propos/.test(stage) ? "proposal" :
        /negoti/.test(stage) ? "negotiation" :
        /won|closed.won/.test(stage) ? "won" :
        /lost|closed.lost/.test(stage) ? "lost" : "new",
      status: /won/.test(stage) ? "won" : /lost/.test(stage) ? "lost" : "open",
      value: pick(d, "value", "amount", "fee"),
      expected_close_on: isoDate(pick(d, "expected_close_date", "close_date")),
      notes: pick(d, "description", "notes"),
      created_at: isoStamp(pick(d, "created_at")) ?? undefined,
    });
    report.deals++;
  }
  console.log(`  ${report.deals} deals`);
}

async function importSchedule() {
  console.log("\nSchedule");
  const people = await existingMap("tal_people");

  for await (const s of walk("/schedule_items")) {
    const loxoPersonId = String(pick(s, "person.id", "person_id") ?? "");
    const personId = people.get(loxoPersonId);
    if (!personId) continue;

    const startsAt = isoStamp(pick(s, "starts_at", "start_time", "scheduled_at", "date"));
    if (!startsAt) continue;

    await put("tal_interviews", {
      external_id: String(s.id),
      person_id: personId,
      kind: /interview/i.test(String(pick(s, "name", "title") ?? "")) ? "interview" : "meeting",
      title: pick(s, "name", "title"),
      starts_at: startsAt,
      ends_at: isoStamp(pick(s, "ends_at", "end_time")),
      location: pick(s, "location"),
      notes: pick(s, "notes", "description"),
      status: "completed",
    });
    report.interviews++;
  }
  console.log(`  ${report.interviews} scheduled items`);
}

// ---------------------------------------------------------------------------

const STAGES = {
  companies: importCompanies,
  people: importPeople,
  jobs: importJobs,
  candidates: importCandidates,
  activities: importActivities,
  deals: importDeals,
  schedule: importSchedule,
};

async function main() {
  console.log(`\nLoxo -> talent  ${DRY ? "(DRY RUN — nothing will be written)" : ""}`);
  console.log(`  source: ${BASE}`);
  if (!DRY) console.log(`  target: ${SUPABASE_URL}`);
  if (LIMIT) console.log(`  limit:  ${LIMIT} per collection`);

  // Order matters: companies before people, people and jobs before pipelines.
  const run = ONLY ? [ONLY] : Object.keys(STAGES);
  for (const stage of run) {
    if (!STAGES[stage]) throw new Error(`Unknown stage "${stage}". One of: ${Object.keys(STAGES).join(", ")}`);
    try {
      await STAGES[stage]();
    } catch (e) {
      report.errors.push(`${stage}: ${e.message}`);
      console.error(`  ✗ ${stage} stopped: ${e.message}`);
    }
  }

  console.log("\n─────────────────────────────");
  for (const [k, v] of Object.entries(report)) {
    if (typeof v === "number" && v) console.log(`  ${k.padEnd(12)} ${v}`);
  }

  if (report.unmappedStages.size) {
    console.log("\n  Stages that could not be matched (candidates left with no stage):");
    for (const [name, n] of report.unmappedStages) console.log(`    ${name} — ${n}`);
    console.log("  Add these in Settings -> Talent -> Pipelines, then re-run --only=candidates.");
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
