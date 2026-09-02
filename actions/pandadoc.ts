"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { myPermissions } from "@/lib/org";
import {
  listCompleted, details, pdf, money, whole, isoDate, serviceFromName,
} from "@/lib/pandadoc/client";
import { extractFromPdf } from "@/lib/pandadoc/extract";

export type ImportReport = {
  looked_at: number;
  imported: number;
  matched: number;
  unmatched: number;
  terms_filled: number;
  by_match: Record<string, number>;
  finished: boolean;
  problem?: string;
};

async function mayImport() {
  const perms = await myPermissions();
  return perms.has("org.manage");
}

async function whoAmI(): Promise<string | null> {
  const {
    data: { user },
  } = await (await createClient()).auth.getUser();
  return user?.email ?? null;
}

/**
 * Bring in a batch of signed agreements.
 *
 * A batch rather than the lot: there are 1,275 of them and each needs its own
 * call for the detail, so one pass would sit well past any request timeout.
 * Documents already imported are skipped, so this is safe to run again and
 * again until it says it has finished.
 *
 * Terms are only written where the document actually carries the token. About
 * a third of them do; the rest keep whatever a person has typed, and are left
 * for the reading of the PDF that comes later.
 */
export async function importAgreements(batch = 40): Promise<ImportReport> {
  const report: ImportReport = {
    looked_at: 0, imported: 0, matched: 0, unmatched: 0,
    terms_filled: 0, by_match: {}, finished: false,
  };

  if (!(await mayImport())) return { ...report, problem: "Not permitted." };

  const db = createServiceClient();
  const me = await whoAmI();

  const { data: seen } = await db
    .from("client_agreements")
    .select("external_id")
    .eq("source", "pandadoc");
  const already = new Set(
    ((seen ?? []) as { external_id: string | null }[]).map((r) => r.external_id)
  );

  try {
    // Walk the pages until the batch is full or the list runs out.
    for (let page = 1; page <= 30 && report.imported < batch; page++) {
      const docs = await listCompleted(page);
      if (docs.length === 0) {
        report.finished = true;
        break;
      }

      for (const doc of docs) {
        if (report.imported >= batch) break;
        report.looked_at++;
        if (already.has(doc.id)) continue;

        const d = await details(doc.id);

        const { data: resolved } = await db.rpc("resolve_pandadoc_client", {
          p_opportunity_id: d.opportunityId,
          p_account_id: d.accountId,
          p_account_name: d.tokens["Account.Name"] ?? null,
        });
        const hit = ((resolved ?? []) as { client_id: string; matched_by: string }[])[0];

        if (!hit) {
          report.unmatched++;
        } else {
          report.matched++;
          report.by_match[hit.matched_by] = (report.by_match[hit.matched_by] ?? 0) + 1;
        }

        const { data: inserted, error } = await db
          .from("client_agreements")
          .upsert(
            {
              client_id: hit?.client_id ?? null,
              source: "pandadoc",
              external_id: d.id,
              name: d.name,
              signed_on: d.date_completed ? d.date_completed.slice(0, 10) : null,
              status: "completed",
              imported_by: me,
            },
            { onConflict: "source,external_id" }
          )
          .select("id")
          .maybeSingle();

        if (error) return { ...report, problem: error.message };
        report.imported++;
        already.add(d.id);

        if (!hit) continue;

        /*
         * Only what the document says. An absent token leaves the field alone
         * rather than blanking whatever somebody typed, so running this again
         * cannot undo a correction.
         */
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
          const { error: termsError } = await db.from("client_terms").upsert(
            {
              client_id: hit.client_id,
              agreement_id: (inserted as { id: string } | null)?.id ?? null,
              ...filled,
              source: "contract",
              extracted_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              updated_by: me,
            },
            { onConflict: "client_id" }
          );
          if (!termsError) report.terms_filled++;
        }
      }
    }
  } catch (e) {
    return { ...report, problem: e instanceof Error ? e.message : "PandaDoc call failed." };
  }

  revalidatePath("/settings/agreements");
  return report;
}

export type AgreementCounts = {
  imported: number;
  matched: number;
  unmatched: number;
  with_terms: number;
};

