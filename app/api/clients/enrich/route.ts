import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { readSite, extractFromSite, ENRICH_MODEL } from "@/lib/clients/enrich";

/*
 * Working through the client list, a few websites at a time.
 *
 * Nine hundred and forty sites is not one request. It is a queue that runs on a
 * schedule, remembers where it got to, and gives up on a site after three
 * goes -- so a domain that has quietly expired cannot sit at the front failing
 * forever while everything behind it waits.
 *
 * Each client is independent: one bad site fails alone and the batch carries
 * on. The alternative -- a run that aborts on the first timeout -- means the
 * queue never gets past whichever client has the worst hosting.
 */

export const maxDuration = 300;

/** Per invocation. Small enough to finish inside the time limit. */
const BATCH = 8;

export async function POST(request: NextRequest) {
  const offered = request.headers.get("x-gaib-secret");
  if (!offered) return new NextResponse("Unauthorized", { status: 401 });

  const db = createServiceClient();
  const { data: secretRow } = await db
    .from("gaib_secrets").select("value").eq("name", "deliver").maybeSingle();
  const expected = (secretRow as { value: string } | null)?.value
    ?? process.env.GAIB_DELIVER_SECRET;
  if (!expected || offered !== expected) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const size = Math.min(Number(new URL(request.url).searchParams.get("batch")) || BATCH, 20);

  const { data: queue } = await db.rpc("clients_needing_enrichment", { p_limit: size });
  const clients = (queue ?? []) as { salesforce_client_id: string; name: string; website: string }[];

  const done: { name: string; attributes: number }[] = [];
  const failed: { name: string; why: string }[] = [];

  for (const client of clients) {
    // Counted before the work, not after. A client whose site hangs the request
    // would otherwise never have its attempt recorded and would be picked again
    // on every run for ever.
    await db.from("client_profile").upsert({
      salesforce_client_id: client.salesforce_client_id,
      attempts: await nextAttempt(client.salesforce_client_id),
      website_used: client.website,
    }, { onConflict: "salesforce_client_id" });

    const site = await readSite(client.website);
    if (!site.ok) {
      failed.push({ name: client.name, why: site.reason });
      await note(client.salesforce_client_id, site.reason);
      continue;
    }

    const read = await extractFromSite({ name: client.name, url: site.url, text: site.text });
    if (!read.ok) {
      failed.push({ name: client.name, why: read.reason });
      await note(client.salesforce_client_id, read.reason);
      continue;
    }

    const { extracted } = read;

    if (!extracted.is_a_manufacturer) {
      /*
       * A real answer, not a failure. Marking it enriched stops it being tried
       * again -- a parked domain will still be parked next week, and retrying
       * it is the queue eating itself.
       */
      await db.from("client_profile").upsert({
        salesforce_client_id: client.salesforce_client_id,
        website_used: site.url,
        summary: extracted.summary || null,
        model: ENRICH_MODEL,
        enriched_at: new Date().toISOString(),
        attribute_count: 0,
        error: null,
      }, { onConflict: "salesforce_client_id" });
      done.push({ name: client.name, attributes: 0 });
      continue;
    }

    const rows = extracted.attributes.map((a) => ({
      salesforce_client_id: client.salesforce_client_id,
      kind: a.kind,
      value: a.value.trim(),
      raw_value: a.raw_value?.trim() || null,
      evidence: a.evidence.slice(0, 400),
      source_url: site.url,
      confidence: a.confidence,
    }));

    if (rows.length) {
      // Upsert rather than insert: a re-run should refresh what it found, not
      // fail on the facts it found last time.
      await db.from("client_attributes")
        .upsert(rows, { onConflict: "salesforce_client_id,kind,value" });
    }

    await db.from("client_profile").upsert({
      salesforce_client_id: client.salesforce_client_id,
      website_used: site.url,
      summary: extracted.summary || null,
      model: ENRICH_MODEL,
      enriched_at: new Date().toISOString(),
      attribute_count: rows.length,
      error: null,
    }, { onConflict: "salesforce_client_id" });

    done.push({ name: client.name, attributes: rows.length });
  }

  const { count: remaining } = await db
    .from("client_roster")
    .select("salesforce_client_id", { count: "exact", head: true })
    .not("website", "is", null);

  return NextResponse.json({
    read: done.length,
    failed: failed.length,
    attributesWritten: done.reduce((n, d) => n + d.attributes, 0),
    details: { done, failed },
    ofAbout: remaining ?? null,
  });
}

async function nextAttempt(id: string): Promise<number> {
  const db = createServiceClient();
  const { data } = await db
    .from("client_profile").select("attempts").eq("salesforce_client_id", id).maybeSingle();
  return ((data as { attempts: number } | null)?.attempts ?? 0) + 1;
}

async function note(id: string, error: string) {
  await createServiceClient().from("client_profile").upsert({
    salesforce_client_id: id,
    error: error.slice(0, 300),
  }, { onConflict: "salesforce_client_id" });
}
