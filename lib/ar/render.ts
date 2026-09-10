/**
 * Filling in a rung of the A/R ladder.
 *
 * Two things separate this from the client-level chase renderer it grew out
 * of. The figures are an invoice's -- its number, its own balance, its own due
 * date -- with the account total alongside, because Breno's wording quotes
 * both and they are rarely the same number. And the templates carry
 * conditional blocks: she wrote the autopay and non-autopay sentences as
 * alternatives in one email rather than as two emails, so the renderer has to
 * be able to drop one of them.
 */

import { escapeValue, htmlToText, isHtml, textToHtml, wrapHtml } from "@/lib/email/richtext";

const money = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 2,
});

const longDate = new Intl.DateTimeFormat("en-US", {
  day: "numeric", month: "long", year: "numeric",
});

export type Figures = {
  client_name: string;
  contact_first_name: string | null;
  invoice_no: string;
  invoice_balance: number | null;
  account_total: number | null;
  due_date: string | null;
  age_days: number;
  payment_terms: string | null;
  pay_link: string | null;
  interest_rate: string | null;
  autopay: boolean;
  account_manager: string | null;
  team_lead: string | null;
  sender_name: string;
};

export const PLACEHOLDERS = [
  "client", "contact", "invoice_no", "amount", "account_total",
  "due_date", "days", "terms", "pay_link", "rate",
  "pause_date", "collections_date", "account_manager", "team_lead", "sender",
] as const;

/** The conditions a template may branch on. */
export const CONDITIONS = ["autopay", "pay_link", "rate"] as const;

function addDays(iso: string | null, days: number): string {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + days);
  return longDate.format(d);
}

function onDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? "" : longDate.format(d);
}

function values(f: Figures): Record<string, string> {
  return {
    client: f.client_name,
    contact: f.contact_first_name ?? "there",
    invoice_no: f.invoice_no,
    amount: money.format(f.invoice_balance ?? 0),
    account_total: money.format(f.account_total ?? f.invoice_balance ?? 0),
    due_date: onDate(f.due_date),
    // Always the plain count of days late; a template that reaches for it is
    // past due by construction, and "-3 days past due" reads as a bug.
    days: String(Math.max(0, f.age_days)),
    terms: f.payment_terms ?? "as agreed",
    pay_link: f.pay_link ?? "",
    rate: f.interest_rate ?? "the agreed rate",
    pause_date: addDays(f.due_date, 31),
    collections_date: addDays(f.due_date, 61),
    account_manager: f.account_manager ?? "your account manager",
    team_lead: f.team_lead ?? "your team lead",
    sender: f.sender_name,
  };
}

function conditions(f: Figures): Record<string, boolean> {
  return {
    autopay: f.autopay,
    pay_link: Boolean(f.pay_link),
    rate: Boolean(f.interest_rate),
  };
}

/**
 * Resolve `{{#name}}…{{/name}}` and its negation `{{^name}}…{{/name}}`.
 *
 * Unknown names are treated as false rather than left in place: a section
 * whose condition we cannot evaluate is a sentence we cannot vouch for, and
 * dropping it is safer than mailing a client something conditional on a
 * fact nobody checked. Sections do not nest.
 */
function sections(template: string, flags: Record<string, boolean>): string {
  return template.replace(
    /\{\{([#^])\s*(\w+)\s*\}\}([\s\S]*?)\{\{\/\s*\2\s*\}\}/g,
    (_whole, kind: string, name: string, inner: string) => {
      const on = flags[name] === true;
      return (kind === "#" ? on : !on) ? inner : "";
    }
  );
}

/**
 * An unknown placeholder is left exactly as written rather than blanked. A
 * typo should look like a typo in the preview, not silently swallow a line.
 */
function apply(template: string, table: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, name: string) =>
    name in table ? table[name] : whole
  );
}

/** Collapse the blank lines a dropped section leaves behind. */
function tidy(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

export function fill(template: string, figures: Figures): string {
  const withSections = sections(htmlToText(template), conditions(figures));
  return tidy(apply(withSections, values(figures)));
}

/**
 * The same rung as HTML.
 *
 * Markup comes out of the template first and the figures go in after, so a
 * client called "Smith & Sons" cannot put a stray entity through the middle of
 * the message. The template is trusted -- we wrote it -- and the figures are
 * not, so only the figures are escaped.
 */
export function fillHtml(template: string, figures: Figures): string {
  const table = values(figures);
  const safe = Object.fromEntries(
    Object.entries(table).map(([k, v]) => [k, escapeValue(v).replace(/\n/g, "<br>")])
  );
  const markup = isHtml(template) ? template : textToHtml(template);
  return wrapHtml(apply(sections(markup, conditions(figures)), safe));
}
