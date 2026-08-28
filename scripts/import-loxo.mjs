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
 * What cannot come across: ANY EMAIL WORDING.
 *
 * Loxo's API has no email or SMS template endpoint, and -- checked against the
 * live account rather than assumed -- /campaigns and /campaigns/{id} return
 * only metadata: name, job, stage, recipient and stage counts. No subject, no
 * body. So neither the saved templates nor the campaign copy is reachable.
 *
 * Every one of them has to be copied by hand. /settings/talent -> Templates has
 * a bulk paste box to make that as quick as it can be, and it is worth asking
 * Loxo support for an export first.
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
/*
 * A re-run is normally a resume, so people already carrying a Loxo id are
 * skipped by default -- re-walking eighteen thousand profiles to rewrite them
 * identically is most of the runtime and none of the value. --refresh forces
 * every record to be re-read, which is what you want after a mapping change.
 */
const REFRESH = args.includes("--refresh");
const CONCURRENCY = Number(args.find((a) => a.startsWith("--concurrency="))?.split("=")[1] ?? 3);

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

/**
 * Runs `fn` over a list, `limit` at a time.
 *
 * Each person costs two extra requests for their work history and education,
 * and done strictly one at a time that is the whole runtime -- the script
 * spends it waiting on Loxo rather than doing anything. Six at once is well
 * inside their rate limiter and turns hours into minutes; the 429 handler in
 * get() is what catches it if that ever stops being true.
 */
