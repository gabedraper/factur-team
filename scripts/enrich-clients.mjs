/*
 * Reads each client's own website and records what kind of business they are.
 *
 * Salesforce already knows the type of work for most clients and the headcount
 * for about two thirds, and where it does, it wins -- those labels were put
 * there by the people who ran the account. This fills the holes and adds the
 * one thing Salesforce never captured: what the client can actually make. That
 * capability list is what turns "manufacturing client" into a cohort you can
 * compare against another cohort.
 *
 * Resumable. A client with a client_profile row is skipped, including one whose
 * last run ended in an error -- a domain that was dead yesterday is still dead
 * today, and retrying 200 of them on every run is how a backfill never finishes.
 * Use --force to override, or --retry-errors to have another go at the failures.
 *
 *   node scripts/enrich-clients.mjs [--limit N] [--force] [--retry-errors]
 *                                   [--concurrency N] [--dry]
 *
 * Needs ANTHROPIC_API_KEY alongside the usual Supabase vars in .env.local.
 */
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";

// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(argv[i + 1]);
};

const LIMIT = value("limit", Infinity);
const CONCURRENCY = value("concurrency", 5);
const FORCE = flag("force");
const RETRY_ERRORS = flag("retry-errors");
const DRY = flag("dry");

const env = Object.fromEntries(
  fs
    .readFileSync(path.join(process.cwd(), ".env.local"), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const API_KEY = process.env.ANTHROPIC_API_KEY || env.ANTHROPIC_API_KEY;
/*
 * Opus reads a messy trade website far better than the cheaper models, and
 * this runs once per client for the life of the account. Override if the bill
 * matters more than the labels: ENRICH_MODEL=claude-haiku-4-5.
 */
const MODEL = process.env.ENRICH_MODEL || "claude-opus-5";

if (!API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set (env or .env.local).");
  process.exit(1);
}

const anthropic = new Anthropic({ apiKey: API_KEY });

// ---------------------------------------------------------------------------

/*
 * The 22 values the team already uses on Clients__c.Type_of_Work__c. Held here
 * verbatim so a gap this script fills sits in the same cohort as a gap someone
 * filled by hand -- a new label invented on the fly is a cohort of one.
 */
const TYPES_OF_WORK = [
  "Industrial Supplier (manufactur and supply their own products, maybe source mfg)",
  "CNC Job Shop (smaller shop, smaller capacity, fewer certs)",
  "Contract MFG (bigger shop, automation set up, certifications/registration)",
  "Fabrication",
  "Automation / System Integrator",
  "Facility Maintenance (landscapers, roofers, security systems, safetys systems)",
  "Engineering (Product Design, Engineer Services, 3D Models)",
  "B2B OEM",
  "EMS (Electrical MFG Services = wire harnesses, pcb assembly, control boxes etc.)",
  "Software MES / ERP, Fault Check, Resellers, PLC, Scada, Other",
  "Consulting",
  "Distributors",
  "Plastics Injection Molding - high volume, low precision",
  "Machine Builders",
  "Finishing (Coatings, Plating, Surface Finishes, laser etching, adhesives)",
  "Operations Technologies (IOT, IT Support)",
  "Plastics Injection Molding - low volume, high precision",
  "Product Development (includes market offer, engineering, consulting)",
  "Swiss Machining / High Vol",
  "Stamping",
  "Foundry",
  "Maintenance Repair and Operation (MRO)",
];

const SCHEMA = {
  type: "object",
  properties: {
    reachable: {
      type: "boolean",
      description: "False if the site is dead, parked, or not this company's.",
    },
    website_used: { type: "string" },
    business_type: {
      type: "string",
      enum: TYPES_OF_WORK,
      description: "The closest match from the list. Pick one even if imperfect.",
    },
    capabilities: {
      type: "array",
      items: { type: "string" },
      description:
        "Processes and services offered, as the site names them: '5-axis CNC milling', 'wire EDM', 'powder coating'. 3-12 entries.",
    },
    materials: {
      type: "array",
      items: { type: "string" },
      description: "Materials worked: 'aluminium', 'titanium', 'ABS'. Empty if not stated.",
    },
    certifications: {
      type: "array",
      items: { type: "string" },
      description: "Quality and regulatory: 'ISO 9001:2015', 'AS9100D', 'ITAR'. Empty if none stated.",
    },
    markets_served: {
      type: "array",
      items: { type: "string" },
      description: "End markets: 'aerospace', 'medical devices', 'food processing'.",
    },
    size_band: { type: "string", enum: ["micro", "small", "mid", "large"] },
    employees_est: {
      type: ["integer", "null"],
      description: "Best estimate of headcount, or null if there is nothing to go on.",
    },
    summary: {
      type: "string",
      description: "One sentence on what this company does and who buys from it.",
    },
    confidence: {
      type: "string",
      enum: ["high", "medium", "low"],
      description:
        "high: the site says all of this plainly. medium: inferred from partial evidence. low: guesswork.",
    },
  },
  required: [
    "reachable", "website_used", "business_type", "capabilities", "materials",
    "certifications", "markets_served", "size_band", "employees_est",
    "summary", "confidence",
  ],
  additionalProperties: false,
};

const SYSTEM = `You research industrial and manufacturing companies from their own websites.

Read the site given to you. Fetch the pages that carry the answers -- capabilities, equipment, about, quality, industries served -- not just the home page.

Rules:
- Report what the site says. Do not pad a thin site with what a company of that description usually does.
- Size: prefer a stated headcount or an "our team" page. Failing that, infer from equipment lists, facility square footage, and number of locations, and say so by lowering confidence. Bands: micro under 10, small 10-49, mid 50-249, large 250+.
- If the domain is dead, parked, for sale, or clearly belongs to a different company, set reachable false and leave the lists empty. Do not substitute a search result for a different business with a similar name.
- Prefer the company's own words for capabilities. "Swiss screw machining" beats "machining".`;

// ---------------------------------------------------------------------------

async function rest(pathAndQuery, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function pending() {
  const all = await rest(
    "client_roster?select=salesforce_client_id,name,website,type_of_work,employees&website=not.is.null&order=client_since.desc.nullslast",
  );
  if (FORCE) return all;

  const done = await rest("client_profile?select=salesforce_client_id,error");
  const skip = new Set(
    done
      .filter((p) => !(RETRY_ERRORS && p.error))
      .map((p) => p.salesforce_client_id),
  );
  return all.filter((c) => !skip.has(c.salesforce_client_id));
}

async function profile(client) {
  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: SYSTEM,
    /*
     * Search first so a moved or rebranded site still resolves, then fetch.
     * web_fetch on its own can only reach URLs already in the conversation.
     */
    tools: [
      { type: "web_search_20260209", name: "web_search", max_uses: 4 },
      { type: "web_fetch_20260209", name: "web_fetch", max_uses: 8 },
    ],
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
    messages: [
      {
        role: "user",
        content: `Company: ${client.name}\nWebsite: ${client.website}\n\nRead their site and describe the business.`,
      },
    ],
  });

  const text = message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  return JSON.parse(text);
}

function row(client, p) {
  if (!p.reachable) {
    return {
      salesforce_client_id: client.salesforce_client_id,
      website_used: client.website,
      error: "site unreachable, parked, or not this company",
      enriched_at: new Date().toISOString(),
      model: MODEL,
    };
  }
  return {
    salesforce_client_id: client.salesforce_client_id,
    website_used: p.website_used || client.website,
    business_type: p.business_type,
    capabilities: p.capabilities,
    materials: p.materials,
    certifications: p.certifications,
    markets_served: p.markets_served,
    size_band: p.size_band,
    employees_est: p.employees_est,
    summary: p.summary,
    confidence: p.confidence,
    model: MODEL,
    error: null,
    enriched_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------

const queue = (await pending()).slice(0, LIMIT === Infinity ? undefined : LIMIT);
console.log(`${queue.length} clients to enrich, ${CONCURRENCY} at a time, model ${MODEL}`);
if (DRY) {
  console.log(queue.slice(0, 10).map((c) => `${c.name} -- ${c.website}`).join("\n"));
  process.exit(0);
}

let done = 0;
let failed = 0;

async function worker() {
  for (;;) {
    const client = queue.shift();
    if (!client) return;
    try {
      const written = row(client, await profile(client));
      await rest("client_profile?on_conflict=salesforce_client_id", {
        method: "POST",
        body: JSON.stringify([written]),
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      });
      done += 1;
      const note = written.error ? "unreachable" : `${written.business_type} / ${written.size_band}`;
      console.log(`[${done + failed}] ${client.name} -- ${note}`);
    } catch (e) {
      /*
       * Recorded rather than thrown, so one bad site cannot end the run. The
       * row is written with the reason, which is also what makes the skip on
       * the next run deliberate instead of accidental.
       */
      failed += 1;
      console.error(`[${done + failed}] ${client.name} -- FAILED: ${e.message}`);
      await rest("client_profile?on_conflict=salesforce_client_id", {
        method: "POST",
        body: JSON.stringify([
          {
            salesforce_client_id: client.salesforce_client_id,
            website_used: client.website,
            error: String(e.message).slice(0, 500),
            model: MODEL,
            enriched_at: new Date().toISOString(),
          },
        ]),
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      }).catch(() => {});
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(`\ndone: ${done} enriched, ${failed} failed`);
