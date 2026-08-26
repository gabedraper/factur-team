/**
 * Filling a chase template in.
 *
 * The placeholders are deliberately few and deliberately plain. Anything that
 * cannot be filled falls back to something that still reads as English -- an
 * email opening "Hi ," because QuickBooks holds no contact name is worse than
 * one opening "Hi there".
 */

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
export function fill(template: string, figures: Figures): string {
  const table = values(figures);
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, name: string) =>
    name in table ? table[name] : whole
  );
}
