/**
 * Turning a list of people into something a sequence can send to.
 *
 * Pure, and separate from the server actions, so the CSV parsing and the merge
 * fields can be read and tested without a database. Same split as
 * lib/nps/render.ts and lib/client-contacts.ts.
 */

export type Candidate = {
  email: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  clientId: string | null;
  /** Why this one cannot be sent to, if it cannot. */
  problem: string | null;
};

export const AUDIENCE_SOURCES = [
  { key: "contacts", label: "Contacts in the app" },
  { key: "csv", label: "CSV upload" },
] as const;

export type AudienceSource = (typeof AUDIENCE_SOURCES)[number]["key"];

const EMAIL = /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/;

export function isEmail(value: string): boolean {
  return EMAIL.test(value.trim());
}

/**
 * Read a pasted or uploaded CSV.
 *
 * Deliberately forgiving about the header row: people export from Salesforce,
 * Excel and Google Sheets and the columns are never named the same twice. Any
 * column whose name looks like an email is the address; first name, last name
 * and company are matched just as loosely. A file with no header at all still
 * works if a column holds addresses.
 */
export function parseCsv(text: string): Candidate[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return [];

  const rows = lines.map(splitCsvLine);
  const header = rows[0].map((h) => h.trim().toLowerCase());

  const find = (...names: string[]) =>
    header.findIndex((h) => names.some((n) => h === n || h.replace(/[^a-z]/g, "") === n));

  let iEmail = find("email", "emailaddress", "email1", "workemail", "contactemail");
  let iFirst = find("firstname", "first", "givenname", "fname");
  let iLast = find("lastname", "last", "surname", "familyname", "lname");
  let iCompany = find("company", "account", "accountname", "companyname", "organisation", "organization");

  // No recognisable header: find the column that actually holds addresses and
  // treat every line, including the first, as data.
  let body = rows.slice(1);
  if (iEmail === -1) {
    const sample = rows[0];
    iEmail = sample.findIndex((c) => isEmail(c));
    if (iEmail === -1) return [];
    iFirst = iLast = iCompany = -1;
    body = rows;
  }

  const at = (row: string[], i: number) =>
    i >= 0 && i < row.length ? row[i].trim() || null : null;

  const seen = new Set<string>();
  const out: Candidate[] = [];

  for (const row of body) {
    const email = (at(row, iEmail) ?? "").toLowerCase();
    if (!email) continue;

    // A file that lists somebody twice should enrol them once.
    if (seen.has(email)) continue;
    seen.add(email);

    out.push({
      email,
      firstName: at(row, iFirst),
      lastName: at(row, iLast),
      company: at(row, iCompany),
      clientId: null,
      problem: isEmail(email) ? null : "Not a valid email address",
    });
  }

  return out;
}

/** Quoted fields may contain commas, and "" is an escaped quote. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; } else { quoted = false; }
      } else field += c;
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      out.push(field); field = "";
    } else field += c;
  }
  out.push(field);
  return out;
}

/**
 * Fill a step's wording for one person.
 *
 * The same placeholder rules as the other renderers: a fallback that still
 * reads as English, and an unknown name left exactly as written so a typo looks
 * like a typo rather than swallowing a sentence.
 */
export const PLACEHOLDERS = ["first_name", "last_name", "company", "sender"] as const;

export function fill(
  template: string,
  person: { firstName: string | null; lastName: string | null; company: string | null },
  senderName: string | null
): string {
  const table: Record<string, string> = {
    first_name: person.firstName?.trim() || "there",
    last_name: person.lastName?.trim() || "",
    company: person.company?.trim() || "your team",
    sender: senderName?.trim() || "the Factur team",
  };
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, name: string) =>
    name in table ? table[name] : whole
  );
}
