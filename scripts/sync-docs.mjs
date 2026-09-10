/*
 * Put the repository's own documentation where Gaib can read it.
 *
 * docs/ holds the things that are true about this app and are written down
 * nowhere else -- what is actually in ClickUp, how Fixtur is built, how the
 * Google ingest was set up. None of it was reachable: Gaib reads the database,
 * and these are files in a repository it has never seen.
 *
 * They go in as an ordinary course, which is the cheapest possible answer. The
 * handbook already has search, row security, and a trigger that reindexes on
 * save, so a course costs nothing new -- against a separate table, a separate
 * tool and a second set of rules to keep in step.
 *
 * Left unpublished on purpose. Reading no longer depends on publishing, so
 * Gaib finds it; the learner dashboard shows published courses only, so nobody
 * is handed "Fixtur — how the build actually works" as training.
 *
 *   node --env-file=.env.local scripts/sync-docs.mjs
 *
 * Re-run it whenever the docs change. Everything is keyed on title, so it
 * updates in place rather than piling up copies.
 */
import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const COURSE = "How the app works";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

/** The first heading, falling back to the filename. */
function titleOf(text, file) {
  const h1 = text.match(/^#\s+(.+)$/m);
  return h1 ? h1[1].trim() : basename(file, ".md");
}

const files = [
  ...readdirSync("docs").filter((f) => f.endsWith(".md")).map((f) => join("docs", f)),
  "CLAUDE.md",
];

/*
 * Found by title, not upserted on it. Course titles are not unique -- the Guru
 * import produced three courses called "Fixtur" and three called "Salesforce"
 * -- so there is no constraint to conflict against.
 */
const { data: found } = await db
  .from("courses").select("id").eq("title", COURSE).limit(1).maybeSingle();

const course = found ?? (
  await db.from("courses")
    .insert({ title: COURSE, description: "The repository's own notes.", is_published: false })
    .select("id").single()
).data;

if (!course) {
  console.error(`Could not create or find the "${COURSE}" course.`);
  process.exit(1);
}

const { data: existingModule } = await db
  .from("modules").select("id").eq("course_id", course.id).limit(1).maybeSingle();

const moduleId = existingModule?.id ?? (
  await db.from("modules")
    .insert({ course_id: course.id, title: COURSE, position: 1 })
    .select("id").single()
).data.id;

const { data: had } = await db.from("lessons").select("id,title").eq("module_id", moduleId);
const byTitle = new Map((had ?? []).map((l) => [l.title, l.id]));

let position = 0;
for (const file of files) {
  const text = readFileSync(file, "utf8");
  const title = titleOf(text, file);
  position += 1;

  // Markdown goes in as-is. handbook_plain only strips tags, and there are
  // none, so the indexed text is the document -- headings, tables and all.
  const row = {
    module_id: moduleId,
    title,
    type: "text",
    position,
    content: { body: `${text}\n\nSource: ${file} in the factur-team repository.` },
  };

  const id = byTitle.get(title);
  const { error } = id
    ? await db.from("lessons").update(row).eq("id", id)
    : await db.from("lessons").insert(row);

  console.log(`${error ? "failed" : id ? "updated" : "added"}  ${title}  (${file})${error ? ` — ${error.message}` : ""}`);
  byTitle.delete(title);
}

// A doc that has been deleted or renamed should not linger in the index.
for (const [title, id] of byTitle) {
  await db.from("lessons").delete().eq("id", id);
  console.log(`removed  ${title}`);
}

const { data: passages } = await db
  .from("handbook_passages").select("id", { count: "exact", head: true }).eq("course_id", course.id);
console.log(`\nIndexed passages for "${COURSE}": ${passages ?? "counted on the server"}`);
