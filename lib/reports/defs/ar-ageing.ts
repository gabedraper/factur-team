import { clientDomains } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import type { Report } from "../types";

type Row = {
  clientId: string;
  name: string;
  customer: string | null;
  domain: string | null;
  current: number;
  b1_30: number;
  b31_60: number;
  b61_90: number;
  b91_plus: number;
  total: number;
  overdue60: number;
};

type ViewRow = {
  client_id: string; client_name: string; quickbooks_customer: string | null;
  bucket_current: number | string | null; bucket_1_30: number | string | null;
  bucket_31_60: number | string | null; bucket_61_90: number | string | null;
  bucket_91_plus: number | string | null; total: number | string | null;
  overdue_60_plus: number | string | null;
};

const nf = new Intl.NumberFormat("en-US");
const money = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 0,
});

/**
 * QuickBooks' A/R ageing, per client, from the client_ar view -- the same
 * buckets the collections board works from. Only clients QuickBooks and the
 * client list agree on appear here; an unmatched customer is a Settings →
 * QuickBooks problem, not a row with a blank name.
 */
export const arAgeing: Report<Row> = {
  key: "ar-ageing",
  label: "Receivables ageing",
  description: "What each client owes, by how long it has been owed.",
  group: "Finance",
  noun: "clients",
  permissions: ["finance.collections", "clients.health"],
  params: [
    {
      key: "overdue",
      label: "Show",
      type: "picklist",
      any: "Everyone with a balance",
      options: [
        { value: "any", label: "Anything past due" },
        { value: "60", label: "Past due 60+ days" },
      ],
    },
  ],
  search: (r) => `${r.name} ${r.customer ?? ""}`,
  columns: [
    {
      key: "client", label: "Client", type: "identity", read: (r) => r.name,
      domain: (r) => r.domain, href: (r) => `/clients/${r.clientId}`,
      // The QuickBooks name, when it is not simply the client's.
      sub: (r) => (r.customer && r.customer !== r.name ? r.customer : null),
    },
    { key: "current", label: "Current", type: "money", read: (r) => r.current, total: "sum" },
    { key: "b1_30", label: "1–30", type: "money", read: (r) => r.b1_30, total: "sum" },
    { key: "b31_60", label: "31–60", type: "money", read: (r) => r.b31_60, total: "sum" },
    { key: "b61_90", label: "61–90", type: "money", read: (r) => r.b61_90, total: "sum" },
    { key: "b91_plus", label: "91+", type: "money", read: (r) => r.b91_plus, total: "sum" },
    { key: "total", label: "Total", type: "money", read: (r) => r.total, total: "sum" },
    { key: "overdue60", label: "Overdue 60+", type: "money", read: (r) => r.overdue60, total: "sum" },
  ],
  rowKey: (r) => r.clientId,
  defaultSort: { key: "total", dir: "desc" },
  run: async () => {
    // The session client. The view is security_invoker and sits on a
    // Factur-only staging table, so it answers as whoever asked.
    const db = await createClient();
    const [{ data, error }, domains] = await Promise.all([
      db.from("client_ar").select("*"),
      clientDomains(),
    ]);
    if (error) throw new Error(`Receivables query failed: ${error.message}`);
    const n = (v: number | string | null) => Number(v ?? 0);
    return ((data ?? []) as ViewRow[]).map((r) => ({
      clientId: r.client_id,
      name: r.client_name,
      customer: r.quickbooks_customer,
      domain: domains[r.client_id] ?? null,
      current: n(r.bucket_current),
      b1_30: n(r.bucket_1_30),
      b31_60: n(r.bucket_31_60),
      b61_90: n(r.bucket_61_90),
      b91_plus: n(r.bucket_91_plus),
      total: n(r.total),
      overdue60: n(r.overdue_60_plus),
    }));
  },
  filter: (r, v) => {
    if (v.overdue === "60") return r.overdue60 > 0;
    if (v.overdue === "any") return r.total - r.current > 0;
    return r.total !== 0;
  },
  stats: (rows) => [
    { label: "Clients", value: nf.format(rows.length) },
    { label: "Outstanding", value: money.format(rows.reduce((s, r) => s + r.total, 0)) },
    { label: "Past due", value: money.format(rows.reduce((s, r) => s + (r.total - r.current), 0)) },
    { label: "Overdue 60+", value: money.format(rows.reduce((s, r) => s + r.overdue60, 0)) },
  ],
};
