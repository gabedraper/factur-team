/*
 * Loads the Census County Business Patterns release into naics_industries and
 * naics_establishments. This is the denominator behind every TAM number in the
 * app -- how many companies of a given kind actually exist, per the government.
 *
 * Two files, both public and keyless. The Census API needs a signup key now,
 * the bulk files do not, and for a whole-country load the files are the better
 * door anyway: one download instead of three thousand paged requests.
 *
 *   cbp<yy>us.zip   national totals by industry
 *   cbp<yy>st.zip   the same, split by state
 *
 * Establishment counts are never suppressed, so they sum and compare cleanly.
 * Employment and payroll ARE suppressed in small cells -- Census blanks them
 * rather than expose a single employer -- so those two columns arrive null in
 * places and no total built on them is complete. TAM math here uses
 * establishments for exactly that reason.
 *
 *   node scripts/load-census-cbp.mjs [--year 2023] [--dry]
 *
 * Idempotent: re-running replaces the same (state, industry, year) rows.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const value = (n, fb) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? fb : argv[i + 1];
};

const YEAR = Number(value("year", 2023));
const YY = String(YEAR).slice(2);
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
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const CENSUS = "https://www2.census.gov/programs-surveys/cbp";
const CACHE = path.join(os.tmpdir(), `cbp-${YEAR}`);

const FIPS = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO",
  "09": "CT", "10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI",
  "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY",
  "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN",
  "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH",
  "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH",
  "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD",
  "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA",
  "54": "WV", "55": "WI", "56": "WY",
};

// ---------------------------------------------------------------------------

async function download(url, dest) {
  if (fs.existsSync(dest)) return dest;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

/** Unzips into the cache dir and returns the single data file inside. */
function unzipOne(zipPath) {
  const dir = zipPath.replace(/\.zip$/, "");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    execFileSync("unzip", ["-o", "-q", zipPath, "-d", dir]);
  }
  const files = fs.readdirSync(dir).filter((f) => /\.(txt|csv)$/i.test(f));
  if (files.length !== 1) throw new Error(`expected one data file in ${dir}, found ${files.length}`);
  return path.join(dir, files[0]);
}

/*
 * CBP pads every industry code to six characters: '------' is the all-industry
 * total, '31----' a sector, '3364//' a four-digit group, '336411' a full code.
 * Trimming the padding gives the real code and its length gives the level.
 */
function parseNaics(padded) {
  const code = padded.replace(/[-/]+$/, "");
  if (!code) return null; // the '------' total row is not an industry
  return { code, level: code.length, parent: code.length > 2 ? code.slice(0, -1) : null };
}

function splitCsvLine(line) {
  return line.split(",").map((f) => f.replace(/^"|"$/g, ""));
}

const num = (v) => {
  if (v === undefined || v === "" || v === "N" || v === "D" || v === "S") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// ---------------------------------------------------------------------------

async function post(table, rows, onConflict) {
  if (DRY || rows.length === 0) return;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`,
    {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(rows),
    },
  );
  if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`);
}

async function postChunked(table, rows, onConflict, size = 2000) {
  for (let i = 0; i < rows.length; i += size) {
    await post(table, rows.slice(i, i + size), onConflict);
    process.stdout.write(`\r  ${table}: ${Math.min(i + size, rows.length)}/${rows.length}`);
  }
  process.stdout.write("\n");
}

// 1. Industry titles --------------------------------------------------------

async function loadIndustries(codesInData) {
  const file = await download(
    `${CENSUS}/technical-documentation/reference/naics-descriptions/naics.txt`,
    path.join(CACHE, "naics.txt"),
  );

  // Fixed width: code in the first six characters, title from the ninth on.
  const titles = new Map();
  for (const line of fs.readFileSync(file, "utf8").split("\n").slice(1)) {
    if (line.length < 9) continue;
    const parsed = parseNaics(line.slice(0, 6));
    if (!parsed) continue;
    titles.set(parsed.code, line.slice(8).trim());
  }

  /*
   * Every code the data references needs a row here or the foreign key rejects
   * it. The reference file has run behind the data before, so anything missing
   * gets a placeholder rather than dropping real establishment counts.
   */
  const rows = [...codesInData].map((code) => ({
    code,
    level: code.length,
    parent_code: code.length > 2 ? code.slice(0, -1) : null,
    title: titles.get(code) ?? `NAICS ${code}`,
  }));

  const unnamed = rows.filter((r) => r.title.startsWith("NAICS ")).length;
  console.log(`${rows.length} industries${unnamed ? `, ${unnamed} without a published title` : ""}`);
  await postChunked("naics_industries", rows, "code");
}

// 2. Establishment counts ---------------------------------------------------

function readCbp(file, isNational) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const at = (f) => header.indexOf(f);

  const iState = at("fipstate");
  const iNaics = at("naics");
  const iLfo = at("lfo");
  const cols = {
    estab: at("est"), emp: at("emp"), ap: at("ap"),
    n1_4: at("n<5"), n5_9: at("n5_9"), n10_19: at("n10_19"), n20_49: at("n20_49"),
    n50_99: at("n50_99"), n100_249: at("n100_249"), n250_499: at("n250_499"),
    n500_999: at("n500_999"), n1000: at("n1000"),
  };

  const rows = [];
  const codes = new Set();

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const f = splitCsvLine(lines[i]);

    /*
     * The national file breaks each industry out by legal form of organisation
     * (corporation, partnership, ...) as well as giving an all-forms row. Only
     * the all-forms row belongs here; the rest would count the same
     * establishment several times.
     */
    if (iLfo !== -1 && f[iLfo] && f[iLfo] !== "-") continue;

    const parsed = parseNaics(f[iNaics]);
    if (!parsed) continue;

    const fipstate = isNational ? "00" : f[iState];
    if (!isNational && !FIPS[fipstate]) continue; // territories are out of scope

    const estab = num(f[cols.estab]);
    if (estab === null) continue;

    codes.add(parsed.code);
    rows.push({
      fipstate,
      state_code: isNational ? null : FIPS[fipstate],
      naics: parsed.code,
      vintage: YEAR,
      establishments: estab,
      employees: num(f[cols.emp]),
      annual_payroll: num(f[cols.ap]),
      n1_4: num(f[cols.n1_4]), n5_9: num(f[cols.n5_9]),
      n10_19: num(f[cols.n10_19]), n20_49: num(f[cols.n20_49]),
      n50_99: num(f[cols.n50_99]), n100_249: num(f[cols.n100_249]),
      n250_499: num(f[cols.n250_499]), n500_999: num(f[cols.n500_999]),
      n1000: num(f[cols.n1000]),
    });
  }
  return { rows, codes };
}

// ---------------------------------------------------------------------------

const usZip = await download(`${CENSUS}/datasets/${YEAR}/cbp${YY}us.zip`, path.join(CACHE, `cbp${YY}us.zip`));
const stZip = await download(`${CENSUS}/datasets/${YEAR}/cbp${YY}st.zip`, path.join(CACHE, `cbp${YY}st.zip`));

const national = readCbp(unzipOne(usZip), true);
const states = readCbp(unzipOne(stZip), false);

const allCodes = new Set([...national.codes, ...states.codes]);
console.log(`CBP ${YEAR}: ${national.rows.length} national rows, ${states.rows.length} state rows`);

await loadIndustries(allCodes);
await postChunked("naics_establishments", national.rows, "fipstate,naics,vintage");
await postChunked("naics_establishments", states.rows, "fipstate,naics,vintage");

console.log(DRY ? "dry run, nothing written" : "done");
