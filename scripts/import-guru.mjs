// Guru → LMS Import Script (uses @getguru/cli)
// Mapping: Folder = Course, Card = Lesson

import { createClient } from "@supabase/supabase-js";
import { execSync } from "child_process";

const GURU_CLI_USER = process.env.GURU_CLI_USER;
const GURU_CLI_TOKEN = process.env.GURU_CLI_TOKEN;
if (!GURU_CLI_USER || !GURU_CLI_TOKEN) {
  throw new Error("Set GURU_CLI_USER and GURU_CLI_TOKEN in the environment before running this script.");
}
const env = { ...process.env, GURU_CLI_USER, GURU_CLI_TOKEN };

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment before running this script.");
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function guruCLI(args) {
  const result = execSync(`guru ${args}`, { env, encoding: "utf8" });
  return JSON.parse(result);
}

async function getAllCards() {
  const allCards = [];
  const pageSize = 50;
  let startIndex = 0;
  let total = null;

  while (true) {
    const res = guruCLI(`cards list --max-results ${pageSize} --start-index ${startIndex}`);
    if (!res.ok) throw new Error(res.error?.message || "CLI error");

    const { cards, total: t } = res.data;
    if (total === null) total = t;

    allCards.push(...(cards || []));
    process.stdout.write(`\r   Fetched ${allCards.length} / ${total} cards...`);

    if (!cards || cards.length < pageSize || allCards.length >= total) break;
    startIndex += pageSize;
  }
  console.log();
  return allCards;
}

async function getCardContent(cardId) {
  try {
    const res = guruCLI(`cards get ${cardId}`);
    if (!res.ok) return "";
    return res.data?.htmlContent || res.data?.content || "";
  } catch {
    return "";
  }
}

async function getAdminUserId() {
  const { data } = await supabase.from("profiles").select("id").eq("role", "admin").single();
  return data?.id;
}

async function main() {
  console.log("🔌 Connecting to Guru via CLI...\n");

  console.log("📄 Fetching all cards...");
  const allCards = await getAllCards();
  console.log(`   Found ${allCards.length} cards\n`);

  // Group by folder (boards[0])
  const folderMap = {};
  const uncategorized = [];

  for (const card of allCards) {
    const folder = card.boards?.[0];
    const collectionName = card.collection?.name || "";
    if (!folder?.id) {
      uncategorized.push(card);
      continue;
    }
    if (!folderMap[folder.id]) {
      folderMap[folder.id] = { name: folder.title, collectionName, cards: [] };
    }
    folderMap[folder.id].cards.push(card);
  }

  const folders = Object.values(folderMap);
  if (uncategorized.length > 0) {
    folders.push({ name: "Uncategorized", collectionName: "", cards: uncategorized });
  }

  console.log(`📋 ${folders.length} folders → ${folders.length} courses`);
  folders.forEach((f) => console.log(`   • "${f.name}" (${f.collectionName}) — ${f.cards.length} cards`));
  console.log();

  const adminId = await getAdminUserId();
  if (!adminId) { console.error("❌ No admin user found."); process.exit(1); }

  console.log("🚀 Importing...\n");

  let coursesCreated = 0, lessonsCreated = 0, skipped = 0;

  for (const folder of folders) {
    const { name, collectionName, cards } = folder;

    const { data: course, error: courseErr } = await supabase
      .from("courses")
      .insert({
        title: name,
        description: collectionName ? `Collection: ${collectionName}` : null,
        instructor_id: adminId,
        is_published: false,
      })
      .select().single();

    if (courseErr) { console.error(`  ❌ "${name}": ${courseErr.message}`); skipped += cards.length; continue; }

    const { data: module, error: modErr } = await supabase
      .from("modules")
      .insert({ course_id: course.id, title: name, position: 0 })
      .select().single();

    if (modErr) { console.error(`  ❌ Module "${name}": ${modErr.message}`); skipped += cards.length; continue; }

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const title = card.title || card.preferredPhrase || `Card ${i + 1}`;

      // Fetch full card content
      process.stdout.write(`\r   "${name}": fetching lesson ${i + 1}/${cards.length}...`);
      const content = await getCardContent(card.id);

      const { error } = await supabase.from("lessons").insert({
        module_id: module.id,
        title,
        type: "text",
        content: { body: content },
        position: i,
      });
      if (error) skipped++;
      else lessonsCreated++;
    }

    console.log(`\r  ✅ "${name}" (${collectionName}) — ${cards.length} lessons          `);
    coursesCreated++;
  }

  console.log(`
✨ Import complete!
   Courses created: ${coursesCreated}
   Lessons created: ${lessonsCreated}
   Skipped:         ${skipped}
`);
}

main()
  .then(() => { try { execSync("afplay /System/Library/Sounds/Glass.aiff"); } catch {} })
  .catch(console.error);
