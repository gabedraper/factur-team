/*
 * ClickUp access -> work_people and work_list_access.
 *
 *   node scripts/sync-clickup-access.mjs            # people and every list
 *   node scripts/sync-clickup-access.mjs --people   # just the person links
 *
 * Environment: CLICKUP_TOKEN, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * ---------------------------------------------------------------------------
 * Two jobs.
 *
 * People: every ClickUp user, linked to a person here by email, then by full
 * name, else left unlinked and listed at the end. A link set by hand
 * (match = 'manual') is never overwritten -- that is how a mismatch like
 * darryl@bethefactur.com vs darryl.mechell@facturmfg.com gets fixed for good.
 *
 * Lists: who ClickUp says can open each list, from /list/{id}/member. It
 * reports effective access -- inherited from the space, granted through a user
 * group, or shared on the list itself -- so nothing here has to reproduce
 * ClickUp's permission rules. It only has to ask.
 *
 * One call per list, about 1,000 of them, so this is a daily job and not part
 * of the fifteen-minute task sync.
 * ---------------------------------------------------------------------------
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { everyRow } from "../lib/supabase/every-row.mjs";

const PEOPLE_ONLY = process.argv.includes("--people");
/* Only lists whose access has never been read -- to fill gaps without re-reading 1,000. */
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

const lower = (s) => String(s ?? "").toLowerCase().trim();

async function syncPeople() {
  const team = (await get("/team")).teams?.[0];
  const users = (team.members ?? []).map((m) => m.user).filter(Boolean);

  const [members, existing] = await Promise.all([
    everyRow(() => db.from("org_members").select("id,email,full_name,active").order("id")),
    everyRow(() => db.from("work_people").select("clickup_user_id,member_id,match").order("clickup_user_id")),
  ]);

  /* Active wins where an address or a name appears twice; a name shared by two
   * different people is not used at all. */
  const byEmail = new Map();
  const nameCount = new Map();
  const byName = new Map();
  for (const m of members ?? []) {
    const e = lower(m.email);
    if (e && (m.active || !byEmail.has(e))) byEmail.set(e, m.id);
    const n = lower(m.full_name);
    if (!n) continue;
    nameCount.set(n, (nameCount.get(n) ?? 0) + 1);
    if (m.active || !byName.has(n)) byName.set(n, m.id);
  }
  const manual = new Map((existing ?? []).filter((r) => r.match === "manual").map((r) => [r.clickup_user_id, r.member_id]));

  const rows = users.map((u) => {
    const id = String(u.id);
    if (manual.has(id)) {
      return { clickup_user_id: id, email: u.email ?? null, username: u.username ?? null, role: u.role ?? null,
               member_id: manual.get(id), match: "manual", synced_at: new Date().toISOString() };
    }
    let memberId = byEmail.get(lower(u.email)) ?? null;
    let how = memberId ? "email" : null;
    if (!memberId) {
      const n = lower(u.username);
      if (n && nameCount.get(n) === 1) { memberId = byName.get(n); how = "name"; }
    }
    return { clickup_user_id: id, email: u.email ?? null, username: u.username ?? null, role: u.role ?? null,
             member_id: memberId, match: how, synced_at: new Date().toISOString() };
  });

  const { error } = await db.from("work_people").upsert(rows, { onConflict: "clickup_user_id" });
  if (error) throw new Error("people upsert: " + error.message);

  const linked = rows.filter((r) => r.member_id);
  console.log(`${rows.length} ClickUp users: ${linked.length} linked ` +
    `(${rows.filter((r) => r.match === "email").length} by email, ` +
    `${rows.filter((r) => r.match === "name").length} by name, ` +
    `${rows.filter((r) => r.match === "manual").length} by hand)`);
  const guests = rows.filter((r) => !r.member_id && r.role === 4).length;
  const loose = rows.filter((r) => !r.member_id && r.role !== 4);
  console.log(`  unlinked: ${guests} guests (expected -- client staff), ${loose.length} others:`);
  for (const r of loose) console.log(`    ${r.username ?? "?"} <${r.email ?? "no email"}>`);
}

async function syncLists() {
  const lists = await everyRow(() => {
    let q = db.from("work_containers").select("clickup_id,name").eq("kind", "list").eq("archived", false).order("clickup_id");
    if (MISSING_ONLY) q = q.is("access_synced_at", null);
    return q;
  });
  console.log(`\n${lists.length} lists`);

  let done = 0, failed = 0;
  for (const l of lists ?? []) {
    try {
      const res = await get(`/list/${l.clickup_id}/member`);
      const ids = [...new Set((res.members ?? []).map((m) => String(m.id)))];
      /* Replace wholesale: someone removed from a list in ClickUp has to lose it
       * here, and there is no way to know which rows went. */
      await db.from("work_list_access").delete().eq("list_clickup_id", l.clickup_id);
      if (ids.length) {
        const { error } = await db.from("work_list_access")
          .insert(ids.map((u) => ({ list_clickup_id: l.clickup_id, clickup_user_id: u })));
        if (error) throw new Error(error.message);
      }
      await db.from("work_containers").update({ access_synced_at: new Date().toISOString() }).eq("clickup_id", l.clickup_id);
      done++;
    } catch (e) {
      failed++;
      console.log(`  ! ${l.name} (${l.clickup_id}): ${e.message}`);
    }
    if (done % 100 === 0 && done) console.log(`  ${done}/${lists.length}`);
  }
  console.log(`lists: ${done} read, ${failed} failed, ${calls} API calls`);
}

await syncPeople();
if (!PEOPLE_ONLY) await syncLists();
