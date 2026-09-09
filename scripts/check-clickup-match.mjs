/*
 * Does the client matcher actually work? Answered without touching ClickUp.
 *
 *   node scripts/check-clickup-match.mjs <hierarchy.json>
 *
 * The sync's whole value is that a task arrives knowing which client it is
 * about. That rests on one rule -- ClickUp folder name matches an org_clients
 * name or a client_aliases row -- and being wrong about it is expensive: it is
 * discovered after a 20 minute run, against real rows, by someone who then has
 * to decide whether a half-matched mirror is worth keeping.
 *
 * So it is checked first, offline, against the real 214 folder names and the
 * real client list. norm() is imported from the sync rather than copied, or
 * this would be a test of a function nobody runs.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildMatcher } from "./sync-clickup.mjs";

function env(name) {
  if (process.env[name]) return process.env[name];
  const file = readFileSync(join(process.cwd(), ".env.local"), "utf8");
  const line = file.split("\n").find((l) => l.startsWith(name + "="));
  return line ? line.slice(name.length + 1).trim().replace(/^["']|["']$/g, "") : null;
}

const path = process.argv[2];
if (!path) {
  console.error("usage: node scripts/check-clickup-match.mjs <hierarchy.json>");
  process.exit(1);
}

const db = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

/* Supabase caps a select at 1,000 rows, and there are more clients than that. */
async function all(table, columns) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) return rows;
  }
}

const [clients, aliases] = await Promise.all([
  all("org_clients", "id,name"),
  all("client_aliases", "alias,client_name"),
]);

const matcher = buildMatcher({ clients, aliases });
console.log(
  `${clients.length} clients, ${aliases.length} aliases -> ` +
  `${matcher.stats.clients} distinct names, ${matcher.stats.aliases} usable alias prefixes, ` +
  `${matcher.stats.orphanAliases} aliases naming a company not in org_clients\n`
);

const tree = JSON.parse(readFileSync(path, "utf8"));
const spaces = tree.hierarchy.root.children ?? [];

/*
 * Only the client space is scored. Folders in Operations, Sales, Data and the
 * rest are internal work with no client, so counting them as misses measures
 * nothing -- the first version reported 76.7% and most of the shortfall was
 * folders that must never match.
 */
const CLIENT_SPACE = "Factur Clients";

let scored = 0, byNameHits = 0, byAliasHits = 0;
const misses = [];
const internalMatched = [];

for (const space of spaces) {
  for (const node of space.children ?? []) {
    if (node.type !== "folder") continue;
    const [id, how] = matcher.clientFor(node.name, null);

    if (space.name === CLIENT_SPACE) {
      scored++;
      if (how === "folder") byNameHits++;
      else if (how === "alias") byAliasHits++;
      else misses.push(node.name);
    } else if (id) {
      internalMatched.push(`${space.name} / ${node.name}`);
    }
  }
}

const hits = byNameHits + byAliasHits;
console.log(`${CLIENT_SPACE}: ${scored} folders`);
console.log(`  ${byNameHits} matched a client name`);
console.log(`  ${byAliasHits} matched an alias prefix`);
console.log(`  ${misses.length} unmatched   (${((hits / scored) * 100).toFixed(1)}% hit rate)\n`);

if (misses.length) {
  console.log("Unmatched:");
  for (const m of misses) console.log(`  ${m}`);
}

/* A folder outside the client space that matches is a false positive worth
 * seeing: "Design" or "Learning" attaching itself to a client would be silent. */
if (internalMatched.length) {
  console.log(`\nInternal folders that matched a client (check these):`);
  for (const m of internalMatched) console.log(`  ${m}`);
}
