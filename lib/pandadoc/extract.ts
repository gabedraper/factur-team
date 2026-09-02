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

const Kpi = z.object({
  metric: z.enum(METRICS),
  target_per_month: z.number().nullable(),
  /** The sentence promising it. Without one, the target is dropped. */
  quote: z.string(),
});

const Contract = z.object({
  service: z.string().nullable(),
  billing_amount: z.number().nullable(),
  billing_frequency: z.string().nullable(),
  total_project_fee: z.number().nullable(),
  setup_fee: z.number().nullable(),
  payment_terms: z.string().nullable(),
  term_months: z.number().nullable(),
  term_start: z.string().nullable(),
  term_end: z.string().nullable(),
  auto_renew: z.boolean().nullable(),
  notice_days: z.number().nullable(),
  billing_contact_name: z.string().nullable(),
  billing_contact_email: z.string().nullable(),
  billing_contact_phone: z.string().nullable(),
  /** What they are not getting, or are excused from. Empty when it says none. */
  opt_outs: z.string().nullable(),
  /** Anything unusual a person should read before acting on this client. */
  other_terms: z.string().nullable(),
  kpis: z.array(Kpi),
  /** Where a figure was stated in a way that could be read two ways. */
  ambiguities: z.array(z.string()),
});

export type Contract = z.infer<typeof Contract>;

const SYSTEM = `You are reading a signed services agreement between Factur, a
manufacturing sales agency, and a client. Record only what the document
actually states.

Rules, in order of importance:

1. A field the contract does not state is null. Never infer, average, or carry a
   figure across from a similar contract. An empty field is a correct answer.
2. Never derive one figure from another. If the contract gives a total project
   fee and a term but no monthly amount, billing_amount is null -- dividing them
   is a guess, and the total often bundles a setup fee.
3. Money is a plain number with no symbol or separators: $4,500.00 is 4500.
4. Dates are YYYY-MM-DD. A date written only as a month, or as "on signature",
   is null.
5. A KPI is a number the agreement promises to deliver -- leads, appointments,
   quotes, purchase orders, completed projects -- expressed per month. If it is
   quoted per quarter or per term, convert it to a monthly figure and say so in
   the quote. Every KPI needs the sentence that promises it, verbatim.
6. opt_outs is what this client is excluded from or has declined: services not
   taken, clauses struck out, obligations waived. Not a summary of the contract.
7. If a figure is stated in a way that could be read two ways, record it as null
   and describe the problem in ambiguities.

Aspirational language is not a promise. "We aim to", "typically", "up to" and
"our clients often see" are not KPIs. Only record a KPI where the agreement
commits to a number.`;

export type ExtractResult =
  | { ok: true; contract: Contract; model: string }
  | { ok: false; reason: string };

export async function extractFromPdf(
  name: string,
  pdfBase64: string
): Promise<ExtractResult> {
  const client = new Anthropic();

  try {
    const res = await client.messages.parse({
      model: CONTRACT_MODEL,
      max_tokens: 8000,
      system: SYSTEM,
      output_config: { format: zodOutputFormat(Contract) },
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

    const contract = res.parsed_output;
    if (!contract) return { ok: false, reason: "the model returned nothing usable" };

    /*
     * The instruction does most of the work; this catches the rest, because
     * "usually obeys" is not a property to build a billing figure on. A KPI
     * without a real sentence behind it is discarded rather than trusted.
     */
    const kpis = contract.kpis.filter(
      (k) => k.target_per_month !== null && k.quote.trim().length > 12
    );

    return { ok: true, contract: { ...contract, kpis }, model: CONTRACT_MODEL };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "extraction failed" };
  }
}
