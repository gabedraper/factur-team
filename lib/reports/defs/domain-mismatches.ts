import { getDomainMismatches, type DomainMismatch } from "@/lib/pipeline/domain-mismatches";
import type { Report } from "../types";

const nf = new Intl.NumberFormat("en-US");

/**
 * Which prospects have a website that disagrees with their people's email
 * addresses. Usually the website is wrong -- so this names the records to
 * check rather than changing either value, because a company that trades
 * under one name and emails from another has both of them right.
 *
 * Ordered by how many contacts share the email domain: several people writing
 * from one domain is the strongest sign the email side is the real one, and
 * the count beside it -- contacts on the website's own domain -- is the sign
 * that both are.
 */
export const domainMismatches: Report<DomainMismatch> = {
  key: "domain-mismatches",
  label: "Domain mismatches",
  description:
    "Prospects whose website and whose contacts' email addresses point at different companies, over the 5,000 most recently worked pursuits you can see. Free-email domains are ignored.",
  group: "Sales",
  noun: "mismatches",
  permissions: [],
  params: [],
  columns: [
    {
      key: "company", label: "Company", type: "identity", read: (r) => r.accountName,
      /* The logo of the website we hold, which is the point: a mark nobody
         recognises is itself a sign the website is the wrong one. */
      domain: (r) => r.website, sub: (r) => r.clientName,
      href: (r) => `/opportunities/${r.opportunityId}`,
    },
    { key: "website", label: "Website domain", type: "text", read: (r) => r.website },
    { key: "email_domain", label: "Email domain", type: "text", read: (r) => r.emailDomain },
    { key: "on_email", label: "Contacts on email domain", type: "number", read: (r) => r.onEmailDomain },
    { key: "on_website", label: "Contacts on website domain", type: "number", read: (r) => r.onWebsite },
    { key: "example", label: "For example", type: "text", read: (r) => r.email, muted: true },
  ],
  rowKey: (r) => r.key,
  defaultSort: { key: "on_email", dir: "desc" },
  run: () => getDomainMismatches(),
  stats: (rows) => [
    { label: "Mismatches", value: nf.format(rows.length) },
    { label: "Companies", value: nf.format(new Set(rows.map((r) => r.accountId)).size) },
    {
      label: "Nothing on the website's domain",
      value: nf.format(rows.filter((r) => r.onWebsite === 0).length),
    },
  ],
};
