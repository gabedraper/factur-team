import Link from "next/link";
import { requireTalent } from "@/lib/talent/access";
import { listPlacements } from "@/lib/talent/queries";
import { Chip, Empty, PageHeader, Panel, Stat } from "@/components/talent/bits";
import { money, onDay } from "@/lib/talent/format";
import { INVOICE_STATUS, PLACEMENT_STATUS, label } from "@/lib/talent/types";

export const dynamic = "force-dynamic";

const TONE: Record<string, string> = {
  pending: "slate", active: "emerald", completed: "indigo",
  fell_off: "rose", cancelled: "slate",
};

/** Hires, their fees, and whether the guarantee has run out yet. */
export default async function PlacementsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireTalent("view");
  const params = await searchParams;
  const rows = (await listPlacements({ status: params.status })) as (Record<string, unknown> & {
    id: string; status: string; started_on: string | null; guarantee_ends_on: string | null;
    salary: number | null; fee_amount: number | null; fee_percent: number | null;
    invoice_status: string; title: string | null;
    tal_people: { id: string; name: string } | null;
    tal_jobs: { id: string; title: string } | null;
    tal_companies: { id: string; name: string } | null;
  })[];

  const fees = rows.reduce((sum, r) => sum + (r.fee_amount ?? 0), 0);
  const unbilled = rows
    .filter((r) => r.invoice_status === "not_invoiced")
    .reduce((sum, r) => sum + (r.fee_amount ?? 0), 0);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4 p-6">
      <PageHeader title="Placements" count={rows.length} />

      <div className="grid grid-cols-2 gap-4 rounded-lg border bg-card px-4 py-3 sm:grid-cols-4">
        <Stat label="Fees" value={money(fees)} />
        <Stat label="Not invoiced" value={money(unbilled)} tint={unbilled ? "text-amber-600 dark:text-amber-400" : undefined} />
        <Stat label="Active" value={rows.filter((r) => r.status === "active").length} />
        <Stat label="Fell off" value={rows.filter((r) => r.status === "fell_off").length} />
      </div>

      <div className="flex flex-wrap gap-1">
        {[{ key: "", label: "All" }, ...Object.entries(PLACEMENT_STATUS).map(([k, v]) => ({ key: k, label: v }))]
          .map((f) => (
            <Link
              key={f.key || "all"}
              href={f.key ? `/talent/placements?status=${f.key}` : "/talent/placements"}
              className={`rounded-full px-3 py-1 text-xs ${
                (params.status ?? "") === f.key
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {f.label}
            </Link>
          ))}
      </div>

      <Panel>
        {rows.length === 0 ? <Empty>No placements</Empty> : (
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Person</th>
                <th className="px-4 py-2 font-medium">Job</th>
                <th className="px-4 py-2 font-medium">Company</th>
                <th className="px-4 py-2 font-medium">Started</th>
                <th className="px-4 py-2 font-medium">Guarantee</th>
                <th className="px-4 py-2 text-right font-medium">Salary</th>
                <th className="px-4 py-2 text-right font-medium">Fee</th>
                <th className="px-4 py-2 font-medium">Invoice</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => {
                const inGuarantee = r.guarantee_ends_on && r.guarantee_ends_on >= today;
                return (
                  <tr key={r.id} className="hover:bg-accent/40">
                    <td className="px-4 py-2.5">
                      {r.tal_people ? (
                        <Link href={`/talent/people/${r.tal_people.id}`} className="font-medium hover:underline">
                          {r.tal_people.name}
                        </Link>
                      ) : "—"}
                      <div className="mt-0.5">
                        <Chip colour={TONE[r.status]}>{label(PLACEMENT_STATUS, r.status)}</Chip>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {r.tal_jobs ? (
                        <Link href={`/talent/jobs/${r.tal_jobs.id}`} className="hover:underline">
                          {r.tal_jobs.title}
                        </Link>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{r.tal_companies?.name ?? "—"}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{onDay(r.started_on)}</td>
                    <td className={`px-4 py-2.5 ${inGuarantee ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                      {onDay(r.guarantee_ends_on)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                      {money(r.salary)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {money(r.fee_amount)}
                      {r.fee_percent ? (
                        <span className="ml-1 text-xs text-muted-foreground">{r.fee_percent}%</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5">
                      <Chip colour={r.invoice_status === "paid" ? "emerald" : r.invoice_status === "invoiced" ? "sky" : "slate"}>
                        {label(INVOICE_STATUS, r.invoice_status)}
                      </Chip>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
