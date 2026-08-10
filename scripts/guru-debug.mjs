const GURU_EMAIL = process.env.GURU_CLI_USER;
const GURU_TOKEN = process.env.GURU_CLI_TOKEN;
if (!GURU_EMAIL || !GURU_TOKEN) {
  throw new Error("Set GURU_CLI_USER and GURU_CLI_TOKEN in the environment before running this script.");
}
const GURU_BASE = "https://api.getguru.com/api/v1";
const GURU_AUTH = Buffer.from(`${GURU_EMAIL}:${GURU_TOKEN}`).toString("base64");

async function tryGet(label, path) {
  const res = await fetch(`${GURU_BASE}${path}`, {
    headers: { Authorization: `Basic ${GURU_AUTH}` },
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  const count = Array.isArray(parsed) ? parsed.length : (parsed?.results?.length ?? parsed?.cards?.length ?? parsed?.items?.length ?? "?");
  console.log(`[${res.status}] ${label}: ${count} results`);
  if (res.ok && count !== 0 && count !== "?") {
    const sample = Array.isArray(parsed) ? parsed[0] : (parsed?.results?.[0] || parsed?.cards?.[0] || parsed?.items?.[0]);
    if (sample) console.log("  Sample keys:", Object.keys(sample).join(", "));
  }
  if (!res.ok) console.log("  Error:", text.slice(0, 100));
  return { status: res.status, data: parsed };
}

async function main() {
  // Get first collection
  const colRes = await fetch(`${GURU_BASE}/collections`, {
    headers: { Authorization: `Basic ${GURU_AUTH}` },
  });
  const collections = await colRes.json();
  const col = collections[0];
  console.log(`\nTesting with collection: "${col.name}" (id: ${col.id})`);
  console.log(`homeBoardSlug: ${col.homeBoardSlug}\n`);

  const slug = col.homeBoardSlug?.split("/")?.[0]; // e.g. "caBzexdi"

  await tryGet("GET /boards (no filter)", "/boards");
  await tryGet("GET /boards?collectionId=", `/boards?collectionId=${col.id}`);
  await tryGet("GET /boards/{slug}", `/boards/${slug}`);
  await tryGet("GET /boards/{slug}/items", `/boards/${slug}/items`);
  await tryGet("GET /boards/{homeBoardSlug}/items", `/boards/${col.homeBoardSlug}/items`);
  await tryGet("GET /cards (plain)", `/cards`);
  await tryGet("GET /cards?collection=", `/cards?collection=${col.id}`);
  await tryGet("GET /facts", `/facts`);
  await tryGet("GET /facts?collection=", `/facts?collection=${col.id}`);

  // Also try search with verificationState filter
  const verRes = await fetch(`${GURU_BASE}/search/query?searchTerms=&maxResults=5&queryType=cards`, {
    headers: { Authorization: `Basic ${GURU_AUTH}` },
  });
  const verData = await verRes.json();
  const verCards = verData.results || verData;
  console.log(`\n[${verRes.status}] Search with queryType=cards: ${Array.isArray(verCards) ? verCards.length : "?"} results`);
}

main().catch(console.error);
