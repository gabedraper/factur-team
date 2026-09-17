import Link from "next/link";
import { Surface } from "@/components/ui/surface";
import { Table, TableScroll, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Chip } from "@/components/pipeline/bits";
import { control } from "@/components/ui/control";
import { salesforceRecordUrl } from "@/lib/salesforce/client";
import type { CommerceKind, CommerceRow } from "@/lib/commerce/browse";

/*
 * The quotes or orders table, with its search and paging in the URL, so a
 * filtered list survives a reload and pastes into Slack as the thing you were
 * looking at. Server-rendered: the rows come in with the page.
 */

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function when(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" });
}

/* One word the reader can colour by. */
function tone(status: string | null, internal: string | null): "emerald" | "amber" | "rose" | "slate" | "sky" {
  if (internal === "Paid" || status === "PO Won" || status === "Accepted" || status === "Approved") return "emerald";
  if (status === "Rejected" || status === "Denied" || internal === "Denied") return "rose";
  if (status === "Presented" || status === "In Review" || status === "RFQ Completed") return "sky";
  if (status === "Draft") return "slate";
  return "amber";
}

export function CommerceBrowser({
  kind, rows, hasMore, page, basePath, params, statuses, clientName,
}: {
  kind: CommerceKind;
  rows: CommerceRow[];
  hasMore: boolean;
  page: number;
  basePath: string;
  /** The current query, so paging and the form keep it. */
  params: { q?: string; client?: string; status?: string };
  statuses: string[];
  clientName?: string | null;
}) {
  const href = (patch: Partial<Record<"q" | "client" | "status" | "page", string | null>>) => {
    const next = new URLSearchParams();
    const merged: Record<string, string | null | undefined> = { ...params, page: page ? String(page) : null, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) next.set(k, v);
    const s = next.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  const noun = kind === "quotes" ? "quotes" : "purchase orders";

  return (
    <div className="space-y-3">
      <form action={basePath} className="flex flex-wrap items-center gap-2">
        {params.client && <input type="hidden" name="client" value={params.client} />}
        <input
          name="q"
          defaultValue={params.q ?? ""}
          placeholder={kind === "quotes" ? "Search by name or quote number" : "Search by name or order number"}
          aria-label={`Search ${noun}`}
          className={control({ size: "sm", className: "min-w-64" })}
        />
        <select name="status" defaultValue={params.status ?? ""} aria-label="Status" className={control({ size: "sm" })}>
          <option value="">Any status</option>
          {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button type="submit" className={control({ size: "sm", className: "bg-card hover:bg-card-hover" })}>Search</button>
        {clientName && (
          <span className="text-meta text-muted-foreground">
            {clientName} · <Link href={href({ client: null, page: null })} className="underline-offset-2 hover:underline">all clients</Link>
          </span>
        )}
      </form>

      {rows.length === 0 ? (
        <Surface>
          <p className="py-6 text-center text-body text-muted-foreground">
            {params.q || params.status ? `No ${noun} match.` : `No ${noun} yet.`}
          </p>
        </Surface>
      ) : (
        <Surface pad="none">
          <TableScroll>
            <Table>
              <THead>
                <TR>
                  <TH>#</TH>
                  <TH>{kind === "quotes" ? "Quote" : "Order"}</TH>
                  <TH>Client</TH>
                  <TH>Company</TH>
                  {kind === "orders" && <TH>Service</TH>}
                  <TH>Status</TH>
                  <TH numeric>Amount</TH>
                  <TH>{kind === "quotes" ? "Created" : "PO date"}</TH>
                  <TH>{kind === "quotes" ? "Expires" : "Paid"}</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((r) => (
                  <TR key={r.id}>
                    <TD className="whitespace-nowrap tabular-nums">
                      <a href={salesforceRecordUrl(r.salesforce_id)} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline" title="Open in Salesforce">
                        {r.number ?? "—"}
                      </a>
                    </TD>
                    <TD className="max-w-[24rem]">
                      {r.opportunity_id ? (
                        <Link href={`/opportunities/${r.opportunity_id}`} className="block truncate underline-offset-2 hover:underline">
                          {r.name ?? r.opportunity_name ?? "—"}
                        </Link>
                      ) : (
                        <span className="block truncate">{r.name ?? "—"}</span>
                      )}
                    </TD>
                    <TD className="max-w-[14rem]">
                      {r.client_id ? (
                        <Link href={`/clients/${r.client_id}`} className="block truncate underline-offset-2 hover:underline">{r.client_name ?? "—"}</Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TD>
                    <TD className="max-w-[14rem]"><span className="block truncate text-muted-foreground">{r.account_name ?? "—"}</span></TD>
                    {kind === "orders" && (
                      <TD className="whitespace-nowrap text-muted-foreground">
                        {[r.service, r.po_count && `${r.po_count} PO`].filter(Boolean).join(" · ")}
                      </TD>
                    )}
                    <TD>
                      {r.status && <Chip colour={tone(r.status, r.internal_status)}>{r.internal_status === "Paid" ? "Paid" : r.status}</Chip>}
                    </TD>
                    <TD numeric>{r.amount ? money.format(r.amount) : ""}</TD>
                    <TD className="whitespace-nowrap tabular-nums text-muted-foreground">{when(r.on)}</TD>
                    <TD className="whitespace-nowrap tabular-nums text-muted-foreground">
                      {when(kind === "quotes" ? r.expires_on : r.paid_on)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableScroll>
        </Surface>
      )}

      {(hasMore || page > 0) && (
        <nav aria-label="Pages" className="flex items-center justify-end gap-3 text-body">
          {page > 0 && <Link href={href({ page: page === 1 ? null : String(page - 1) })} className="text-primary hover:underline">Previous</Link>}
          {hasMore && <Link href={href({ page: String(page + 1) })} className="text-primary hover:underline">Next</Link>}
        </nav>
      )}
    </div>
  );
}
