import { Panel, Empty, Chip } from "@/components/pipeline/bits";
import { salesforceRecordUrl } from "@/lib/salesforce/client";

/*
 * The quotes and purchase orders on an opportunity, as Salesforce holds them.
 *
 * Read-only: both come from Salesforce every three minutes and nothing here
 * writes back. One list, newest first, orders and quotes together -- a quote
 * that became an order is the same story, and splitting it into two panels
 * made the reader join them by date.
 */

export type QuoteRow = {
  id: string; salesforce_quote_id: string; quote_number: string | null; name: string | null;
  status: string | null; internal_status: string | null; amount: number | null;
  expires_on: string | null; paid_on: string | null; salesforce_created_at: string | null;
};
export type OrderRow = {
  id: string; salesforce_order_id: string; order_number: string | null; name: string | null;
  status: string | null; internal_status: string | null; service: string | null; po_count: string | null;
  amount: number | null; po_date: string | null; effective_on: string | null; paid_on: string | null;
  salesforce_created_at: string | null;
};

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function when(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" });
}

/* Where a quote or order is, in one word the reader can colour by. */
function tone(status: string | null, internal: string | null): "emerald" | "amber" | "rose" | "slate" | "sky" {
  if (internal === "Paid" || status === "PO Won" || status === "Accepted" || status === "Approved") return "emerald";
  if (status === "Rejected" || status === "Denied" || internal === "Denied") return "rose";
  if (status === "Presented" || status === "In Review" || status === "RFQ Completed") return "sky";
  if (status === "Draft") return "slate";
  return "amber";
}

export function QuotesAndOrders({ quotes, orders }: { quotes: QuoteRow[]; orders: OrderRow[] }) {
  type Line = {
    key: string; kind: "Order" | "Quote"; number: string | null; url: string;
    status: string | null; internal: string | null; amount: number | null;
    detail: string | null; on: string | null;
  };
  const lines: Line[] = [
    ...orders.map((o): Line => ({
      key: `o-${o.id}`, kind: "Order", number: o.order_number, url: salesforceRecordUrl(o.salesforce_order_id),
      status: o.status, internal: o.internal_status, amount: o.amount,
      detail: [o.service, o.po_count && `${o.po_count} PO`, o.paid_on && `paid ${when(o.paid_on)}`].filter(Boolean).join(" · ") || null,
      on: o.po_date ?? o.effective_on ?? o.salesforce_created_at,
    })),
    ...quotes.map((q): Line => ({
      key: `q-${q.id}`, kind: "Quote", number: q.quote_number, url: salesforceRecordUrl(q.salesforce_quote_id),
      status: q.status, internal: q.internal_status, amount: q.amount,
      detail: [q.expires_on && `expires ${when(q.expires_on)}`, q.paid_on && `paid ${when(q.paid_on)}`].filter(Boolean).join(" · ") || null,
      on: q.salesforce_created_at,
    })),
  ].sort((a, b) => (b.on ?? "").localeCompare(a.on ?? ""));

  const won = orders.reduce((sum, o) => sum + (o.amount ?? 0), 0);

  return (
    <Panel
      title="Quotes & orders"
      action={won > 0 ? <span className="text-meta tabular-nums text-muted-foreground">{money.format(won)} in POs</span> : undefined}
    >
      {lines.length === 0 ? (
        <Empty>No quotes or orders on this opportunity.</Empty>
      ) : (
        <ul className="divide-y">
          {lines.map((l) => (
            <li key={l.key} className="flex items-center gap-3 px-4 py-2 text-body">
              <span className="w-12 shrink-0 text-meta text-muted-foreground">{l.kind}</span>
              <a
                href={l.url}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 tabular-nums underline-offset-2 hover:underline"
                title="Open in Salesforce"
              >
                #{l.number ?? "—"}
              </a>
              {l.status && <Chip colour={tone(l.status, l.internal)}>{l.internal === "Paid" ? "Paid" : l.status}</Chip>}
              <span className="min-w-0 flex-1 truncate text-meta text-muted-foreground">{l.detail}</span>
              <span className="shrink-0 tabular-nums">{l.amount ? money.format(l.amount) : ""}</span>
              <span className="w-20 shrink-0 text-right text-meta tabular-nums text-muted-foreground">{when(l.on)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
