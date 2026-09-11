import type { createServiceClient } from "@/lib/supabase/server";
import { pdf } from "@/lib/pandadoc/client";
import { extractFromPdf, type Contract, type PastDue } from "@/lib/pandadoc/extract";

/*
 * Writing what an agreement says onto the client.
 *
 * Every pass that reads an agreement -- the merge fields at import, and the
 * reading of the PDF -- writes through here, because the rules for when a
 * document may change a client's terms are the same whichever part of it was
 * read:
 *
 * - A person's terms are theirs. Once somebody has saved the terms by hand the
 *   row is marked manual, and a document may only fill the fields they left
 *   empty. It never replaces a figure a person typed.
 * - The merge fields are exact. When the PDF of an agreement is read after its
 *   merge fields were, the reading only fills what they left empty.
 * - The newest agreement wins. The backlog is read newest first, so an older
 *   document read afterwards must not put last year's price back. It changes
 *   nothing but the past due interest.
 * - Past due interest is only ever filled, never replaced. Renewals mostly
 *   restate the price but not the payment clause, so the rate often comes from
 *   an older document than the rest, and the rates already on file were checked
 *   by hand.
 */

type Db = ReturnType<typeof createServiceClient>;

export type TermsTarget = {
  clientId: string;
  agreementId: string | null;
  signedOn: string | null;
};

const PAST_DUE_KEYS = [
  "past_due_interest_pct",
  "past_due_interest_period",
  "past_due_interest_after_days",
  "past_due_interest_clause",
] as const;

/** Whether anything was written, and whether this document is older than the one the terms already come from. */
export type TermsWritten = { wrote: boolean; older: boolean };

export async function writeTerms(
  db: Db,
  target: TermsTarget,
  stated: Record<string, unknown>,
  who: string | null,
  pastDue?: PastDue | null
): Promise<TermsWritten> {
  const { data: existing, error: readError } = await db
    .from("client_terms")
    .select("*")
    .eq("client_id", target.clientId)
    .maybeSingle();
  if (readError) throw new Error(`reading terms: ${readError.message}`);
  const row = existing as Record<string, unknown> | null;

  let older = false;
  const currentId = row?.agreement_id as string | null | undefined;
  if (currentId && currentId !== target.agreementId && target.signedOn) {
    const { data: current } = await db
      .from("client_agreements")
      .select("signed_on")
      .eq("id", currentId)
      .maybeSingle();
    const currentSigned = (current as { signed_on: string | null } | null)?.signed_on;
    older = !!currentSigned && currentSigned > target.signedOn;
  }

  const manual = row?.source === "manual";
  const fillOnly = manual || (!!currentId && currentId === target.agreementId);
  const fields: Record<string, unknown> = {};
  if (!older) {
    for (const [k, v] of Object.entries(stated)) {
      if (v === null || v === undefined || v === "") continue;
      if (fillOnly && row?.[k] !== null && row?.[k] !== undefined) continue;
      fields[k] = v;
    }
  }

  if (pastDue && PAST_DUE_KEYS.every((k) => row?.[k] === null || row?.[k] === undefined)) {
    fields.past_due_interest_pct = pastDue.pct;
    fields.past_due_interest_period = pastDue.period ?? null;
    fields.past_due_interest_after_days = pastDue.after_days ?? null;
    fields.past_due_interest_clause = pastDue.clause;
    fields.past_due_interest_agreement_id = target.agreementId;
  }

  if (Object.keys(fields).length === 0) return { wrote: false, older };

  const now = new Date().toISOString();
  const stamp = { updated_at: now, updated_by: who };
  // Only a document that now speaks for the terms takes them over.
  const takeOver =
    !manual && !older
      ? { source: "contract", agreement_id: target.agreementId, extracted_at: now }
      : {};

  const { error } = row
    ? await db
        .from("client_terms")
        .update({ ...fields, ...takeOver, ...stamp })
        .eq("client_id", target.clientId)
    : await db
        .from("client_terms")
        .insert({
          client_id: target.clientId,
          ...fields,
          source: "contract",
          agreement_id: target.agreementId,
          extracted_at: now,
          ...stamp,
        });
  if (error) throw new Error(`writing terms: ${error.message}`);
  return { wrote: true, older };
}

