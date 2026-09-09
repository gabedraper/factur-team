/*
 * ClickUp -> work_items. One way, overwrite, no write back.
 *
 *   node scripts/sync-clickup.mjs --dry-run          # read everything, write nothing
 *   node scripts/sync-clickup.mjs                    # do it
 *   node scripts/sync-clickup.mjs --space="Finance"  # one space, for trying things
 *   node scripts/sync-clickup.mjs --skip-empty       # ignore lists with no tasks
 *
 * Environment:
 *   CLICKUP_TOKEN, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * ---------------------------------------------------------------------------
 * Two jobs, and the second one is the hard one.
 *
 * Copying tasks across is plumbing. What earns the mirror its keep is the
 * matching: a task only becomes useful here once we know which client it is
 * about, because that is what lets it appear on the client page instead of in
 * another list of tasks.
 *
 * Three ways a client is found, in this order, and the way it was found is
 * written to the row so a wrong match can be traced back to the rule that made
 * it rather than quietly corrected:
 *
 *   folder  -- the folder name is the client. True for all 214 client folders.
 *   alias   -- the folder name is in client_aliases, which already exists for
 *              Salesforce and QuickBooks and knows that "C.H. Ellis Company"
 *              and "CH Ellis" are one company.
 *   title   -- the task is called "<client> - <something>". This is how the
 *              Finance space works today: every request is typed as
 *              "Premier Manufacturing - Renewal Signed". A foreign key,
 *              written as a string, by hand, several times a day.
 *
 * A task that matches none of them still comes across. It keeps its space,
 * folder and list names and shows up in the unmatched count at the end, which
 * is the list worth reading after a run.
 * ---------------------------------------------------------------------------
 */

import { createClient } from "@supabase/supabase-js";
import { norm, folderName, buildMatcher } from "../lib/clickup/match.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const SKIP_EMPTY = args.includes("--skip-empty");
const SHOW_UNMATCHED = args.includes("--show-unmatched");
/* Rebuild the navigable tree only. ~46 calls, seconds, no task pull. */
const CONTAINERS_ONLY = args.includes("--containers-only");
const ONLY_SPACE = (args.find((a) => a.startsWith("--space=")) || "").split("=")[1];

// ---------------------------------------------------------------------------
// Credentials. The token is read, never printed -- a run's output gets pasted
// into chat threads.

