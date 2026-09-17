import Link from "next/link";
import { Chip } from "@/components/pipeline/bits";
import { salesforceRecordUrl } from "@/lib/salesforce/client";
import type { CommerceRow } from "@/lib/commerce/browse";

/*
 * Quotes and purchase orders on the client record: the last six months as a
 * line, then the most recent handful, orders and quotes together, newest
 * first. The full lists are one click away in Data, already narrowed to this
 * client.
 */

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const nf = new Intl.NumberFormat("en-US");

function when(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" });
}

export type CommerceMonth = { month_start: string; quotes: number; quotes_total: number | null; orders: number; orders_total: number | null };

export function CommercePanel({
  clientId, months, quotes, orders,
}: {
  clientId: string;
  months: CommerceMonth[];
  quotes: CommerceRow[];
  orders: CommerceRow[];
}) {
  const q = months.reduce((a, m) => a + Number(m.quotes), 0);
  const o = months.reduce((a, m) => a + Number(m.orders), 0);
  const oTotal = months.reduce((a, m) => a + Number(m.orders_total ?? 0), 0);

  const lines = [
    ...orders.map((r) => ({ ...r, kind: "PO" as const })),
    ...quotes.map((r) => ({ ...r, kind: "Quote" as const })),
  ].sort((a, b) => (b.on ?? "").localeCompare(a.on ?? "")).slice(0, 8);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-body">
        <span>
          <span className="font-medium tabular-nums">{nf.format(q)}</span>
          <span className="text-muted-foreground"> quotes · </span>
          <span className="font-medium tabular-nums">{nf.format(o)}</span>
          <span className="text-muted-foreground"> POs{oTotal ? ` · ${money.format(oTotal)}` : ""} in 6 months</span>
        </span>
        <span className="flex gap-3 text-meta">
          <Link href={`/data/quotes?client=${clientId}`} className="text-primary underline-offset-2 hover:underline">All quotes</Link>
          <Link href={`/data/orders?client=${clientId}`} className="text-primary underline-offset-2 hover:underline">All POs</Link>
        </span>
      </div>

      {lines.length === 0 ? (
        <p className="py-3 text-center text-body text-muted-foreground">No quotes or purchase orders.</p>
      ) : (
        <ul className="divide-y">
          {lines.map((l) => (
            <li key={`${l.kind}-${l.id}`} className="flex items-center gap-2 py-1.5 text-body">
              <span className="w-10 shrink-0 text-meta text-muted-foreground">{l.kind}</span>
              <a href={salesforceRecordUrl(l.salesforce_id)} target="_blank" rel="noreferrer" className="shrink-0 tabular-nums underline-offset-2 hover:underline" title="Open in Salesforce">
                #{l.number ?? "—"}
              </a>
              {l.status && (
                <Chip colour={l.internal_status === "Paid" || l.status === "PO Won" ? "emerald" : l.status === "Draft" ? "slate" : "sky"}>
                  {l.internal_status === "Paid" ? "Paid" : l.status}
                </Chip>
              )}
              <span className="min-w-0 flex-1 truncate text-meta text-muted-foreground">
                {l.opportunity_id ? (
                  <Link href={`/opportunities/${l.opportunity_id}`} className="underline-offset-2 hover:underline">{l.account_name ?? l.name}</Link>
                ) : (l.account_name ?? l.name)}
              </span>
              <span className="shrink-0 tabular-nums">{l.amount ? money.format(l.amount) : ""}</span>
              <span className="w-16 shrink-0 text-right text-meta tabular-nums text-muted-foreground">{when(l.on)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
