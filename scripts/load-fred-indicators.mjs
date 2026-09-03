/*
 * Loads sector trend lines from FRED into naics_indicators.
 *
 * Two metrics, both monthly, both keyed to the NAICS code they describe so a
 * client's market chart is a lookup rather than a series hand-picked per
 * client:
 *
 *   industrial_production  IPG<naics>S  -- Federal Reserve G.17, how much the
 *                          sector is physically making, as an index
 *   new_orders             A<naics>SNO  -- Census M3, what customers have just
 *                          ordered, in millions of dollars
 *
 * New orders is the one worth putting in front of a client. Production tells
 * you what a sector did; new orders is the work that has been booked and not
 * yet built, which is the closest thing to a forecast available without buying
 * one. Both are national -- neither survey publishes by state.
 *
 * FRED's CSV endpoint needs no API key, but it also has no catalogue without
 * one, so which series exist is discovered by asking for them. Anything that
 * 404s is simply a sector the Fed does not break out, and is skipped.
 *
 *   node scripts/load-fred-indicators.mjs [--since 2015-01-01] [--dry]
 *
 * Idempotent: re-running replaces the same (series, month) rows.
 */
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const value = (n, fb) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? fb : argv[i + 1];
};
const DRY = argv.includes("--dry");
const SINCE = value("since", "2015-01-01");

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
  const body = await res.text();
  return body ? JSON.parse(body) : null;
}

// --- Which sectors do we actually care about? -------------------------------

/*
 * Only the codes some market or prospect label points at, rolled up to the
 * level the Fed publishes. G.17 stops at four digits, so a market defined on
 * 333120 is charted with its 3331 parent -- the nearest true statement.
 */
const used = new Set();
for (const table of ["market_naics", "crm_industry_naics"]) {
  const rows = await rest(`${table}?select=naics`);
  rows.forEach((r) => used.add(r.naics));
}

const candidates = new Set();
for (const code of used) {
  if (code.length >= 3) candidates.add(code.slice(0, 3));
  if (code.length >= 4) candidates.add(code.slice(0, 4));
}
console.log(`${used.size} codes in use -> ${candidates.size} candidate sectors`);

// --- Fetch ------------------------------------------------------------------

async function fredCsv(seriesId) {
  const res = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}`);
  if (!res.ok) return null;
  const text = await res.text();
  if (!text.startsWith("observation_date")) return null; // FRED serves HTML for a miss

  const out = [];
  for (const line of text.trim().split("\n").slice(1)) {
    const [period, raw] = line.split(",");
    if (!period || period < SINCE) continue;
    if (raw === "." || raw === undefined || raw === "") continue; // FRED's null
    const value = Number(raw);
    if (Number.isFinite(value)) out.push({ period, value });
  }
  return out.length ? out : null;
}

/*
 * Industrial production keys straight off the NAICS code. The M3 order series
 * do not: Census labels them A31S..A37S for NAICS 331..337, dropping the
 * leading 3, and publishes them for durable goods only -- a food or chemicals
 * market gets a production line and no order line.
 *
 * That dropped digit is a coincidence of Census labelling, not a rule, so the
 * match is pinned to 331-337. Left open, construction (236) would happily
 * fetch A36S and file transportation-equipment orders under homebuilding.
 */
const m3 = (c) => /^33[1-7]$/.test(c);

const PATTERNS = [
  { metric: "industrial_production", id: (c) => `IPG${c}S` },
  { metric: "new_orders", id: (c) => (m3(c) ? `A${c.slice(1)}SNO` : null) },
  { metric: "backlog", id: (c) => (m3(c) ? `A${c.slice(1)}SUO` : null) },
];

/*
 * The national backdrop, so a sector line can be read against all of
 * manufacturing rather than in isolation. '31' is how the Census release codes
 * the whole 31-33 manufacturing sector, and naics_establishments agrees.
 */
const NATIONAL = [
  { seriesId: "IPMAN", naics: "31", metric: "industrial_production" },
  { seriesId: "AMTMNO", naics: "31", metric: "new_orders" },
  { seriesId: "AMTMUO", naics: "31", metric: "backlog" },
];

const rows = [];
const found = [];

async function take(seriesId, naics, metric) {
  const obs = await fredCsv(seriesId);
  if (!obs) return;
  found.push(`${seriesId} (${metric}, ${naics})`);
  for (const o of obs) {
    rows.push({ series_id: seriesId, naics, metric, source: "FRED", period: o.period, value: o.value });
  }
}

for (const { seriesId, naics, metric } of NATIONAL) await take(seriesId, naics, metric);

for (const code of [...candidates].sort()) {
  for (const { metric, id } of PATTERNS) {
    const seriesId = id(code);
    if (seriesId) await take(seriesId, code, metric);
  }
}

console.log(`${found.length} series found:\n  ${found.join("\n  ")}`);

if (rows.length === 0) {
  console.error("no series matched -- FRED may have changed its CSV endpoint");
  process.exit(1);
}

const latest = rows.reduce((a, r) => (r.period > a ? r.period : a), "");
console.log(`${rows.length} observations, latest ${latest}`);

if (DRY) {
  console.log("dry run, nothing written");
  process.exit(0);
}

for (let i = 0; i < rows.length; i += 1000) {
  await rest("naics_indicators?on_conflict=series_id,period", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows.slice(i, i + 1000)),
  });
  process.stdout.write(`\r  ${Math.min(i + 1000, rows.length)}/${rows.length}`);
}
console.log("\ndone");
