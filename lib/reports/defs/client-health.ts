import { cache } from "react";
import { band, getClientHealth, type ClientHealth } from "@/lib/clients/health";
import { clientScope } from "@/lib/clients/scope";
import { LIVE_CLIENT_STATUSES } from "@/lib/list-views/catalogue";
import { clientDomains } from "@/lib/org";
import type { Report } from "../types";

type Row = ClientHealth & {
  domain: string | null;
  outstanding: number | null;
  overdue: number | null;
};

const nf = new Intl.NumberFormat("en-US");
const STATUSES = [...LIVE_CLIENT_STATUSES, "Inactive"];

const input = (r: Row, key: string) => r.inputs.find((i) => i.key === key)?.score ?? null;

/* Asked once per request, though both the scope picklist and run() need it. */
const scopeOnce = cache(clientScope);

/**
 * Client Health as a table: the overall score, the five inputs behind it and
 * the receivables, one row per client. The same numbers as /clients/health,
 * from the same function, with the same scope rule -- an account manager
 * sees their own clients, and only someone who leads a team may ask for all.
 */
export const clientHealth: Report<Row> = {
  key: "client-health",
  label: "Client health",
  description: "Every client's health score, the five inputs behind it, and what they owe.",
  group: "Clients",
  noun: "clients",
  permissions: ["clients.health"],
  params: [
    {
      key: "scope",
      label: "Clients",
      type: "picklist",
      // The choice is only offered to someone entitled to make it; everyone
      // else has one option, their own.
      options: async () =>
        (await scopeOnce()).canSeeAll
          ? [{ value: "all", label: "All clients" }, { value: "mine", label: "My clients" }]
          : [{ value: "mine", label: "My clients" }],
      default: "all",
    },
    { key: "status", label: "Status", type: "picklist", options: STATUSES.map((s) => ({ value: s, label: s })) },
    {
      key: "health",
      label: "Health",
      type: "picklist",
      options: [
        { value: "good", label: "Healthy" },
        { value: "warning", label: "At risk" },
        { value: "critical", label: "Critical" },
        { value: "unknown", label: "Not scored" },
      ],
    },
  ],
  search: (r) => `${r.name} ${r.accountManager ?? ""} ${r.teamLead ?? ""}`,
  columns: [
    {
      key: "client", label: "Client", type: "identity", read: (r) => r.name,
      domain: (r) => r.domain, sub: (r) => r.status, href: (r) => `/clients/${r.clientId}`,
    },
    { key: "am", label: "Account manager", type: "text", read: (r) => r.accountManager, muted: true },
    { key: "lead", label: "Team lead", type: "text", read: (r) => r.teamLead, muted: true },
    { key: "overall", label: "Health", type: "number", read: (r) => r.overall },
    { key: "lead_flow", label: "Lead flow", type: "number", read: (r) => input(r, "lead_flow") },
    { key: "activity", label: "AM activity", type: "number", read: (r) => input(r, "activity") },
    { key: "nps", label: "NPS", type: "number", read: (r) => input(r, "nps") },
    { key: "engagement", label: "Client performance", type: "number", read: (r) => input(r, "engagement") },
    { key: "receivables", label: "Receivables", type: "number", read: (r) => input(r, "receivables") },
    { key: "outstanding", label: "A/R outstanding", type: "money", read: (r) => r.outstanding, total: "sum" },
    { key: "overdue", label: "Overdue 60+", type: "money", read: (r) => r.overdue, total: "sum" },
    { key: "stage", label: "Collections stage", type: "text", read: (r) => r.collectionsStage, muted: true },
  ],
  rowKey: (r) => r.clientId,
  // Lowest first: the report exists to find the clients that need attention.
  defaultSort: { key: "overall", dir: "asc" },
  run: async (v) => {
    const [clients, scope, domains] = await Promise.all([
      getClientHealth(), scopeOnce(), clientDomains(),
    ]);
    // Someone the client book never names has nothing to be scoped to, so
    // they see the whole board rather than an empty one -- as on the page.
    const showAll = scope.canSeeAll && v.scope !== "mine";
    const shown = showAll || scope.mine.size === 0
      ? clients
      : clients.filter((c) => scope.mine.has(c.clientId));
    return shown.map((c) => ({
      ...c,
      domain: domains[c.clientId] ?? null,
      outstanding: c.ageing
        ? c.ageing.current + c.ageing.b1_30 + c.ageing.b31_60 + c.ageing.b61_90 + c.ageing.b91_plus
        : null,
      overdue: c.ageing ? c.ageing.b61_90 + c.ageing.b91_plus : null,
    }));
  },
  filter: (r, v) =>
    (!v.status || r.status === v.status) && (!v.health || band(r.overall) === v.health),
  stats: (rows) => [
    { label: "Clients", value: nf.format(rows.length) },
    { label: "Healthy", value: nf.format(rows.filter((r) => band(r.overall) === "good").length) },
    { label: "At risk", value: nf.format(rows.filter((r) => band(r.overall) === "warning").length) },
    { label: "Critical", value: nf.format(rows.filter((r) => band(r.overall) === "critical").length) },
  ],
};
