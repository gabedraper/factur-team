import { createClient } from "@/lib/supabase/server";

/*
 * Browsing quotes and purchase orders, for the Data section and the client
 * record. Both read the app tables the sync fills (opp_quotes, opp_orders) with
 * the client, company and opportunity embedded, newest first, a page at a
 * time. Row level security decides what each person sees: the same rule as
 * the opportunity they hang off.
 */

export const PAGE = 50;

export type CommerceKind = "quotes" | "orders";

export type CommerceRow = {
  id: string;
  number: string | null;
  name: string | null;
  status: string | null;
  internal_status: string | null;
  amount: number | null;
  /** The date a person means by "when": PO date for an order, created for a quote. */
  on: string | null;
  expires_on: string | null;
  paid_on: string | null;
  service: string | null;
  po_count: string | null;
  salesforce_id: string;
  client_id: string | null;
  client_name: string | null;
  account_name: string | null;
  opportunity_id: string | null;
  opportunity_name: string | null;
};

export type CommerceQuery = {
  kind: CommerceKind;
  q?: string;
  clientId?: string | null;
  /** Narrow to these clients -- how "account manager" and "team lead" are
      answered, since who covers a client is worked out in the directory. An
      empty list means nothing matches, never "everything". */
  clientIds?: string[] | null;
  status?: string | null;
  page?: number;
  limit?: number;
};

type Raw = Record<string, unknown> & {
  org_clients: { name: string } | null;
  crm_accounts: { name: string } | null;
  opportunities: { id: string; name: string | null } | null;
};

const QUOTE_SELECT =
  "id,salesforce_quote_id,quote_number,name,status,internal_status,amount,expires_on,paid_on,salesforce_created_at,client_id," +
  "org_clients(name),crm_accounts(name),opportunities(id,name)";
const ORDER_SELECT =
  "id,salesforce_order_id,order_number,name,status,internal_status,service,po_count,amount,po_date,effective_on,paid_on,salesforce_created_at,client_id," +
  "org_clients(name),crm_accounts(name),opportunities(id,name)";

function shape(kind: CommerceKind, r: Raw): CommerceRow {
  const s = (k: string) => (r[k] == null ? null : String(r[k]));
  return {
    id: String(r.id),
    number: s(kind === "quotes" ? "quote_number" : "order_number"),
    name: s("name"),
    status: s("status"),
    internal_status: s("internal_status"),
    amount: r.amount == null ? null : Number(r.amount),
    on: kind === "quotes"
      ? s("salesforce_created_at")
      : s("po_date") ?? s("effective_on") ?? s("salesforce_created_at"),
    expires_on: s("expires_on"),
    paid_on: s("paid_on"),
    service: s("service"),
    po_count: s("po_count"),
    salesforce_id: String(r[kind === "quotes" ? "salesforce_quote_id" : "salesforce_order_id"]),
    client_id: s("client_id"),
    client_name: r.org_clients?.name ?? null,
    account_name: r.crm_accounts?.name ?? null,
    opportunity_id: r.opportunities?.id ?? null,
    opportunity_name: r.opportunities?.name ?? null,
  };
}

/**
 * One page. Fetches one row past the page so "more" needs no count -- a count
 * over thirty thousand quotes costs more than the page it would label.
 */
export async function browseCommerce(input: CommerceQuery): Promise<{ rows: CommerceRow[]; hasMore: boolean }> {
  const db = await createClient();
  const limit = input.limit ?? PAGE;
  const page = Math.max(0, input.page ?? 0);
  const table = input.kind === "quotes" ? "opp_quotes" : "opp_orders";
  const dateCol = input.kind === "quotes" ? "salesforce_created_at" : "salesforce_created_at";

  let q = db
    .from(table)
    .select(input.kind === "quotes" ? QUOTE_SELECT : ORDER_SELECT)
    .order(dateCol, { ascending: false, nullsFirst: false })
    .order("id")
    .range(page * limit, page * limit + limit);

  if (input.clientIds && input.clientIds.length === 0) return { rows: [], hasMore: false };
  if (input.clientIds) q = q.in("client_id", input.clientIds);
  if (input.clientId) q = q.eq("client_id", input.clientId);
  if (input.status) q = q.eq("status", input.status);
  const term = (input.q ?? "").replace(/[%,()]/g, " ").trim();
  if (term) {
    /* The name carries the company and the client; the number is what a
       person pastes from Salesforce. Either matches. */
    const numberCol = input.kind === "quotes" ? "quote_number" : "order_number";
    q = q.or(`name.ilike.%${term}%,${numberCol}.ilike.%${term}%`);
  }

  const { data, error } = await q;
  if (error) throw new Error(`Could not load ${input.kind}: ${error.message}`);
  const raw = (data ?? []) as unknown as Raw[];
  return { rows: raw.slice(0, limit).map((r) => shape(input.kind, r)), hasMore: raw.length > limit };
}

/** The statuses in use, for a filter that only offers real values. */
export async function commerceStatuses(kind: CommerceKind): Promise<string[]> {
  const db = await createClient();
  const { data } = await db.rpc("commerce_statuses", { p_kind: kind });
  return ((data ?? []) as { status: string }[]).map((r) => r.status);
}

