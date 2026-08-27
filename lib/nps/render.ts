/**
 * Filling a survey template in.
 *
 * Like the collections renderer, and for the same reasons: few placeholders,
 * plain names, and a fallback for each that still reads as English. An email
 * opening "Hi ," because Salesforce holds no first name is worse than one
 * opening "Hi there".
 *
 * The one that matters is {{scale}}. Every other placeholder is a word; this
 * one is the survey itself -- eleven numbers, each a link carrying its own
 * score, which is what makes answering a single click. It renders twice, as a
 * row of buttons for HTML readers and as a legible list for everyone else.
 */

import { escapeValue, htmlToText, isHtml, textToHtml, wrapHtml } from "@/lib/email/richtext";

export type Figures = {
  client_name: string;
  contact_first_name: string | null;
  sender_name: string | null;
  /** Where the survey lives, token and all. */
  url: string;
};

export const PLACEHOLDERS = ["client", "contact", "sender", "scale", "link"] as const;

/** One link per score, so a click both opens the page and carries the answer. */
function scoreUrl(base: string, score: number): string {
  return `${base}${base.includes("?") ? "&" : "?"}score=${score}`;
}

const SCORES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/*
 * Inline styles only, and a table for the layout.
 *
 * Not a stylistic choice: Gmail strips <style> blocks, and Outlook renders mail
 * through Word, which supports neither flexbox nor grid. A table with inline
 * styles is the one layout that survives both.
 */
function scaleHtml(url: string): string {
  const cells = SCORES.map(
    (n) => `<td style="padding:0 3px;">
      <a href="${scoreUrl(url, n)}"
         style="display:inline-block;min-width:26px;padding:9px 6px;border:1px solid #d4d4d8;border-radius:6px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#18181b;text-decoration:none;text-align:center;">${n}</a>
    </td>`
  ).join("");

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0;">
  <tr>${cells}</tr>
  <tr>
    <td colspan="6" style="padding:6px 3px 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#71717a;">Not at all likely</td>
    <td colspan="5" style="padding:6px 3px 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#71717a;text-align:right;">Extremely likely</td>
  </tr>
</table>`;
}

/**
 * The plain-text alternative.
 *
 * Eleven bare URLs would be unreadable, so this offers the page once and lets
 * them pick a number there. The HTML part carries the one-click version; this
 * only has to work.
 */
function scaleText(url: string): string {
  return `0 (not at all likely) to 10 (extremely likely):\n${url}`;
}

function values(f: Figures, scale: string): Record<string, string> {
  return {
    client: f.client_name,
    contact: f.contact_first_name?.trim() || "there",
    sender: f.sender_name?.trim() || "the Factur team",
    scale,
    link: f.url,
  };
}

/**
 * An unknown placeholder is left exactly as written rather than blanked. A typo
 * should look like a typo in the preview, not silently swallow a sentence.
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
 * after. The scale becomes one address rather than eleven, because eleven bare
 * URLs in a row is not something anybody reads.
 */
export function fill(template: string, figures: Figures): string {
  return apply(htmlToText(template), values(figures, scaleText(figures.url)));
}

/**
 * The same invitation as HTML.
 *
 * The template is trusted markup from our own editor and is left alone; the
 * figures are escaped, so a client name containing an ampersand cannot break
 * anything. That is the reverse of what this did when bodies were plain text
 * and the whole template had to be escaped on the way in.
 *
 * The scale is the exception -- it is markup on purpose, so it goes in raw.
 */
export function fillHtml(template: string, figures: Figures): string {
  const source = isHtml(template) ? template : textToHtml(template);

  /*
   * The editor puts {{scale}} in a paragraph, and a <table> inside a <p> is
   * invalid -- browsers and mail clients close the paragraph early and the
   * buttons end up outside the message flow. So a paragraph that holds
   * nothing but the placeholder is replaced by the table rather than filled.
   */
  const lifted = source.replace(
    /<p\b[^>]*>\s*\{\{\s*scale\s*\}\}\s*<\/p>/gi,
    "{{scale}}"
  );

  const table = values(figures, "");
  const safe: Record<string, string> = Object.fromEntries(
    Object.entries(table).map(([k, v]) => [k, escapeValue(v).replace(/\n/g, "<br>")])
  );
  safe.scale = scaleHtml(figures.url);

  return wrapHtml(apply(lifted, safe));
}

/** The survey address for one invitation. */
export function surveyUrl(siteUrl: string, token: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/nps/${token}`;
}
