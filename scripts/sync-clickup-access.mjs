/*
 * ClickUp access -> work_people and work_list_access, by hand.
 *
 *   node scripts/sync-clickup-access.mjs            # people, orphans, every list
 *   node scripts/sync-clickup-access.mjs --people   # just the person links
 *   node scripts/sync-clickup-access.mjs --missing  # only lists never read
 *
 * Environment: CLICKUP_TOKEN, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * The scheduled route app/api/work/access-sync does the same in small batches
 * every fifteen minutes; this is for a full re-read, or after changing the
 * rules. The logic lives in lib/clickup/access.mjs so the two cannot drift.
 *
 * About 1,000 calls for every list, so it paces itself against ClickUp's
 * limit and takes around thirteen minutes.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { syncPeople, backfillOrphanLists, syncListAccess } from "../lib/clickup/access.mjs";
import { everyRow } from "../lib/supabase/every-row.mjs";

const PEOPLE_ONLY = process.argv.includes("--people");
const MISSING_ONLY = process.argv.includes("--missing");

function env(name) {
  if (process.env[name]) return process.env[name];
  const file = readFileSync(join(process.cwd(), ".env.local"), "utf8");
  const line = file.split("\n").find((l) => l.startsWith(name + "="));
  return line ? line.slice(name.length + 1).trim().replace(/^["']|["']$/g, "") : null;
}

const TOKEN = env("CLICKUP_TOKEN");
if (!TOKEN) { console.error("No CLICKUP_TOKEN"); process.exit(1); }
const db = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

let calls = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(path, attempt = 0) {
  calls++;
  if (calls % 85 === 0) { process.stdout.write("  (rate limit pause)\n"); await sleep(62_000); }
  const res = await fetch("https://api.clickup.com/api/v2" + path, { headers: { Authorization: TOKEN } });
  if (res.status === 429 && attempt < 5) { await sleep(20_000 * (attempt + 1)); return get(path, attempt + 1); }
  if (!res.ok) throw new Error(`${res.status} on ${path}`);
  return res.json();
}

const people = await syncPeople(db, get);
const linked = people.filter((r) => r.member_id);
console.log(`${people.length} ClickUp users: ${linked.length} linked ` +
  `(${people.filter((r) => r.match === "email").length} email, ` +
  `${people.filter((r) => r.match === "name").length} name, ` +
  `${people.filter((r) => r.match === "manual").length} by hand); ` +
  `${people.filter((r) => !r.member_id && r.role === 4).length} guests, ` +
  `${people.filter((r) => !r.member_id && r.role !== 4).length} other unlinked`);

if (!PEOPLE_ONLY) {
  const orphans = await backfillOrphanLists(db, get, console.log);
  if (orphans) console.log(`${orphans} orphan lists recorded`);

  const lists = await everyRow(() => {
    let q = db.from("work_containers").select("clickup_id,name").eq("kind", "list").order("clickup_id");
    if (MISSING_ONLY) q = q.is("access_synced_at", null);
    return q;
  });
  const { done, failed } = await syncListAccess(db, get, lists, console.log);
  console.log(`lists: ${done} read, ${failed} failed, ${calls} API calls`);
}
