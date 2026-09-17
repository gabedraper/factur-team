import { createClient } from "@/lib/supabase/server";

/*
 * Prospects where the website we hold and the domain their people write from
 * disagree.
 *
 * A wrong website means the wrong company gets researched before a call, and
 * until now there was no way to see which records were affected -- the two
 * values sit on two tables and nothing ever compared them.
 *
 * Nothing here decides which side is right, deliberately. Usually the website
 * is wrong, but a company that trades under one name and emails from another
 * has both right, so the two counts are returned and the judgement is left to
 * a person. crm_accounts is a one-way Salesforce sync anyway (see
 * lib/integrations/catalogue.ts), so the correction belongs in Salesforce; the
 * app's job is to say which records to look at.
 *
 * The row is one company and one email domain, not one pursuit. A company
 * whose people are on two foreign domains is two things to look at; the same
 * wrong website reached through four pursuits is one.
 */

/* The API returns at most 1,000 rows a request, so this is five of them. A
   cap rather than everyRow(): 779,809 pursuits is 780 round trips for a
   question about the ones being worked, and ordering by updated_at means the
   cap falls on the dormant end of the pipeline. RLS decides whose. */
const PAGE = 1000;
const CHECKED = 5000;

export type DomainMismatch = {
  /** account and email domain -- the pair being judged. */
  key: string;
  accountId: string;
  accountName: string;
  /** The domain on the company record. */
  website: string;
  /** The domain its people actually write from. */
  emailDomain: string;
  /** Contacts at this company on the email domain, and on the website's. */
  onEmailDomain: number;
  onWebsite: number;
  /** One address on the email domain, so the pair can be judged from the row. */
  email: string;
  clientName: string | null;
  /** The most recently worked pursuit on that domain: both values on one page. */
  opportunityId: string;
};

type Row = {
  id: string;
  contact_id: string;
  account_id: string;
  org_clients: { name: string } | null;
  crm_accounts: { name: string; domain: string | null } | null;
  crm_contacts: { first_name: string | null; last_name: string | null; email: string | null } | null;
};

/**
 * A bare host: no scheme, no path, no port, no "www.". Takes a website or an
 * email address, because the two fields are written by hand and arrive as
 * both -- "https://acme.com/contact" and "sales@acme.com" are one domain.
 */
export function hostOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const host = value
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/^.*@/, "")
    .replace(/:\d+$/, "")
    .replace(/^www\./, "");
  // No dot in the host is a typo, not a domain -- same test as lib/clients/enrich.ts.
  return host.includes(".") ? host : null;
}

/* mail.acme.com and acme.com are the same company, and reporting that pair
   would bury the real ones. acme.co.uk and acme.com are not. */
function sameSite(a: string, b: string): boolean {
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

export async function getDomainMismatches(): Promise<DomainMismatch[]> {
  const db = await createClient();

  /* The list Salesforce's own domain fill already skips, rather than a second
     copy of it here -- a logo for gmail.com is worse than initials, and a
     mismatch against gmail.com is noise for the same reason. */
  const { data: freemail, error: freemailError } = await db.rpc("freemail_domains");
  if (freemailError) throw new Error(`free-email domains: ${freemailError.message}`);
  const free = new Set((freemail ?? []) as string[]);

  const rows: Row[] = [];
  for (let from = 0; from < CHECKED; from += PAGE) {
    const { data, error } = await db
      .from("opportunities")
      .select(
        "id,contact_id,account_id,org_clients!inner(name)," +
        "crm_accounts!inner(name,domain),crm_contacts!inner(first_name,last_name,email)"
      )
      /* Both halves have to exist for there to be anything to compare, and
         filtering an embed's column needs the !inner above it. */
      .not("crm_accounts.domain", "is", null)
      .not("crm_contacts.email", "is", null)
      /* id breaks the tie: the sync touches updated_at every three minutes and
         an unstable order repeats or drops rows between pages. */
      .order("updated_at", { ascending: false })
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as unknown as Row[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }

  type Pair = {
    contacts: Set<string>;
    email: string;
    clientName: string | null;
    opportunityId: string;
  };
  type Site = {
    name: string;
    website: string;
    /** Contact ids, because one contact is pursued once per client. */
    onWebsite: Set<string>;
    pairs: Map<string, Pair>;
  };
  const sites = new Map<string, Site>();

  for (const r of rows) {
    const website = hostOf(r.crm_accounts?.domain);
    const email = hostOf(r.crm_contacts?.email);
    if (!website || !email || free.has(email)) continue;

    let site = sites.get(r.account_id);
    if (!site) {
      site = { name: r.crm_accounts?.name ?? "", website, onWebsite: new Set(), pairs: new Map() };
      sites.set(r.account_id, site);
    }

    if (sameSite(email, site.website)) {
      site.onWebsite.add(r.contact_id);
      continue;
    }

    let pair = site.pairs.get(email);
    if (!pair) {
      // The first row is the most recently worked one, so that is the pursuit
      // worth opening and the address worth showing.
      pair = {
        contacts: new Set(),
        email: r.crm_contacts?.email ?? "",
        clientName: r.org_clients?.name ?? null,
        opportunityId: r.id,
      };
      site.pairs.set(email, pair);
    }
    pair.contacts.add(r.contact_id);
  }

  const out: DomainMismatch[] = [];
  for (const [accountId, site] of sites) {
    for (const [emailDomain, pair] of site.pairs) {
      out.push({
        key: `${accountId}:${emailDomain}`,
        accountId,
        accountName: site.name,
        website: site.website,
        emailDomain,
        onEmailDomain: pair.contacts.size,
        onWebsite: site.onWebsite.size,
        email: pair.email,
        clientName: pair.clientName,
        opportunityId: pair.opportunityId,
      });
    }
  }
  return out;
}
