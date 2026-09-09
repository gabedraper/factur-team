/**
 * Normalizes a phone number to E.164 for the North American numbering
 * plan -- the only destinations any of our voice providers are configured
 * to call. crm_contacts.phone is Salesforce-sourced and wildly
 * inconsistent: parens/dashes instead of E.164, spreadsheet-import ".0"
 * float artifacts ("5096382462.0"), URL-encoded punctuation, extensions,
 * multiple numbers in one field, and outright corrupted "+XXX ..."
 * placeholder entries. Rather than trying to rescue every shape, this
 * strips formatting and accepts only a clean 10 or 11-digit NANP number,
 * returning null for anything else -- a dial widget can then say "this
 * number looks wrong" instead of silently sending garbage to a provider.
 */
export function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (/XXX/i.test(raw)) return null;

  const cleaned = raw.trim().replace(/\.0+$/, "");
  const digits = cleaned.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}
