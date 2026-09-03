/*
 * Pushes lib/market/taxonomy.ts into market_terms, market_naics and
 * crm_industry_naics, refusing to write anything if the maps do not hold up.
 *
 * The checks matter more than the upload. Both failure modes here are silent:
 * a mistyped NAICS code shrinks a market instead of erroring, and a code that
 * is a prefix of another in the same list counts the same establishments twice
 * and inflates it. Either way the ratio still renders, still looks plausible,
 * and is wrong. So the codes are checked against what the Census release
 * actually contains before a single row goes up.
 *
 *   node scripts/sync-market-taxonomy.mjs [--dry]
 *
 * Run scripts/load-census-cbp.mjs first -- validation needs naics_industries.
 */
import fs from "node:fs";
import path from "node:path";
import { MARKET_NAICS, MARKET_TERMS, CRM_INDUSTRY_NAICS } from "../lib/market/taxonomy.ts";

const DRY = process.argv.includes("--dry");

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

async function rest(pathAndQuery, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  // `return=minimal` answers 201 with an empty body, which JSON.parse hates.
  const body = await res.text();
  return body ? JSON.parse(body) : null;
}

// --- What the Census actually published ------------------------------------

const known = new Set();
for (let page = 0; ; page++) {
  const batch = await rest(`naics_industries?select=code&limit=1000&offset=${page * 1000}`);
  batch.forEach((r) => known.add(r.code));
  if (batch.length < 1000) break;
}
console.log(`${known.size} NAICS codes on file`);

// --- Validation -------------------------------------------------------------

const problems = [];

function checkCodes(label, codes) {
  for (const code of codes) {
    if (!known.has(code)) problems.push(`${label}: ${code} is not a published NAICS code`);
  }
  // A prefix of a sibling means the same establishments counted twice.
  for (const a of codes) {
    for (const b of codes) {
      if (a !== b && b.startsWith(a)) {
        problems.push(`${label}: ${a} contains ${b} -- the sum would double-count`);
      }
    }
  }
  if (new Set(codes).size !== codes.length) problems.push(`${label}: duplicate codes`);
}

for (const [market, codes] of Object.entries(MARKET_NAICS)) checkCodes(`market ${market}`, codes);
for (const [industry, codes] of Object.entries(CRM_INDUSTRY_NAICS)) checkCodes(`industry ${industry}`, codes);

for (const [term, market] of Object.entries(MARKET_TERMS)) {
  if (!MARKET_NAICS[market]) problems.push(`term "${term}" points at unknown market "${market}"`);
  if (term !== term.toLowerCase().trim()) problems.push(`term "${term}" is not lowercased and trimmed`);
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s), nothing written:\n`);
  problems.forEach((p) => console.error(`  ${p}`));
  process.exit(1);
}

// Markets nobody can reach are dead weight -- worth saying, not worth failing.
const reachable = new Set(Object.values(MARKET_TERMS));
const orphans = Object.keys(MARKET_NAICS).filter((m) => !reachable.has(m));
if (orphans.length) console.log(`note: ${orphans.length} market(s) no term maps to: ${orphans.join(", ")}`);

// --- Upload -----------------------------------------------------------------

const termRows = Object.entries(MARKET_TERMS).map(([term, market]) => ({ term, market }));
const marketRows = Object.entries(MARKET_NAICS).flatMap(([market, codes]) =>
  codes.map((naics) => ({ market, naics })),
);
const industryRows = Object.entries(CRM_INDUSTRY_NAICS).flatMap(([industry, codes]) =>
  codes.map((naics) => ({ industry, naics })),
);

console.log(
  `${termRows.length} terms -> ${Object.keys(MARKET_NAICS).length} markets, ` +
    `${marketRows.length} market/NAICS pairs, ${industryRows.length} industry/NAICS pairs`,
);

if (DRY) {
  console.log("dry run, nothing written");
  process.exit(0);
}

async function upsert(table, rows, onConflict) {
  for (let i = 0; i < rows.length; i += 500) {
    await rest(`${table}?on_conflict=${onConflict}`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows.slice(i, i + 500)),
    });
  }
  console.log(`  ${table}: ${rows.length}`);
}

await upsert("market_terms", termRows, "term");
await upsert("market_naics", marketRows, "market,naics");
await upsert("crm_industry_naics", industryRows, "industry,naics");

console.log("done");
