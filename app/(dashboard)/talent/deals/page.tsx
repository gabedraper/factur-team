import { requireTalent } from "@/lib/talent/access";
import { listDeals } from "@/lib/talent/queries";
import { DealsBoard } from "@/components/talent/DealsBoard";
import { PageHeader, Stat } from "@/components/talent/bits";
import { money } from "@/lib/talent/format";

export const dynamic = "force-dynamic";

/**
 * The business-development pipeline: the work of winning a search, kept beside
 * the searches themselves because it is the same relationship.
 */
export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const access = await requireTalent("view");
  const params = await searchParams;
  const deals = (await listDeals({ status: params.status ?? "all" })) as never[];

  const rows = deals as unknown as { value: number | null; status: string; probability: number | null }[];
  const open = rows.filter((d) => d.status === "open");
  const weighted = open.reduce((s, d) => s + ((d.value ?? 0) * (d.probability ?? 0)) / 100, 0);

  return (
    <div className="space-y-4 p-6">
      <PageHeader title="Deals" count={rows.length} />

      <div className="grid grid-cols-2 gap-4 rounded-lg border bg-card px-4 py-3 sm:grid-cols-4">
        <Stat label="Open" value={open.length} />
        <Stat label="Open value" value={money(open.reduce((s, d) => s + (d.value ?? 0), 0))} />
        <Stat label="Weighted" value={money(Math.round(weighted))} />
        <Stat label="Won" value={rows.filter((d) => d.status === "won").length} />
      </div>

      <DealsBoard deals={deals} canEdit={access.recruit} />
    </div>
  );
}
