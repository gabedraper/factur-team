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
 * No field in this schema is nullable or optional. The API compiles the schema
 * into a grammar before it reads anything, and every field that may be null or
 * absent multiplies what it has to compile: seventeen nullable fields were
 * refused outright, and nineteen optional ones were worked on for four minutes
 * and then refused as too complex. So a term the contract may or may not state
 * is a list -- empty when it does not, one value when it does. Every field is
 * always there, in order, and the grammar stays a straight line.
 *
 * Empty still means what null meant: the contract does not say, and the column
 * stays empty.
 */

const Kpi = z.object({
  metric: z.enum(METRICS),
  /** A promise with no number is not a KPI, so this is always a number. */
  target_per_month: z.number(),
  /** The sentence promising it. Without one, the target is dropped. */
  quote: z.string(),
});

const PastDueInterest = z.object({
  /** As stated: 1.5% a month is 1.5 with "month", never annualised. Zero when it says none accrues. */
  pct: z.number(),
  period: z.array(z.enum(["month", "year"])),
  /** Days after the invoice before interest starts, where the clause says. */
  after_days: z.array(z.number().int()),
  /** The sentence itself. Without one, the rate is dropped. */
  clause: z.string(),
});

const Contract = z.object({
  service: z.array(z.string()),
  billing_amount: z.array(z.number()),
  billing_frequency: z.array(z.string()),
  total_project_fee: z.array(z.number()),
  setup_fee: z.array(z.number()),
  payment_terms: z.array(z.string()),
  term_months: z.array(z.number()),
  term_start: z.array(z.string()),
  term_end: z.array(z.string()),
  auto_renew: z.array(z.boolean()),
  notice_days: z.array(z.number()),
  billing_contact_name: z.array(z.string()),
  billing_contact_email: z.array(z.string()),
  billing_contact_phone: z.array(z.string()),
  /** What they are not getting, or are excused from. Empty when it says none. */
  opt_outs: z.array(z.string()),
  /** Anything unusual a person should read before acting on this client. */
  other_terms: z.array(z.string()),
  past_due_interest: z.array(PastDueInterest),
  kpis: z.array(Kpi),
  /** Where a figure was stated in a way that could be read two ways. */
  ambiguities: z.array(z.string()),
});

export const CONTRACT_FORMAT = zodOutputFormat(Contract);

/** Terms that are a list of points by nature. Several values are joined, not doubted. */
const PROSE = ["payment_terms", "opt_outs", "other_terms"] as const;

/** Past due interest once checked: a rate, the period it is against, and the sentence. */
export type PastDue = {
  pct: number;
  period: "month" | "year" | null;
  after_days: number | null;
  clause: string;
};

/** Every term list holds at most one value by the time it leaves this file. */
export type Contract = Omit<z.infer<typeof Contract>, "past_due_interest"> & {
  past_due_interest: PastDue | null;
};

const SYSTEM = `You are reading a signed services agreement between Factur, a
manufacturing sales agency, and a client. Record only what the document
actually states.

Rules, in order of importance:

1. Every term is a list. A term the contract does not state is an empty list; a
   term it states is a list of exactly one value. Never infer, average, or carry
   a figure across from a similar contract. An empty list is a correct answer.
2. Never derive one figure from another. If the contract gives a total project
   fee and a term but no monthly amount, billing_amount is empty -- dividing
   them is a guess, and the total often bundles a setup fee.
3. Money is a plain number with no symbol or separators: $4,500.00 is 4500.
4. Dates are YYYY-MM-DD. A date written only as a month, or as "on signature",
   is left empty.
5. A KPI is a number the agreement promises to deliver -- leads, appointments,
   quotes, purchase orders, completed projects -- expressed per month. If it is
   quoted per quarter or per term, convert it to a monthly figure and say so in
   the quote. Every KPI needs the sentence that promises it, verbatim. A
   promise that offers alternatives ("4 sessions or 20 appointments") or
   depends on a condition is not a KPI; describe it in ambiguities.
6. opt_outs is what this client is excluded from or has declined: services not
   taken, clauses struck out, obligations waived, early exits it may take. Not a
   summary of the contract. One item per point.
   other_terms is only what is unusual about this client's agreement -- a
   special price, a guarantee, a clause added or changed for them. Standard
   wording every agreement carries (payment methods, card fees, collection
   costs, non-solicitation, confidentiality) is not an other_term. Usually
   empty; one item per point.
7. past_due_interest is the interest the agreement charges on a late invoice,
   and is empty if the contract is silent on it. pct is the rate exactly as
   written, with the period it is written against: "1.5% per month" is pct 1.5,
   period ["month"] -- never convert it to a yearly rate. after_days is how long
   after the invoice interest begins, and is empty unless the clause says.
   clause is the sentence, verbatim. A contract that says no interest accrues is
   pct 0. A flat late fee is not interest; put it in other_terms.
8. If a figure is stated in a way that could be read two ways, leave it empty
   and describe the problem in ambiguities.

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
    const parsed = res.parsed_output;
    if (!parsed) {
      return { ok: false, reason: "the model returned nothing usable", retry: false };
    }

    return { ok: true, contract: settle(parsed), model: CONTRACT_MODEL };
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

/**
 * What the model said, made safe to write.
 *
 * The instruction does most of the work; this catches the rest, because
 * "usually obeys" is not a property to build a billing figure on. A KPI or an
 * interest rate without a real sentence behind it is discarded rather than
 * trusted, and a figure given two values is treated as not stated.
 */
export function settle(parsed: z.infer<typeof Contract>): Contract {
  const { past_due_interest: rates, kpis: promised, ambiguities: unclear, ...terms } = parsed;
  const ambiguities = [...unclear];

  for (const [k, v] of Object.entries(terms) as [string, unknown[]][]) {
    if (v.length <= 1) continue;
    if ((PROSE as readonly string[]).includes(k)) {
      (terms as Record<string, unknown[]>)[k] = [v.join("\n")];
    } else {
      ambiguities.push(`${k} is given more than once: ${v.join(" / ")}`);
      (terms as Record<string, unknown[]>)[k] = [];
    }
  }

  const kpis = promised.filter((k) => k.quote.trim().length > 12);

  let past_due_interest: PastDue | null = null;
  if (rates.length > 1) {
    ambiguities.push(`More than one past due interest clause: ${rates.map((r) => `"${r.clause}"`).join(" / ")}`);
  } else if (rates.length === 1) {
    const r = rates[0];
    const period = r.period.length === 1 ? r.period[0] : null;
    if (r.clause.trim().length <= 12 || r.pct < 0 || r.pct > 100) {
      // Unquoted or impossible: dropped.
    } else if (r.pct > 0 && !period) {
      // 1.5 a month and 1.5 a year are twelve times apart. Not a guess to make.
      ambiguities.push(`Past due interest of ${r.pct}% with no period: "${r.clause}"`);
    } else {
      past_due_interest = {
        pct: r.pct,
        period,
        after_days: r.after_days.length === 1 ? r.after_days[0] : null,
        clause: r.clause,
      };
    }
  }

  return { ...terms, kpis, past_due_interest, ambiguities };
}
