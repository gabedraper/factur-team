import { getClientResults, type ClientResult } from "@/lib/clients/results";
import { LIVE_CLIENT_STATUSES } from "@/lib/list-views/catalogue";
import type { Report } from "../types";

type Row = ClientResult & { domain: string | null };

const nf = new Intl.NumberFormat("en-US");
const money = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 0,
});
const STATUSES = [...LIVE_CLIENT_STATUSES, "Inactive"];

/** "https://www.acme.com/about" -> "www.acme.com", which is what the logo wants. */
function domainOf(website: string | null): string | null {
  if (!website) return null;
  return website.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").trim() || null;
}

/**
 * What every client was delivered, live or long gone, from
 * client_results_summary. This is the historical record -- its own grant --
 * so a BDM can compare a prospect to the clients who looked like them.
 */
export const clientResults: Report<Row> = {
  key: "client-results",
  label: "Client results",
  description: "Leads, appointments, quotes and purchase orders delivered to every client, over their whole time with us.",
  group: "Clients",
  noun: "clients",
  permissions: ["clients.results"],
  params: [
    { key: "status", label: "Status", type: "picklist", options: STATUSES.map((s) => ({ value: s, label: s })) },
    { key: "service", label: "Service", type: "text", placeholder: "Any service name" },
  ],
  search: (r) => `${r.name} ${r.industry ?? ""} ${r.businessType ?? ""}`,
  columns: [
    {
      key: "client", label: "Client", type: "identity", read: (r) => r.name,
      domain: (r) => r.domain, sub: (r) => r.primaryService, href: (r) => `/clients/results/${r.id}`,
    },
    { key: "status", label: "Status", type: "text", read: (r) => r.status, muted: true },
    { key: "since", label: "Client since", type: "date", read: (r) => r.clientSince },
    { key: "months", label: "Months", type: "number", read: (r) => r.monthsElapsed },
    { key: "leads", label: "Leads", type: "number", read: (r) => r.leads, total: "sum" },
    { key: "appointments", label: "Appointments", type: "number", read: (r) => r.appointments, total: "sum" },
    { key: "quotes", label: "Quotes", type: "number", read: (r) => r.quotes, total: "sum" },
    { key: "pos", label: "POs", type: "number", read: (r) => r.pos, total: "sum" },
    { key: "po_amount", label: "PO value", type: "money", read: (r) => r.poAmount, total: "sum" },
    { key: "quote_amount", label: "Quote value", type: "money", read: (r) => r.quoteAmount, total: "sum" },
    { key: "leads_per_month", label: "Leads / month", type: "number", read: (r) => r.leadsPerMonth },
  ],
  rowKey: (r) => r.id,
  defaultSort: { key: "leads", dir: "desc" },
  run: async () =>
    (await getClientResults()).map((c) => ({ ...c, domain: domainOf(c.website) })),
  filter: (r, v) => {
    if (v.status && r.status !== v.status) return false;
    if (v.service) {
      const q = v.service.toLowerCase();
      const offered = [r.primaryService ?? "", ...r.services, ...r.servicesDelivered];
      if (!offered.some((s) => s.toLowerCase().includes(q))) return false;
    }
    return true;
  },
  stats: (rows) => [
    { label: "Clients", value: nf.format(rows.length) },
    { label: "Leads", value: nf.format(rows.reduce((s, r) => s + r.leads, 0)) },
    { label: "Purchase orders", value: nf.format(rows.reduce((s, r) => s + r.pos, 0)) },
    { label: "PO value", value: money.format(rows.reduce((s, r) => s + r.poAmount, 0)) },
  ],
};
