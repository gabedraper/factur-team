/*
 * Loxo reconnaissance. Reads, counts, and writes nothing.
 *
 * Run this before import-loxo.mjs. A migration written against a guess at the
 * other system's payloads is a migration that silently drops half the fields,
 * so this walks every endpoint, reports how much is behind it, and prints the
 * keys of one real record from each. The output is what the mapping gets
 * finished against.
 *
 *   LOXO_API_KEY=... LOXO_AGENCY_SLUG=... node scripts/loxo-probe.mjs
 *
 * Nothing here needs the Supabase credentials -- it never touches the database.
 */

const API_KEY = process.env.LOXO_API_KEY;
const SLUG = process.env.LOXO_AGENCY_SLUG;
const DOMAIN = process.env.LOXO_DOMAIN || "app.loxo.co";

if (!API_KEY || !SLUG) {
  throw new Error(
    "Set LOXO_API_KEY and LOXO_AGENCY_SLUG in the environment before running this script.\n" +
    "Both come from Loxo: Settings -> API Keys -> + Add. The slug is the first part of\n" +
    "your Loxo address, e.g. https://factur.app.loxo.co -> factur."
  );
}

const BASE = `https://${DOMAIN}/api/${SLUG}`;

async function get(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { accept: "application/json", authorization: `Bearer ${API_KEY}` },
  });
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { ok: res.ok, status: res.status, body };
}

/*
 * Loxo is not consistent about what it wraps a list in -- some endpoints return
 * a bare array, some a { people: [...] }, some a { results: [...] }. Rather than
 * hard-coding one per endpoint, find the first array-valued key.
 */
function listOf(body) {
  if (Array.isArray(body)) return { rows: body, key: "(bare array)" };
  if (body && typeof body === "object") {
    for (const [k, v] of Object.entries(body)) {
      if (Array.isArray(v)) return { rows: v, key: k };
    }
  }
  return { rows: [], key: null };
}

function totalOf(body) {
  if (!body || typeof body !== "object") return null;
  for (const k of ["total_count", "total", "count", "total_results"]) {
    if (typeof body[k] === "number") return body[k];
  }
  return null;
}

async function probe(label, path, { showKeys = true } = {}) {
  const { ok, status, body } = await get(path);
  if (!ok) {
    console.log(`  ✗ ${label.padEnd(22)} ${status}  ${String(body).slice(0, 90)}`);
    return null;
  }
  const { rows, key } = listOf(body);
  const total = totalOf(body);
  const scroll = body?.scroll_id ? " scroll_id ✓" : "";
  console.log(
    `  ✓ ${label.padEnd(22)} ${String(total ?? rows.length).padStart(6)} ` +
    `${total !== null ? "total" : "in page"}   wrapper: ${key ?? "—"}${scroll}`
  );
  if (showKeys && rows[0] && typeof rows[0] === "object") {
    console.log(`      fields: ${Object.keys(rows[0]).join(", ")}`);
  }
  return { rows, total, body };
}

async function main() {
  console.log(`\nLoxo probe — ${BASE}\n`);

  console.log("Reference data");
  await probe("users", "/users");
  await probe("activity_types", "/activity_types");
  await probe("person_types", "/person_types");
  await probe("source_types", "/source_types");
  await probe("dynamic_fields", "/dynamic_fields/person");
  await probe("deal_workflows", "/deal_workflows");

  console.log("\nRecords");
  const companies = await probe("companies", "/companies?per_page=1");
  const people = await probe("people", "/people?per_page=1");
  const jobs = await probe("jobs", "/jobs?per_page=1&page=1");
  const events = await probe("person_events", "/person_events?per_page=1");
  const deals = await probe("deals", "/deals?per_page=1");
  await probe("schedule_items", "/schedule_items?per_page=1");
  await probe("placements", "/placements?per_page=1");

  /*
   * The per-person sub-resources are separate calls in Loxo, which is the
   * single biggest cost of the migration: one person is five requests, so
   * knowing the person count up front is knowing how long it will take.
   */
  const samplePerson = people?.rows?.[0];
  if (samplePerson?.id) {
    console.log(`\nPerson sub-resources (sample id ${samplePerson.id})`);
    await probe("  emails", `/people/${samplePerson.id}/emails`);
    await probe("  phones", `/people/${samplePerson.id}/phones`);
    await probe("  job_profiles", `/people/${samplePerson.id}/job_profiles`);
    await probe("  education_profiles", `/people/${samplePerson.id}/education_profiles`);
    await probe("  resumes", `/people/${samplePerson.id}/resumes`);
  }

  const sampleJob = jobs?.rows?.[0];
  if (sampleJob?.id) {
    console.log(`\nPipeline (sample job ${sampleJob.id} — ${sampleJob.title ?? "?"})`);
    const cands = await probe("  candidates", `/jobs/${sampleJob.id}/candidates?per_page=3`);
    const stages = new Set();
    for (const c of cands?.rows ?? []) {
      const s = c.workflow_stage?.name ?? c.workflow_stage ?? c.stage?.name ?? c.stage;
      if (s) stages.add(typeof s === "string" ? s : JSON.stringify(s));
    }
    if (stages.size) console.log(`      stages seen: ${[...stages].join(" · ")}`);
  }

  console.log("\nEstimated migration size");
  const n = (p) => p?.total ?? p?.rows?.length ?? "?";
  console.log(`  companies      ${n(companies)}`);
  console.log(`  people         ${n(people)}   (× ~5 requests each for sub-resources)`);
  console.log(`  jobs           ${n(jobs)}`);
  console.log(`  activities     ${n(events)}`);
  console.log(`  deals          ${n(deals)}`);
  console.log("\nNothing was written. Send this output back and the mapping gets finished against it.\n");
}

main().catch((e) => {
  console.error("\nProbe failed:", e.message, "\n");
  process.exit(1);
});
