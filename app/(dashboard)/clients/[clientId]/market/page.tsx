import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { myPermissions } from "@/lib/org";
import { NoAccess } from "@/components/no-access";
import { Chip } from "@/components/pipeline/bits";
import { MarketReportView } from "@/components/clients/MarketReport";
import { getMarketReport } from "@/lib/market/report";

export const dynamic = "force-dynamic";

const asOf = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

/**
 * How big this client's market is, how much of it we hold, and which way the
 * sector is moving.
 *
 * Everything here is precomputed -- client_market_coverage and
 * naics_indicators are both built by scheduled rebuilds, so the page is a
 * handful of indexed reads rather than a join across half a million prospect
 * records.
 */
export default async function ClientMarketPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const perms = await myPermissions();
  if (!perms.has("clients.health") && !perms.has("org.manage")) {
    return <NoAccess section="Client health" need="View client health" />;
  }

  const { clientId } = await params;
  const report = await getMarketReport(clientId);
  if (!report) notFound();

  return (
    <div className="space-y-4 p-6">
      <Link
        href={`/clients/${clientId}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        {report.client.name}
      </Link>

      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-heading text-xl font-semibold">Market</h1>
        <Chip colour="slate">Census {report.vintage}</Chip>
        {report.computedAt && (
          <span className="text-xs text-muted-foreground">
            {asOf.format(new Date(report.computedAt))}
          </span>
        )}
      </div>

      {report.markets.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No mapped markets for this client.
        </p>
      ) : (
        <MarketReportView report={report} />
      )}
    </div>
  );
}