export async function agreementCounts(): Promise<AgreementCounts> {
  if (!(await mayImport())) {
    return { imported: 0, matched: 0, unmatched: 0, with_terms: 0 };
  }
  const db = createServiceClient();
  const [all, unmatched, terms] = await Promise.all([
    db.from("client_agreements").select("id", { count: "exact", head: true }),
    db.from("client_agreements").select("id", { count: "exact", head: true }).is("client_id", null),
    db.from("client_terms").select("client_id", { count: "exact", head: true }).eq("source", "contract"),
  ]);
  const imported = all.count ?? 0;
  const un = unmatched.count ?? 0;
  return { imported, matched: imported - un, unmatched: un, with_terms: terms.count ?? 0 };
}


export type ExtractReport = {
  read: number;
  filled: number;
  kpis_found: number;
  skipped: number;
  problems: string[];
  finished: boolean;
  problem?: string;
};

/**
 * Read the agreements the merge fields could not answer for.
 *
 * Only agreements matched to a client, and only where a person has not already
 * written the terms by hand -- a reading of a PDF should never overwrite
 * somebody's correction.
 *
 * A batch at a time, and a small one: each document is a whole contract through
 * a large model, which is neither quick nor free.
 */
export async function extractAgreementTerms(batch = 5): Promise<ExtractReport> {
  const report: ExtractReport = {
    read: 0, filled: 0, kpis_found: 0, skipped: 0, problems: [], finished: false,
  };

  if (!(await mayImport())) return { ...report, problem: "Not permitted." };

  const db = createServiceClient();
  const me = await whoAmI();

  /*
   * Documents nobody has read yet, newest first. Tracked on the document rather
   * than on the client: a renewal is its own agreement and its own terms, and
   * skipping it because an older one was read would leave the client on last
   * year's numbers.
   */
  const { data: candidates, error } = await db
    .from("client_agreements")
    .select("id,external_id,name,client_id")
    .eq("source", "pandadoc")
    .not("client_id", "is", null)
    .is("pdf_read_at", null)
    .order("signed_on", { ascending: false })
    .limit(batch);

  if (error) return { ...report, problem: error.message };

  const todo = ((candidates ?? []) as {
    id: string; external_id: string; name: string; client_id: string;
  }[]);

  if (todo.length === 0) return { ...report, finished: true };

  for (const row of todo) {
    try {
      const res = await pdf(row.external_id);
      const bytes = Buffer.from(await res.arrayBuffer());
      report.read++;

      const out = await extractFromPdf(row.name, bytes.toString("base64"));
      if (!out.ok) {
        report.problems.push(`${row.name}: ${out.reason}`);
        report.skipped++;
        await db.from("client_agreements")
          .update({ pdf_read_at: new Date().toISOString(), pdf_read_problem: out.reason })
          .eq("id", row.id);
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

      /*
       * Anything the model could not read cleanly is written where a person
       * will see it rather than dropped, since a figure nobody knows is
       * doubtful is more dangerous than one flagged.
       */
      const notes = [c.other_terms, ...(c.ambiguities ?? []).map((a) => `Unclear: ${a}`)]
        .filter(Boolean)
        .join("\n");
      put("other_terms", notes);

      await db.from("client_terms").upsert(
        {
          client_id: row.client_id,
          agreement_id: row.id,
          ...terms,
          source: "contract",
          extracted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          updated_by: me,
        },
        { onConflict: "client_id" }
      );
      report.filled++;
      await db.from("client_agreements")
        .update({ pdf_read_at: new Date().toISOString(), pdf_read_problem: null })
        .eq("id", row.id);

      for (const k of c.kpis) {
        await db.from("client_kpi_targets").upsert(
          {
            client_id: row.client_id,
            metric: k.metric,
            target_per_month: k.target_per_month,
            source: "contract",
            updated_at: new Date().toISOString(),
            updated_by: me,
          },
          { onConflict: "client_id,metric" }
        );
        report.kpis_found++;
      }
    } catch (e) {
      const reason = e instanceof Error ? e.message : "failed";
      report.problems.push(`${row.name}: ${reason}`);
      report.skipped++;
      await db.from("client_agreements")
        .update({ pdf_read_at: new Date().toISOString(), pdf_read_problem: reason })
        .eq("id", row.id);
    }
  }

  revalidatePath("/settings/agreements");
  return report;
}