function env(name) {
  if (process.env[name]) return process.env[name];
  try {
    const file = readFileSync(join(process.cwd(), ".env.local"), "utf8");
    const line = file.split("\n").find((l) => l.startsWith(name + "="));
    if (line) return line.slice(name.length + 1).trim().replace(/^["']|["']$/g, "");
  } catch {}
  return null;
}

const TOKEN = env("CLICKUP_TOKEN");
const SUPABASE_URL = env("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");

/*
 * Checked when the sync runs, not when the module loads: check-clickup-match
 * imports norm() from here and has no business needing a ClickUp token to do
 * it.
 */
let db;

function requireCredentials() {
  if (!TOKEN || /your_token|YOUR_TOKEN|pk_xxx|<.*>/.test(TOKEN)) {
    /*
     * The placeholder case is called out separately because it is the likely
     * one: these instructions get pasted, and a literal "pk_your_token_here"
     * reaches ClickUp as a real request and comes back 401, which reads like a
     * permissions problem rather than a copy-paste one.
     */
    console.error(
      TOKEN
        ? "CLICKUP_TOKEN is still the placeholder text, not a real token."
        : "No CLICKUP_TOKEN found in the environment or .env.local."
    );
    console.error("");
    /* The direct URL, not a menu path: the avatar moved from the bottom left
     * to the top right between ClickUp 2.0 and 3.0 and the old directions send
     * people hunting. */
    console.error("  https://app.clickup.com/settings/apps  ->  API Token  ->  Generate");
    console.error("  Generate, copy, then in ~/factur-team:");
    console.error("");
    /* zsh syntax: macOS defaults to zsh, where bash's `read -rsp prompt VAR`
     * reads nothing at all and silently writes an empty token. */
    console.error("    read -rs \"T?Paste token: \" && printf 'CLICKUP_TOKEN=%s\\n' \"$T\" >> .env.local && unset T");
    console.error("");
    process.exit(1);
  }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error("No Supabase credentials in environment or .env.local");
    process.exit(1);
  }
  db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

// ---------------------------------------------------------------------------
// ClickUp, politely. 100 requests a minute is the documented ceiling and it is
// enforced per token, so a run that ignores it gets 429s halfway through and
// leaves a half-written mirror.

const API = "https://api.clickup.com/api/v2";
let calls = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(path, attempt = 0) {
  calls++;
  if (calls % 85 === 0) {
    process.stdout.write("  (pausing for the rate limit) ");
    await sleep(62_000);
  }
  const res = await fetch(API + path, { headers: { Authorization: TOKEN } });
  if (res.status === 429) {
    if (attempt > 4) throw new Error(`rate limited five times on ${path}`);
    await sleep(20_000 * (attempt + 1));
    return get(path, attempt + 1);
  }
  if (res.status === 401) {
    throw new Error(
      "401 from ClickUp: the token was rejected. Check it is a personal API " +
      "token (starts pk_) and was copied whole, then retry."
    );
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} on ${path}`);
  return res.json();
}

// ---------------------------------------------------------------------------

async function main() {
  requireCredentials();
  const started = new Date();
  let runId = null;

  if (!DRY) {
    const { data } = await db.from("work_sync_runs").insert({}).select("id").single();
    runId = data?.id ?? null;
  }

  // --- reference data -------------------------------------------------------

  const [{ data: processes }, { data: clients }, { data: aliases }, { data: members }] =
    await Promise.all([
      db.from("work_processes").select("id,slug,name,match_prefixes,position").eq("active", true).order("position"),
      db.from("org_clients").select("id,name"),
      db.from("client_aliases").select("alias,client_name"),
      db.from("org_members").select("id,email,full_name,active"),
    ]);

  const matcher = buildMatcher({ clients: clients ?? [], aliases: aliases ?? [] });
  /*
   * Email first, then name.
   *
   * ClickUp addresses and roster addresses have drifted: Darryl Mechell is
   * darryl@bethefactur.com over there and something else here, Eli Garcia is on
   * a misspelt facturmg.com domain. Both are active staff, and matching on
   * email alone left their work assigned to nobody, which is the one thing
   * "My work" cannot survive.
   *
   * Inactive people are included deliberately. Most of this list is finished
   * work and the person who did it has often left -- Jeffrey West holds 456 of
   * the 704 assignments in Finance alone. History reads wrong without them, and
   * this app already chose to keep inactive people visible in history.
   */
  const byEmail = new Map();
  const byFullName = new Map();
  const ambiguousNames = new Set();
  for (const m of members ?? []) {
    const email = String(m.email ?? "").toLowerCase();
    /* Active wins where the same address or name appears twice. */
    if (email && (m.active || !byEmail.has(email))) byEmail.set(email, m.id);

    const name = String(m.full_name ?? "").toLowerCase().trim();
    if (!name) continue;
    if (byFullName.has(name) && !m.active) continue;
    if (byFullName.has(name) && m.active && ambiguousNames.has(name)) continue;
    if (byFullName.has(name)) ambiguousNames.add(name);
    byFullName.set(name, m.id);
  }

  function memberFor(assignee) {
    const byMail = byEmail.get(String(assignee.email ?? "").toLowerCase());
    if (byMail) return byMail;
    return byFullName.get(String(assignee.username ?? "").toLowerCase().trim()) ?? null;
  }

  console.log(
    `${processes?.length ?? 0} processes, ${matcher.stats.clients} clients, ` +
    `${matcher.stats.aliases} alias prefixes (${matcher.stats.orphanAliases} orphaned), ` +
    `${matcher.stats.scannable} scannable names, ` +
    `${matcher.stats.ambiguous} ambiguous names dropped, ` +
    `${byEmail.size} members`
  );

  /* First prefix that matches wins, which is why the table is ordered. */
  function processFor(listName) {
    const n = (listName || "").toLowerCase().trim();
    for (const p of processes ?? []) {
      for (const prefix of p.match_prefixes ?? []) {
        if (n.startsWith(prefix)) return p;
      }
    }
    return null;
  }

  /* "Service Delivery // LG" -> "LG". */
  function podFor(listName) {
    const m = (listName || "").match(/\/\/\s*([A-Za-z0-9]+)\s*$/);
    return m ? m[1].toUpperCase() : null;
  }

  // --- walk the workspace ---------------------------------------------------

  const team = (await get("/team")).teams?.[0];
  if (!team) throw new Error("token is valid but sees no workspace");
  console.log(`workspace: ${team.name}`);

  let spaces = (await get(`/team/${team.id}/space?archived=false`)).spaces ?? [];
  if (ONLY_SPACE) spaces = spaces.filter((s) => s.name === ONLY_SPACE);
  console.log(`${spaces.length} spaces`);

  const targets = [];
  const containers = [];

  /* One row per space, folder and list, in ClickUp's own order. */
  const container = (kind, node, parent, spaceId, fallbackOrder) => ({
    clickup_id: String(node.id),
    kind,
    name: node.name ?? "(unnamed)",
    parent_clickup_id: parent ? String(parent) : null,
    space_clickup_id: spaceId ? String(spaceId) : null,
    /*
     * ClickUp returns no orderindex for spaces, so their position in the
     * response stands in for it. That response order is the nearest thing to
     * the sidebar order anybody has, and without it the tree comes back in
     * whatever order Postgres feels like, which changes between page loads.
     */
    orderindex: Number.isFinite(Number(node.orderindex))
      ? Number(node.orderindex)
      : fallbackOrder ?? null,
    task_count: Number(node.task_count ?? 0),
    archived: Boolean(node.archived),
    statuses: node.statuses ?? null,
    url: node.id ? `https://app.clickup.com/${team.id}/v/li/${node.id}` : null,
    synced_at: new Date().toISOString(),
  });

  for (const [spaceIndex, space] of spaces.entries()) {
    containers.push(container("space", space, null, space.id, spaceIndex));

    const [folders, loose] = await Promise.all([
      get(`/space/${space.id}/folder?archived=false`),
      get(`/space/${space.id}/list?archived=false`),
    ]);

    for (const f of folders.folders ?? []) {
      containers.push(container("folder", f, space.id, space.id));
      for (const l of f.lists ?? []) {
        containers.push(container("list", l, f.id, space.id));
        targets.push({ space: space.name, folder: f.name, list: l, count: l.task_count ?? 0 });
      }
    }
    /* Folderless lists hang off the space itself -- the tree is not a fixed
     * depth, and pretending otherwise loses a fifth of the workspace. */
    for (const l of loose.lists ?? []) {
      containers.push(container("list", l, space.id, space.id));
      targets.push({ space: space.name, folder: null, list: l, count: l.task_count ?? 0 });
    }
  }

  if (!DRY && containers.length) {
    for (let i = 0; i < containers.length; i += 500) {
      const { error } = await db
        .from("work_containers")
        .upsert(containers.slice(i, i + 500), { onConflict: "clickup_id" });
      if (error) throw new Error(`containers upsert failed: ${error.message}`);
    }
  }
  console.log(`${containers.length} containers (${containers.filter((c) => c.kind === "list").length} lists)`);

  if (CONTAINERS_ONLY) {
    if (!DRY && runId) {
      await db.from("work_sync_runs").update({
        finished_at: new Date().toISOString(), lists_seen: targets.length,
      }).eq("id", runId);
    }
    console.log("--containers-only: tree rebuilt, tasks left alone.");
    return;
  }

  const lists = SKIP_EMPTY ? targets.filter((t) => t.count > 0) : targets;
  console.log(`${lists.length} lists to read (${targets.length - lists.length} skipped as empty)`);

  // --- read and write -------------------------------------------------------

  let seen = 0, written = 0, unmatched = 0;
  const unmatchedFolders = new Map();
  const unmatchedTitles = [];
  const scanMatches = [];
  const nameById = new Map((clients ?? []).map((c) => [c.id, c.name]));

  for (const [i, target] of lists.entries()) {
    const process = processFor(target.list.name);
    const pod = podFor(target.list.name);
    const rows = [];
    const assignees = [];

    for (let page = 0; ; page++) {
      const res = await get(
        `/list/${target.list.id}/task?page=${page}&subtasks=true&include_closed=true`
      );
      const tasks = res.tasks ?? [];
      for (const t of tasks) {
        seen++;
        const [clientId, how] = matcher.clientFor(target.folder, t.name);
        if (!clientId) {
          unmatched++;
          const key = target.folder || `${target.space} / ${target.list.name}`;
          unmatchedFolders.set(key, (unmatchedFolders.get(key) ?? 0) + 1);
          if (SHOW_UNMATCHED) unmatchedTitles.push(t.name);
        } else if (SHOW_UNMATCHED && how === "title_scan") {
          /* The loosest rule, so its output is the one worth eyeballing. */
          scanMatches.push(`${nameById.get(clientId) ?? "?"}  <-  ${t.name}`);
        }

        const ms = (v) => (v ? new Date(Number(v)).toISOString() : null);

        rows.push({
          clickup_id: t.id,
          clickup_url: t.url || `https://app.clickup.com/t/${t.id}`,
          title: t.name || "(untitled)",
          body: (t.text_content || t.description || "").slice(0, 20000) || null,
          status: t.status?.status || "unknown",
          status_type: ["open", "custom", "done", "closed"].includes(t.status?.type)
            ? t.status.type
            : "custom",
          priority: t.priority?.priority ?? null,
          due_at: ms(t.due_date),
          start_at: ms(t.start_date),
          closed_at: ms(t.date_closed),
          created_at_remote: ms(t.date_created),
          updated_at_remote: ms(t.date_updated),
          process_id: process?.id ?? null,
          pod,
          client_id: clientId,
          clickup_space: target.space,
          clickup_folder: target.folder,
          clickup_list: target.list.name,
          clickup_list_id: String(target.list.id),
          client_match: how,
          parent_clickup_id: t.parent ?? null,
          synced_at: new Date().toISOString(),
        });

        for (const a of t.assignees ?? []) {
          assignees.push({
            clickup_id: t.id,
            clickup_user_id: String(a.id),
            member_id: memberFor(a),
            name: a.username || a.email || null,
          });
        }
      }
      if (res.last_page || tasks.length === 0) break;
    }

    if (rows.length && !DRY) {
      /*
       * Upsert on clickup_id, then replace this list's assignees wholesale.
       * Replacing rather than merging is the only way a task that was
       * unassigned in ClickUp stops looking assigned here.
       */
      for (let j = 0; j < rows.length; j += 500) {
        const chunk = rows.slice(j, j + 500);
        const { error } = await db
          .from("work_items")
          .upsert(chunk, { onConflict: "clickup_id" });
        if (error) throw new Error(`upsert failed: ${error.message}`);
        written += chunk.length;
      }

      const { data: ids } = await db
        .from("work_items")
        .select("id,clickup_id")
        .in("clickup_id", rows.map((r) => r.clickup_id));
      const idFor = new Map((ids ?? []).map((r) => [r.clickup_id, r.id]));

      await db.from("work_item_assignees").delete().in("work_item_id", [...idFor.values()]);
      const links = assignees
        .map((a) => ({
          work_item_id: idFor.get(a.clickup_id),
          clickup_user_id: a.clickup_user_id,
          member_id: a.member_id,
          name: a.name,
        }))
        .filter((a) => a.work_item_id);
      for (let j = 0; j < links.length; j += 500) {
        await db.from("work_item_assignees").upsert(links.slice(j, j + 500));
      }
    }

    if (rows.length || (i + 1) % 25 === 0) {
      console.log(
        `[${i + 1}/${lists.length}] ${target.space} / ${target.folder ?? "-"} / ${target.list.name}` +
          ` -> ${rows.length} tasks, process ${process?.slug ?? "none"}`
      );
    }
  }

  // --- report ---------------------------------------------------------------

  if (!DRY && runId) {
    await db
      .from("work_sync_runs")
      .update({
        finished_at: new Date().toISOString(),
        lists_seen: lists.length,
        items_seen: seen,
        items_written: written,
        unmatched_clients: unmatched,
      })
      .eq("id", runId);
  }

  const mins = ((Date.now() - started.getTime()) / 60000).toFixed(1);
  console.log(`\n${seen} tasks seen, ${written} written, ${unmatched} with no client, ${mins} min, ${calls} API calls`);

  if (unmatchedFolders.size) {
    console.log(`\nNo client matched, worst first -- these are the matcher's gaps:`);
    [...unmatchedFolders.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .forEach(([name, n]) => console.log(`  ${String(n).padStart(5)}  ${name}`));
  }
  if (SHOW_UNMATCHED && scanMatches.length) {
    console.log(`\nMatched by scanning the title (first 40 of ${scanMatches.length}):`);
    for (const m of scanMatches.slice(0, 40)) console.log(`  ${m}`);
  }

  if (SHOW_UNMATCHED && unmatchedTitles.length) {
    console.log(`\nUnmatched task titles (first 60 of ${unmatchedTitles.length}):`);
    for (const t of unmatchedTitles.slice(0, 60)) console.log(`  ${t}`);
  }

  if (DRY) console.log("\n--dry-run: nothing was written.");
}

/*
 * Only when run directly. scripts/check-clickup-match.mjs imports norm() from
 * here so the check exercises the matcher that actually ships, not a copy of it
 * that drifts.
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(async (err) => {
    console.error("\nFAILED:", err.message);
    process.exit(1);
  });
}
