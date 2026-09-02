import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  listCompleted, details, pdf, money, whole, isoDate, serviceFromName,
} from "@/lib/pandadoc/client";
import { extractFromPdf } from "@/lib/pandadoc/extract";

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

  const imported: string[] = [];
  const read: string[] = [];
  const problems: string[] = [];

  /*
   * Only the first page. Completed documents are listed newest first, so
   * anything signed since the last run is at the top -- walking deeper on every
   * run would re-read the whole archive every few minutes to find nothing.
   */
  try {
    const { data: seen } = await db
      .from("client_agreements").select("external_id").eq("source", "pandadoc");
    const already = new Set(
      ((seen ?? []) as { external_id: string | null }[]).map((r) => r.external_id)
    );

    for (const doc of await listCompleted(1)) {
      if (imported.length >= IMPORT) break;
      if (already.has(doc.id)) continue;

      const d = await details(doc.id);
      const { data: resolved } = await db.rpc("resolve_pandadoc_client", {
        p_opportunity_id: d.opportunityId,
        p_account_id: d.accountId,
        p_account_name: d.tokens["Account.Name"] ?? null,
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
      const filled: Record<string, unknown> = {};
      const put = (k: string, v: unknown) => {
        if (v !== null && v !== undefined && v !== "") filled[k] = v;
      };
      put("total_project_fee", money(t["Total_Project_Fee__c"]));
      put("setup_fee", money(t["One_Time_Setup_fee__c"]));
      put("term_months", whole(t["Contract_Length__c"]));
      put("term_start", isoDate(t["Contract_Start_Date__c"]));
      put("billing_contact_name", t["Client_Contact__r.Name"]);
      put("billing_contact_email", t["Client_Contact__r.Email"]);
      put("billing_contact_phone", t["ContactPhone__c"]);
      put("service", serviceFromName(d.name));

      if (Object.keys(filled).length > 0) {
        await db.from("client_terms").upsert(
          {
            client_id: hit.client_id,
            agreement_id: (saved as { id: string } | null)?.id ?? null,
            ...filled,
            source: "contract",
            extracted_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            updated_by: "sync",
          },
          { onConflict: "client_id" }
        );
      }
    }
  } catch (e) {
    problems.push(`import: ${e instanceof Error ? e.message : "failed"}`);
  }

  // Then a couple of unread documents, newest first.
  const { data: unread } = await db
    .from("client_agreements")
    .select("id,external_id,name,client_id")
    .eq("source", "pandadoc")
    .not("client_id", "is", null)
    .is("pdf_read_at", null)
    .order("signed_on", { ascending: false })
    .limit(READ);

  for (const row of (unread ?? []) as {
    id: string; external_id: string; name: string; client_id: string;
  }[]) {
    try {
      const res = await pdf(row.external_id);
      const bytes = Buffer.from(await res.arrayBuffer());
      const out = await extractFromPdf(row.name, bytes.toString("base64"));

      if (!out.ok) {
        await db.from("client_agreements")
          .update({ pdf_read_at: new Date().toISOString(), pdf_read_problem: out.reason })
          .eq("id", row.id);
        problems.push(`${row.name}: ${out.reason}`);
        continue;
      }

      const c = out.contract;
      const terms: Record<string, unknown> = {};
      const put = (k: string, v: unknown) => {
        if (v !== null && v !== undefined && v !== "") terms[k] = v;
      };
      put("service", c.service);
      put("billing_amount", c.billing_amount);
      put("billing_frequency", c.billing_frequency);
      put("total_project_fee", c.total_project_fee);
      put("setup_fee", c.setup_fee);
      put("payment_terms", c.payment_terms);
      put("term_months", c.term_months);
      put("term_start", c.term_start);
      put("term_end", c.term_end);
      put("notice_days", c.notice_days);
      put("billing_contact_name", c.billing_contact_name);
      put("billing_contact_email", c.billing_contact_email);
      put("billing_contact_phone", c.billing_contact_phone);
      put("opt_outs", c.opt_outs);
      if (c.auto_renew !== null) terms.auto_renew = c.auto_renew;
      put("other_terms",
        [c.other_terms, ...(c.ambiguities ?? []).map((a) => `Unclear: ${a}`)]
          .filter(Boolean).join("\n"));

      await db.from("client_terms").upsert(
        {
          client_id: row.client_id,
          agreement_id: row.id,
          ...terms,
          source: "contract",
          extracted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          updated_by: "sync",
        },
        { onConflict: "client_id" }
      );

      for (const k of c.kpis) {
        await db.from("client_kpi_targets").upsert(
          {
            client_id: row.client_id,
            metric: k.metric,
            target_per_month: k.target_per_month,
            source: "contract",
            updated_at: new Date().toISOString(),
            updated_by: "sync",
          },
          { onConflict: "client_id,metric" }
        );
      }

      await db.from("client_agreements")
        .update({ pdf_read_at: new Date().toISOString(), pdf_read_problem: null })
        .eq("id", row.id);
      read.push(row.name);
    } catch (e) {
      const reason = e instanceof Error ? e.message : "failed";
      await db.from("client_agreements")
        .update({ pdf_read_at: new Date().toISOString(), pdf_read_problem: reason })
        .eq("id", row.id);
      problems.push(`${row.name}: ${reason}`);
    }
  }

  return NextResponse.json({ imported, read, problems });
}
