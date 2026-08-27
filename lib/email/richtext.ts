/**
 * Turning what somebody typed into the two things an email has to carry.
 *
 * Sequence bodies are written in a rich text editor now, so a template is
 * HTML. A sent message still needs a plain-text alternative beside it -- not
 * for decoration: a multipart email offers both and the reader picks, and
 * anything that strips HTML (some corporate gateways, a watch, a screen
 * reader set to plain) shows the text part or shows nothing.
 *
 * So one template, two renderings, and they have to say the same thing.
 */

/** Text going into markup. Applied to filled-in values, never to a template. */
export function escapeValue(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"',
  "&#39;": "'", "&apos;": "'", "&nbsp;": " ",
};

function decode(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&[a-z]+;|&#39;/gi, (e) => ENTITIES[e.toLowerCase()] ?? e);
}

/**
 * A body a person typed as plain text, as HTML.
 *
 * Only used to bring the templates that predate the editor forward. A blank
 * line was a paragraph break and a single newline was a line break, because
 * that is what they looked like in the textarea they were written in.
 */
export function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeValue(para).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** Whether a stored body has been through the editor yet. */
export function isHtml(body: string): boolean {
  return /<(p|div|ul|ol|li|br|strong|em|h[1-6]|a|img|hr)\b/i.test(body);
}

/**
 * The plain-text alternative.
 *
 * Not tag-stripping: a list with the <li>s removed runs into one paragraph and
 * a link loses the address it was pointing at. Blocks become blank lines,
 * bullets stay bullets, numbers stay numbered, and a link keeps its target in
 * brackets after the words -- so the text part reads like the message rather
 * than like the wreckage of one.
 */
export function htmlToText(html: string): string {
  let s = html;

  // Anything invisible in a mail client should be invisible here too.
  s = s.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");

  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<hr\s*\/?>/gi, "\n---\n");

  // Numbered lists have to be counted before the tags go, or every line is "1.".
  s = s.replace(/<ol\b[^>]*>([\s\S]*?)<\/ol>/gi, (_, inner: string) => {
    let n = 0;
    const items = inner.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (__, item: string) => {
      n += 1;
      return `\n${n}. ${item.trim()}`;
    });
    return `\n${items}\n\n`;
  });
  s = s.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, item: string) => `\n- ${item.trim()}`);

  // The words are what someone reads; the address is what they need to act.
  s = s.replace(
    /<a\b[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_, href: string, label: string) => {
      const words = label.replace(/<[^>]+>/g, "").trim();
      return !words || words === href ? href : `${words} (${href})`;
    }
  );

  s = s.replace(/<img\b[^>]*alt=["']([^"']+)["'][^>]*>/gi, "[image: $1]");
  s = s.replace(/<img\b[^>]*>/gi, "[image]");

  s = s.replace(/<\/(p|div|h[1-6]|ul|ol|blockquote|tr)>/gi, "\n\n");
  s = s.replace(/<[^>]+>/g, "");
  s = decode(s);

  return s
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The wrapper the body is sent inside.
 *
 * Inline styles and nothing clever, for the same reason the NPS scale is a
 * table: Gmail drops <style> blocks and Outlook renders through Word. A
 * declared font here is the only one that survives the trip.
 */
export function wrapHtml(inner: string): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#18181b;">
${inner}
</div>`;
}