async function inParallel(items, limit, fn) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (;;) {
      const item = queue.shift();
      if (item === undefined) return;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/** Buffers rows and upserts them in blocks rather than one request each. */
function batcher(table, size = 250) {
  let buffer = [];
  const flush = async () => {
    if (!buffer.length || DRY) { buffer = []; return 0; }
    const rows = buffer;
    buffer = [];
    const { error } = await db
      .from(table)
      .upsert(rows.map((r) => ({ ...r, external_source: SOURCE })),
              { onConflict: "external_source,external_id" });
    if (error) throw new Error(`${table}: ${error.message}`);
    return rows.length;
  };
  return {
    async add(row) {
      buffer.push(row);
      return buffer.length >= size ? flush() : 0;
    },
    flush,
  };
}

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
/*
 * Endpoints that reject `per_page` outright with a 422. Loxo is not uniform
 * about this and there is no way to tell from the response shape, so the two
 * that do it are named.
 */
const NO_PAGING = [/^\/deals/, /^\/placements/, /^\/workflows/, /^\/activity_types/,
                   /^\/dynamic_fields/, /^\/person_lists/, /^\/users/, /^\/workflow_stages/];

async function* walk(path, perPage = 100) {
  let scrollId = null;
  let page = 1;
  let seen = 0;

  if (NO_PAGING.some((re) => re.test(path))) {
    for (const row of listOf(await optional(path))) {
      yield row;
      if (LIMIT && ++seen >= LIMIT) return;
    }
    return;
  }

  /*
   * The first request asks for neither a page nor a scroll id, because Loxo
   * rejects `page` outright on the scroll endpoints -- and there is no way to
   * know which is which until it answers. What comes back decides: a scroll_id
   * means follow the scroll, a full page without one means count pages.
   */
  for (;;) {
    const sep = path.includes("?") ? "&" : "?";
    const q = scrollId
      ? `${sep}per_page=${perPage}&scroll_id=${encodeURIComponent(scrollId)}`
      : page > 1
        ? `${sep}per_page=${perPage}&page=${page}`
        : `${sep}per_page=${perPage}`;

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

/*
 * Order is the whole thing here. Hannah has stages called "Interviewed But
 * Rejecting" and "Interviewed but Rejected", and testing for "interview"
 * before "reject" files both of them as interviews -- which inflates every
 * interview number in the reports and leaves two dead-end stages looking live.
 * The outcome words are therefore tested first, and the activity words after.
 */
const STAGE_HINTS = [
  [/(reject|decline|passed on|withdraw|not.?interest|lost|unqualified)/i, "rejected"],
  [/(placed|hired|start(ed)?$|accepted)/i, "placed"],
  [/(offer|negotiat)/i, "offer"],
  [/(submit|present|shortlist|client.review)/i, "submitted"],
  [/(interview|onsite)/i, "interview"],
  [/(screen|qualif|prescreen|phone)/i, "screening"],
  [/(respond|repl|engag|interest)/i, "responded"],
  [/(contact|outreach|reach)/i, "contacted"],
  [/(source|identif|research)/i, "sourced"],
];
const stageKind = (name) => STAGE_HINTS.find(([re]) => re.test(name))?.[1] ?? "other";
const COLOURS = ["slate", "sky", "cyan", "indigo", "violet", "amber", "orange", "emerald", "rose"];

async function importConfig() {
  console.log("\nConfiguration");

  // --- Pipelines. The thing a recruiter would most hate to rebuild. --------
  const workflows = listOf(await optional("/workflows"));
  /*
   * Loxo marks the candidate pipeline with `candidate: true` -- there is also
   * a deal workflow and a pitch pipeline on the same endpoint, and importing
   * those as job pipelines would put three unrelated boards in the picker.
   */
  const candidateWorkflows = workflows.filter((w) => w.candidate !== false);
  for (const [i, w] of candidateWorkflows.entries()) {
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
    if (w.candidate === true || i === 0) defaultWorkflowId = workflowId;
    report.workflows++;

    // Stages come from Loxo in their real order, so the board looks the same.
    const stages = listOf(await optional(`/workflow_stages?workflow_id=${w.id}`));
    for (const [pos, s] of stages.entries()) {
      const stageName = pick(s, "name", "title") ?? `Stage ${s.id}`;
      stageNameByLoxoId.set(String(s.id), stageName);

      if (DRY) { stageIdByLoxoId.set(String(s.id), "dry-run"); report.stages++; continue; }

      const { data: had } = await db.from("tal_workflow_stages")
        .select("id").eq("workflow_id", workflowId).ilike("name", stageName).maybeSingle();

      const kind = stageKind(stageName);
      const shape = {
        workflow_id: workflowId, name: stageName, kind,
        position: Number(pick(s, "position", "order", "sort_order") ?? pos),
        color: COLOURS[Math.min(pos, COLOURS.length - 1)],
        is_terminal: kind === "placed" || kind === "rejected",
      };

      // Updated rather than skipped: a re-run is how a mis-classified stage
      // gets corrected, and skipping would make the fix unreachable.
      let stageId = had?.id;
      if (stageId) {
        await db.from("tal_workflow_stages").update(shape).eq("id", stageId);
      } else {
        const { data, error } = await db.from("tal_workflow_stages")
          .insert(shape).select("id").single();
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
    const name = pick(t, "title", "name");
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
    "Email and SMS templates have no Loxo API endpoint, and campaign subject lines " +
    "and bodies are not exposed either — checked against the live account, not assumed. " +
    "All of that wording has to be copied by hand: /settings/talent -> Templates has a " +
    "bulk paste box. Ask Loxo support for an export first."
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
  const already = REFRESH ? new Map() : await existingMap("tal_people");
  if (already.size) console.log(`  ${already.size} already here — skipping (use --refresh to redo)`);

  /*
   * Buffered a page at a time and then worked in parallel. The generator stays
   * sequential because Loxo's scroll cursor has to be followed in order; only
   * the per-person work fans out.
   */
  let batch = [];
  let skipped = 0;

  const flush = async () => {
    if (!batch.length) return;
    const work = batch;
    batch = [];
    await inParallel(work, CONCURRENCY, async (p) => {
      try {
    const { first, last } = splitName(pick(p, "name"), pick(p, "first_name"), pick(p, "last_name"));

      /*
       * One request for the whole person.
       *
       * /people/{id} returns job_profiles, education_profiles, emails, phones
       * and resumes inline, where asking for each separately was three or four
       * round trips. That matters more than it looks: Loxo throttles hard --
       * sixteen workers on the old shape produced a rate-limit response on
       * forty-seven of forty-eight people -- so the ceiling is requests per
       * second, and the only real lever is asking fewer times.
       */
      const full = (await optional(`/people/${p.id}`)) ?? p;
      const emails = full.emails ?? p.emails ?? [];
      const phones = full.phones ?? p.phones ?? [];

      const companyId = pick(full, "company.id", "company_id");

      const personId = await put("tal_people", {
        external_id: String(p.id),
        first_name: first,
        last_name: last,
        title: pick(full, "current_title", "title", "job_title"),
        company_id: companyId ? companies.get(String(companyId)) ?? null : null,
        company_name: nameOf(pick(full, "current_company", "company", "employer")),
        emails: contacts(emails, ["value", "email", "address"], ["email_type", "type"]),
        phones: contacts(phones, ["value", "phone", "number"], ["phone_type", "type"]),
        linkedin_url: pick(full, "linkedin_url", "linkedin"),
        personal_website: pick(full, "website", "blog_url"),
        city: pick(full, "city", "location.city"),
        state: pick(full, "state", "location.state"),
        country: pick(full, "country"),
        // Loxo returns person_types as an array of {id,name}; ours is text[].
        person_types: (listOf(full.person_types).map((t) => nameOf(t)).filter(Boolean)
          .map((t) => String(t).toLowerCase())).length
          ? listOf(full.person_types).map((t) => String(nameOf(t) ?? "").toLowerCase()).filter(Boolean)
          : ["candidate"],
        skills: listOf(pick(full, "skillsets", "skills")).map((s) => nameOf(s) ?? s).filter(Boolean),
        /*
         * Loxo calls this `description` and its users call it the intake note.
         * It is the single most valuable free-text field in the system and the
         * one a recruiter would most notice missing.
         */
        summary: pick(full, "description", "blurb", "summary", "notes"),
        // Loxo sends money as strings.
        current_salary: Number(pick(full, "current_compensation", "salary")) || null,
        salary_expectation: Number(pick(full, "compensation", "desired_compensation")) || null,
        compensation_notes: pick(full, "compensation_notes"),
        source: "import",
        source_detail: `Loxo — ${nameOf(pick(full, "source_type")) ?? "migrated"}`,
        do_not_contact: !!pick(full, "do_not_contact", "blocked", "opted_out"),
        created_at: isoStamp(pick(full, "created_at")) ?? undefined,
      });

      /*
       * Loxo dates these by month and year rather than a date, so a role that ran
       * "2019 - 2022" has no day in it. Rebuilt as the first of the month, which
       * is the only honest reading -- inventing a day would look like precision
       * that was never there.
       */
      const ym = (month, year) =>
        year ? `${year}-${String(month || 1).padStart(2, "0")}-01` : null;

      for (const [scoped, table, map] of [
        ["job_profiles", "tal_person_jobs", (j, i) => ({
          person_id: personId,
          company_name: nameOf(pick(j, "company", "company_name")),
          title: pick(j, "title", "position"),
          description: pick(j, "description", "summary"),
          started_on: ym(j.month, j.year),
          ended_on: ym(j.end_month, j.end_year),
          is_current: !j.end_year,
          position: i,
        })],
        ["education_profiles", "tal_person_educations", (e, i) => ({
          person_id: personId,
          school: nameOf(pick(e, "school", "institution")),
          degree: nameOf(pick(e, "degree")) ?? nameOf(pick(e, "education_type")),
          field_of_study: pick(e, "field_of_study", "major", "description"),
          started_on: ym(e.month, e.year),
          ended_on: ym(e.end_month, e.end_year),
          position: i,
        })],
      ]) {
        const rows = listOf(await optional(`/people/${p.id}/${scoped}`));
        if (!rows.length || DRY) continue;
        // Replaced wholesale: no stable id to upsert against, and a re-run must
        // not stack three copies of the same job history.
        await db.from(table).delete().eq("person_id", personId);
        await db.from(table).insert(rows.map(map));
      }

      if (WITH_RESUMES) await importResumes(p.id, personId);

      report.people++;
        if (report.people % 250 === 0) {
          console.log(`  ${report.people}${already.size ? ` (+${already.size} already had)` : ""}…`);
        }
      } catch (e) {
        report.errors.push(`person ${p.id}: ${e instanceof Error ? e.message : e}`);
      }
    });
  };

  for await (const p of walk("/people")) {
    if (already.has(String(p.id))) { skipped++; continue; }
    batch.push(p);
    if (batch.length >= CONCURRENCY * 4) await flush();
  }
  await flush();

  if (skipped) console.log(`  ${skipped} skipped, already imported`);
  console.log(`  ${report.people} people`);
}

async function importResumes(personId, resumes) {
  for (const r of resumes) {
    const url = pick(r, "download_url", "url", "file_url", "s3_url");
    const name = pick(r, "name", "filename", "file_name") ?? "Resume";
    if (!url || DRY) continue;

    try {
      /*
       * No Authorization header. download_url is a short-lived presigned S3
       * link and S3 rejects a request that carries both its own signature and
       * a bearer token.
       */
      const file = await fetch(url);
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
      report.errors.push(`resume ${r.id}: ${e.message}`);
    }
  }
}

async function importJobs() {
  console.log("\nJobs");
  const companies = await existingMap("tal_companies");

  for await (const row of walk("/jobs")) {
    /*
     * The list payload carries no description at all -- it is only on
     * /jobs/{id}. There are a hundred and thirty-nine of them, so fetching each
     * one is cheap, and a job advert with no text is not worth migrating.
     */
    const j = (await optional(`/jobs/${row.id}`)) ?? row;
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
      /*
       * description is HTML and runs to tens of kilobytes -- one of these is
       * 69KB, which times out the insert once the generated tsvector and its
       * GIN index are built over it. description_text is Loxo's own plain
       * rendering; where that is missing the markup is stripped and the result
       * capped, because past about twenty thousand characters it is boilerplate
       * rather than a job description.
       */
      description: (() => {
        const text = pick(j, "description_text")
          ?? String(pick(j, "description") ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        return text ? text.slice(0, 20000) : null;
      })(),
      requirements: pick(j, "requirements", "qualifications"),
      internal_notes: pick(j, "internal_notes", "notes"),
      city: pick(j, "city"),
      state: pick(j, "state_code", "state"),
      country: pick(j, "country_code", "country"),
      remote: pick(j, "remote_work_allowed") ? "remote" : "onsite",
      salary_min: Number(pick(j, "salary_min")) || null,
      salary_max: Number(pick(j, "salary_max")) || null,
      fee_flat: Number(pick(j, "fee")) || null,
      openings: pick(j, "openings", "positions") ?? 1,
      opened_on: isoDate(pick(j, "opened_at", "published_at", "created_at")),
      closed_at: isoStamp(pick(j, "filled_at")),
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

    const loxoStageId = String(pick(c, "workflow_stage_id", "workflow_stage.id") ?? "");
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
      status: /placed|hired/i.test(stageName ?? "") ? "hired"
            : /reject/i.test(stageName ?? "") || pick(c, "candidate_rejection_reason")
              ? "rejected" : "active",
      rejection_reason: nameOf(pick(c, "candidate_rejection_reason")),
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

  /*
   * Written in blocks rather than one request per event. There are north of a
   * hundred thousand of these, and a round trip each is the difference between
   * twenty minutes and two hours -- the previous version spent almost all of
   * its time waiting on PostgREST rather than on anything useful.
   */
  const batch = batcher("tal_activities", 250);
  let orphaned = 0;

  for await (const e of walk("/person_events")) {
    const personId = people.get(String(pick(e, "person.id", "person_id") ?? ""));
    // An event whose person was not imported has nowhere to live. Counted, not
    // guessed at -- it usually means the people stage did not finish.
    if (!personId) { orphaned++; continue; }

    const typeName = nameOf(pick(e, "activity_type", "event_type", "type"));
    await batch.add({
      external_id: String(e.id),
      person_id: personId,
      job_id: jobs.get(String(pick(e, "job.id", "job_id") ?? "")) ?? null,
      activity_type_id: typeName ? types.get(typeName.toLowerCase()) ?? null : null,
      // A person event has no subject line -- the activity type is the label
      // and `notes` is everything that was written.
      subject: typeName,
      body: pick(e, "notes"),
      pinned: !!pick(e, "pinned"),
      occurred_at: isoStamp(pick(e, "created_at", "occurred_at", "date")) ?? new Date().toISOString(),
    });

    report.activities++;
    if (report.activities % 2500 === 0) console.log(`  ${report.activities}…`);
  }
  await batch.flush();

  if (orphaned) {
    report.notes.push(
      `${orphaned} activity events belong to people who are not imported yet — ` +
      "finish the people stage and re-run --only=activities."
    );
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
      title: pick(pl, "job.title", "title"),
      started_on: isoDate(pick(pl, "start_date")),
      ended_on: isoDate(pick(pl, "end_date")),
      // Money comes back as strings on this endpoint.
      salary: Number(pick(pl, "salary")) || null,
      fee_amount: Number(pick(pl, "fee")) || null,
      fee_type: /percent/i.test(String(nameOf(pick(pl, "fee_type")) ?? "")) ? "percentage" : "flat",
      bill_rate: Number(pick(pl, "bill_rate")) || null,
      pay_rate: Number(pick(pl, "pay_rate")) || null,
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
 * Campaigns.
 *
 * Metadata only, and not for want of trying: /campaigns and /campaigns/{id}
 * both return name, job, stage and recipient counts and nothing else. There is
 * no subject and no body anywhere on the endpoint, so the wording Hannah wrote
 * cannot be pulled out of Loxo by any route the API offers.
 *
 * What comes across is therefore the record that a campaign ran, against which
 * job and stage, and who was in it -- useful history, but the copy has to be
 * re-entered by hand along with the templates.
 */
async function importCampaigns() {
  console.log("\nCampaigns");
  const people = await existingMap("tal_people");
  const jobs = await existingMap("tal_jobs");

  for await (const c of walk("/campaigns")) {
    const name = pick(c, "name", "title") ?? `Campaign ${c.id}`;
    if (DRY) { report.campaigns++; continue; }

    const { data: had } = await db.from("tal_campaigns")
      .select("id").eq("external_source", SOURCE).eq("external_id", String(c.id)).maybeSingle();

    let campaignId = had?.id;
    if (!campaignId) {
      const { data, error } = await db.from("tal_campaigns")
        .insert({
          name,
          job_id: jobs.get(String(pick(c, "job_id") ?? "")) ?? null,
          // Archived, not draft: these already ran, over there. Leaving them
          // active would put historic sequences back in the send queue.
          status: "archived",
          mode: "semi",
          audience: "candidate",
          external_source: SOURCE,
          external_id: String(c.id),
          created_at: isoStamp(pick(c, "created_at")) ?? undefined,
        })
        .select("id").single();
      if (error) { report.errors.push(`campaign ${name}: ${error.message}`); continue; }
      campaignId = data.id;
    }

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

  report.notes.push(
    `${report.campaigns} campaigns came across as history. Their subject lines and ` +
    "bodies did not — Loxo's API does not expose campaign copy, only counts."
  );
  console.log(`  ${report.campaigns} campaigns (metadata only — no message bodies exist on the API)`);
}

async function importSchedule() {
  console.log("\nSchedule");
  const people = await existingMap("tal_people");
  const jobs = await existingMap("tal_jobs");

  for await (const s of walk("/schedule_items")) {
    const personId = people.get(String(pick(s, "person.id", "person_id") ?? ""));
    if (!personId) continue;
    const startsAt = isoStamp(pick(s, "start_time", "starts_at"));
    if (!startsAt) continue;

    const title = String(pick(s, "title", "name") ?? "");
    await put("tal_interviews", {
      external_id: String(s.id),
      person_id: personId,
      job_id: jobs.get(String(pick(s, "job.id", "job_id") ?? "")) ?? null,
      kind: /interview/i.test(title) ? "interview" : "meeting",
      title: title || null,
      starts_at: startsAt,
      ends_at: isoStamp(pick(s, "end_time", "ends_at")),
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
    const stage = String(nameOf(pick(d, "current_pipeline_stage", "deal_stage", "stage")) ?? "").toLowerCase();
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
      value: Number(pick(d, "amount", "expected_amount")) || null,
      expected_close_on: isoDate(pick(d, "closes_at")),
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