/** The fields a reading of the PDF states, by column. */
function statedTerms(c: Contract): Record<string, unknown> {
  // Anything the model could not read cleanly is kept where a person will see
  // it: a figure nobody knows is doubtful is more dangerous than one flagged.
  const notes = [c.other_terms[0], ...c.ambiguities.map((a) => `Unclear: ${a}`)]
    .filter(Boolean)
    .join("\n");
  return {
    service: c.service[0],
    billing_amount: c.billing_amount[0],
    billing_frequency: c.billing_frequency[0],
    total_project_fee: c.total_project_fee[0],
    setup_fee: c.setup_fee[0],
    payment_terms: c.payment_terms[0],
    term_months: c.term_months[0],
    term_start: c.term_start[0],
    term_end: c.term_end[0],
    auto_renew: c.auto_renew[0],
    notice_days: c.notice_days[0],
    billing_contact_name: c.billing_contact_name[0],
    billing_contact_email: c.billing_contact_email[0],
    billing_contact_phone: c.billing_contact_phone[0],
    opt_outs: c.opt_outs[0],
    other_terms: notes,
  };
}

export type AgreementToRead = {
  id: string;
  external_id: string;
  name: string;
  client_id: string;
  signed_on: string | null;
};

export type ReadOutcome =
  | { ok: true; wrote: boolean; kpis: number }
  | { ok: false; reason: string };

/**
 * Read one agreement's PDF and write what it says.
 *
 * The document is marked read whatever happens, so a contract the model cannot
 * make sense of is not paid for again every ten minutes -- unless the failure
 * had nothing to do with the document, in which case it is left for the next
 * run.
 */
export async function readAgreement(
  db: Db,
  row: AgreementToRead,
  who: string | null
): Promise<ReadOutcome> {
  const mark = (problem: string | null) =>
    db
      .from("client_agreements")
      .update({ pdf_read_at: new Date().toISOString(), pdf_read_problem: problem })
      .eq("id", row.id);

  try {
    const res = await pdf(row.external_id);
    const bytes = Buffer.from(await res.arrayBuffer());
    const out = await extractFromPdf(row.name, bytes.toString("base64"));

    if (!out.ok) {
      if (out.retry) {
        await db.from("client_agreements").update({ pdf_read_problem: out.reason }).eq("id", row.id);
      } else {
        await mark(out.reason);
      }
      return { ok: false, reason: out.reason };
    }

    const c = out.contract;
    const { wrote, older } = await writeTerms(
      db,
      { clientId: row.client_id, agreementId: row.id, signedOn: row.signed_on },
      statedTerms(c),
      who,
      c.past_due_interest
    );

    /*
     * A promise from an older agreement has been superseded, and a target a
     * person set is theirs to change.
     */
    let kpis = 0;
    if (!older && c.kpis.length > 0) {
      const { data: have } = await db
        .from("client_kpi_targets")
        .select("metric,source")
        .eq("client_id", row.client_id);
      const manual = new Set(
        ((have ?? []) as { metric: string; source: string }[])
          .filter((k) => k.source === "manual")
          .map((k) => k.metric)
      );
      for (const k of c.kpis) {
        if (manual.has(k.metric)) continue;
        const { error } = await db.from("client_kpi_targets").upsert(
          {
            client_id: row.client_id,
            metric: k.metric,
            target_per_month: k.target_per_month,
            source: "contract",
            updated_at: new Date().toISOString(),
            updated_by: who,
          },
          { onConflict: "client_id,metric" }
        );
        if (error) throw new Error(`writing KPI ${k.metric}: ${error.message}`);
        kpis++;
      }
    }

    await mark(null);
    return { ok: true, wrote, kpis };
  } catch (e) {
    const reason = e instanceof Error ? e.message : "failed";
    await mark(reason);
    return { ok: false, reason };
  }
}
