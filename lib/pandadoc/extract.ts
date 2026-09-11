import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

/*
 * Reading a signed agreement.
 *
 * About a third of the documents carry their figures as Salesforce merge
 * fields, and those are read straight off the record -- exact, free, and not
 * open to interpretation. This is for the rest, and for the two things no
 * document carries as a field: the performance numbers we promised, and what
 * the client opted out of. Both are prose in the body.
 *
 * The discipline here is the same as the website enrichment: a model asked what
 * a contract says will produce a confident, plausible monthly fee for a
 * document that never states one, and a plausible number is worse than an empty
 * field because somebody will invoice against it. So every figure has to come
 * with the sentence it came from, and anything unquoted is dropped before it
 * reaches the database.
 *
 * The PDF goes to the model as a document rather than as scraped text. Contract
 * terms live in tables and schedules, and flattening those to a line of words
 * is how a setup fee ends up read as a monthly one.
 */

/** These figures decide what gets invoiced. Not the place to save on the model. */
export const CONTRACT_MODEL = "claude-opus-5";

const METRICS = ["leads", "appointments", "quotes", "pos", "project_completion"] as const;

/*
 * No field in this schema is nullable. The API compiles the schema into a
 * grammar, and every nullable field is a union that doubles the work -- past
 * sixteen it refuses the request outright, which is how every agreement failed
 * before this. So a field the contract does not state is left out of the answer
 * instead of sent as null. Absent and null mean the same thing here, and the
 * writer treats them alike: the column stays empty.
 */

const Kpi = z.object({
  metric: z.enum(METRICS),
  /** A promise with no number is not a KPI, so this is never absent. */
  target_per_month: z.number(),
  /** The sentence promising it. Without one, the target is dropped. */
  quote: z.string(),
});

const PastDueInterest = z.object({
  /** As stated: 1.5% a month is 1.5 with "month", never annualised. Zero when it says none accrues. */
  pct: z.number(),
  period: z.enum(["month", "year"]).optional(),
  /** Days after the invoice before interest starts, where the clause says. */
  after_days: z.number().int().optional(),
  /** The sentence itself. Without one, the rate is dropped. */
  clause: z.string(),
});

const Contract = z.object({
  service: z.string().optional(),
  billing_amount: z.number().optional(),
  billing_frequency: z.string().optional(),
  total_project_fee: z.number().optional(),
  setup_fee: z.number().optional(),
  payment_terms: z.string().optional(),
  term_months: z.number().optional(),
  term_start: z.string().optional(),
  term_end: z.string().optional(),
  auto_renew: z.boolean().optional(),
  notice_days: z.number().optional(),
  billing_contact_name: z.string().optional(),
  billing_contact_email: z.string().optional(),
  billing_contact_phone: z.string().optional(),
  /** What they are not getting, or are excused from. Empty when it says none. */
  opt_outs: z.string().optional(),
  /** Anything unusual a person should read before acting on this client. */
  other_terms: z.string().optional(),
  past_due_interest: PastDueInterest.optional(),
  kpis: z.array(Kpi),
  /** Where a figure was stated in a way that could be read two ways. */
  ambiguities: z.array(z.string()),
});

export type Contract = z.infer<typeof Contract>;
export const CONTRACT_FORMAT = zodOutputFormat(Contract);
export type PastDueInterest = z.infer<typeof PastDueInterest>;

