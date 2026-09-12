import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  listCompleted, details, money, whole, isoDate, serviceFromName,
} from "@/lib/pandadoc/client";
import { readAgreement, writeTerms } from "@/lib/pandadoc/apply";
import { READ_BUDGET_MS } from "@/lib/pandadoc/extract";

/*
 * Keeping the signed agreements current, a few at a time.
 *
 * Two jobs in one queue, because they share a schedule and neither is worth its
 * own. First, anything newly completed in PandaDoc is brought in and linked --
 * cheap, and the reason this runs often. Second, one or two of the documents
 * nobody has read yet go through the model, which is neither cheap nor quick,
 * so the archive is worked through slowly in the background rather than in one
 * expensive burst.
 *
 * The newest documents are listed first, so a contract signed this morning is
 * imported on the next run rather than behind three years of history.
 */

export const maxDuration = 300;

/** New documents to import, and PDFs to read, per invocation. */
const IMPORT = 25;
const READ = 2;

/*
 * Stop starting documents with less than a document's worth of time left. Being
 * killed mid-read writes nothing -- not the terms, not the problem -- and the
 * document is read and paid for again on the next run.
 */
const RUN_BUDGET_MS = maxDuration * 1000 - READ_BUDGET_MS - 20_000;

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
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

  const imported: string[] = [];
  const read: string[] = [];
  const problems: string[] = [];

  /*
   * Only the first page. Completed documents are listed newest first, so
   * anything signed since the last run is at the top -- walking deeper on every
   * run would re-read the whole archive every few minutes to find nothing.
   */
  try {
    const docs = await listCompleted(1);
    // Asked about this page's documents only. Reading every agreement ever
    // imported hit the API's silent 1,000-row stop, and any it missed could
    // look new and be imported again.
    const { data: seen, error: seenError } = docs.length
      ? await db.from("client_agreements").select("external_id")
          .eq("source", "pandadoc").in("external_id", docs.map((d) => d.id))
      : { data: [], error: null };
    if (seenError) throw new Error(seenError.message);
    const already = new Set(
      ((seen ?? []) as { external_id: string | null }[]).map((r) => r.external_id)
    );

    for (const doc of docs) {
      if (imported.length >= IMPORT) break;
      if (already.has(doc.id)) continue;

      const d = await details(doc.id);
      const { data: resolved } = await db.rpc("resolve_pandadoc_client", {
        p_opportunity_id: d.opportunityId,
        p_account_id: d.accountId,
        p_account_name: d.tokens["Account.Name"] ?? null,
        p_signed_on: d.date_completed ? d.date_completed.slice(0, 10) : null,
      });
      const hit = ((resolved ?? []) as { client_id: string }[])[0];

      const { data: saved } = await db
        .from("client_agreements")
        .upsert(
          {
            client_id: hit?.client_id ?? null,
            source: "pandadoc",
            external_id: d.id,
            name: d.name,
            signed_on: d.date_completed ? d.date_completed.slice(0, 10) : null,
            status: "completed",
            imported_by: "sync",
          },
          { onConflict: "source,external_id" }
        )
        .select("id")
        .maybeSingle();

      imported.push(d.name);
      if (!hit) continue;

      const t = d.tokens;
      try {
        await writeTerms(
          db,
          {
            clientId: hit.client_id,
            agreementId: (saved as { id: string } | null)?.id ?? null,
            signedOn: d.date_completed ? d.date_completed.slice(0, 10) : null,
          },
          {
            total_project_fee: money(t["Total_Project_Fee__c"]),
            setup_fee: money(t["One_Time_Setup_fee__c"]),
            term_months: whole(t["Contract_Length__c"]),
            term_start: isoDate(t["Contract_Start_Date__c"]),
            billing_contact_name: t["Client_Contact__r.Name"],
            billing_contact_email: t["Client_Contact__r.Email"],
            billing_contact_phone: t["ContactPhone__c"],
            service: serviceFromName(d.name),
          },
          "sync"
        );
      } catch (e) {
        problems.push(`${d.name}: ${e instanceof Error ? e.message : "terms not written"}`);
      }
    }
  } catch (e) {
    problems.push(`import: ${e instanceof Error ? e.message : "failed"}`);
  }

  // Then a couple of unread documents, newest first.
  const { data: unread } = await db
    .from("client_agreements")
    .select("id,external_id,name,client_id,signed_on")
    .eq("source", "pandadoc")
    .not("client_id", "is", null)
    .is("pdf_read_at", null)
    .order("signed_on", { ascending: false })
    .limit(READ);

  for (const row of (unread ?? []) as {
    id: string; external_id: string; name: string; client_id: string; signed_on: string | null;
  }[]) {
    if (Date.now() - startedAt > RUN_BUDGET_MS) {
      problems.push("ran out of time; the rest are left for the next run");
      break;
    }
    const out = await readAgreement(db, row, "sync");
    if (out.ok) read.push(row.name);
    else problems.push(`${row.name}: ${out.reason}`);
  }

  return NextResponse.json({ imported, read, problems });
}
