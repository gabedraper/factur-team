/**
 * Filling a chase template in.
 *
 * The placeholders are deliberately few and deliberately plain. Anything that
 * cannot be filled falls back to something that still reads as English -- an
 * email opening "Hi ," because QuickBooks holds no contact name is worse than
 * one opening "Hi there".
 */

import { escapeValue, htmlToText, isHtml, textToHtml, wrapHtml } from "@/lib/email/richtext";

const money = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 0,
});

export type Figures = {
  client_name: string;
  contact_first_name: string | null;
  payment_terms: string | null;
  days_past_due: number;
  past_due_total: number | null;
  open_balance: number | null;
  oldest_invoice_no: string | null;
  invoice_lines: string | null;
  sender_name: string;
};

export const PLACEHOLDERS = [
  "client", "contact", "days", "past_due", "balance",
  "oldest_invoice", "invoices", "terms", "sender",
] as const;

function values(f: Figures): Record<string, string> {
  return {
    client: f.client_name,
    contact: f.contact_first_name ?? "there",
    days: String(f.days_past_due),
    past_due: money.format(f.past_due_total ?? 0),
    balance: money.format(f.open_balance ?? 0),
    oldest_invoice: f.oldest_invoice_no ?? "",
    invoices: f.invoice_lines ?? "",
    terms: f.payment_terms ?? "as agreed",
    sender: f.sender_name,
  };
}

/**
 * An unknown placeholder is left exactly as written rather than blanked. A
 * typo should look like a typo in the preview, not silently swallow a sentence.
 */
function apply(template: string, table: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, name: string) =>
    name in table ? table[name] : whole
  );
}

/**
 * The plain-text rendering.
 *
 * Templates are HTML now, so the markup comes out first and the figures go in
 * after -- the other order would fill a value into markup and then have to
 * unpick which angle brackets were the template's and which were the client's
 * name. Placeholders are plain text either way, so they survive the trip.
 */
export function fill(template: string, figures: Figures): string {
  return apply(htmlToText(template), values(figures));
}

/**
 * The same chase as HTML.
 *
 * The template is trusted markup, written in our own editor; the figures are
 * not -- a client called "Smith & Sons" would otherwise put a stray entity
 * through the middle of the message. So values are escaped and the template
 * is left alone, which is the opposite of what this did when bodies were
 * plain text.
 *
 * {{invoices}} arrives as several lines and has to keep them. Escaped text
 * with real newlines in it collapses into one run-on line in HTML.
 */
export function fillHtml(template: string, figures: Figures): string {
  const table = values(figures);
  const safe = Object.fromEntries(
    Object.entries(table).map(([k, v]) => [k, escapeValue(v).replace(/\n/g, "<br>")])
  );
  return wrapHtml(apply(isHtml(template) ? template : textToHtml(template), safe));
}