const SYSTEM = `You are reading a signed services agreement between Factur, a
manufacturing sales agency, and a client. Record only what the document
actually states.

Rules, in order of importance:

1. A field the contract does not state is left out of your answer. Never infer,
   average, or carry a figure across from a similar contract. Leaving a field
   out is a correct answer.
2. Never derive one figure from another. If the contract gives a total project
   fee and a term but no monthly amount, leave billing_amount out -- dividing
   them is a guess, and the total often bundles a setup fee.
3. Money is a plain number with no symbol or separators: $4,500.00 is 4500.
4. Dates are YYYY-MM-DD. A date written only as a month, or as "on signature",
   is left out.
5. A KPI is a number the agreement promises to deliver -- leads, appointments,
   quotes, purchase orders, completed projects -- expressed per month. If it is
   quoted per quarter or per term, convert it to a monthly figure and say so in
   the quote. Every KPI needs the sentence that promises it, verbatim.
6. opt_outs is what this client is excluded from or has declined: services not
   taken, clauses struck out, obligations waived. Not a summary of the contract.
7. past_due_interest is the interest the agreement charges on a late invoice.
   pct is the rate exactly as written, with the period it is written against:
   "1.5% per month" is pct 1.5, period month -- never convert it to a yearly
   rate. after_days is how long after the invoice interest begins, only if the
   clause says. clause is the sentence, verbatim. A contract that says no
   interest accrues is pct 0. A flat late fee is not interest; put it in
   other_terms. A contract silent on late payment leaves past_due_interest out.
8. If a figure is stated in a way that could be read two ways, leave it out and
   describe the problem in ambiguities.

Aspirational language is not a promise. "We aim to", "typically", "up to" and
"our clients often see" are not KPIs. Only record a KPI where the agreement
commits to a number.`;

export type ExtractResult =
  | { ok: true; contract: Contract; model: string }
  /** retry: nothing was wrong with the document -- the service was busy, down or unreachable. */
  | { ok: false; reason: string; retry: boolean };

export async function extractFromPdf(
  name: string,
  pdfBase64: string
): Promise<ExtractResult> {
  const client = new Anthropic();

  try {
    const res = await client.messages.parse({
      model: CONTRACT_MODEL,
      // Thinking is on by default on this model and draws from the same allowance.
      max_tokens: 16000,
      system: SYSTEM,
      output_config: { format: CONTRACT_FORMAT },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: pdfBase64,
              },
            },
            {
              type: "text",
              text:
                `This is "${name}". Record the terms it states, and the ` +
                `performance numbers it promises.`,
            },
          ],
        },
      ],
    });

    if (res.stop_reason === "refusal") {
      return { ok: false, reason: "the model declined to read this document", retry: false };
    }
    const contract = res.parsed_output;
    if (!contract) {
      return { ok: false, reason: "the model returned nothing usable", retry: false };
    }

    /*
     * The instruction does most of the work; this catches the rest, because
     * "usually obeys" is not a property to build a billing figure on. A KPI or
     * an interest rate without a real sentence behind it is discarded rather
     * than trusted.
     */
    const kpis = contract.kpis.filter((k) => k.quote.trim().length > 12);

    const ambiguities = [...contract.ambiguities];
    let past_due_interest = contract.past_due_interest;
    if (past_due_interest) {
      const p = past_due_interest;
      if (p.clause.trim().length <= 12 || p.pct < 0 || p.pct > 100) {
        past_due_interest = undefined;
      } else if (p.pct > 0 && !p.period) {
        // 1.5 a month and 1.5 a year are twelve times apart. Not a guess to make.
        ambiguities.push(`Past due interest of ${p.pct}% with no period: "${p.clause}"`);
        past_due_interest = undefined;
      }
    }

    return {
      ok: true,
      contract: { ...contract, kpis, past_due_interest, ambiguities },
      model: CONTRACT_MODEL,
    };
  } catch (e) {
    const reason = e instanceof Error ? e.message : "extraction failed";
    /*
     * A busy, failing or unreachable service -- or a key that stopped working --
     * says nothing about the document, so it is tried again on a later run
     * rather than marked as read. Anything else is about this document and
     * would fail the same way next time.
     */
    const retry =
      e instanceof Anthropic.RateLimitError ||
      e instanceof Anthropic.InternalServerError ||
      e instanceof Anthropic.APIConnectionError ||
      e instanceof Anthropic.AuthenticationError ||
      e instanceof Anthropic.PermissionDeniedError;
    return { ok: false, reason, retry };
  }
}
