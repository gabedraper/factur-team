import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { NoAccess } from "@/components/no-access";
import { ListEmpty, LoadFailed } from "@/components/list/EmptyState";
import { ReportFilters } from "@/components/reports/ReportFilters";
import { ReportTable } from "@/components/reports/ReportTable";
import { StatRow } from "@/components/reports/StatRow";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { myPermissions } from "@/lib/org";
import { needFor, reportByKey } from "@/lib/reports/catalogue";
import { clearHref } from "@/lib/reports/params";
import { MAX_ROWS, mayOpen, runReport } from "@/lib/reports/run";
import type { SearchParams } from "@/lib/reports/params";

export const dynamic = "force-dynamic";

const nf = new Intl.NumberFormat("en-US");

/**
 * The one page every report renders through. It knows nothing about any
 * particular report: the definition supplies the parameters, the columns and
 * the rows, and this arranges them in the shape every list in the app has --
 * header, filters, figures, table, and an empty state that says why.
 */
export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { key } = await params;
  const report = reportByKey(key);
  if (!report) notFound();

  const perms = await myPermissions();
  if (!mayOpen(report, perms as Set<string>)) {
    return <NoAccess section={report.label} need={needFor(report)} />;
  }

  const sp = await searchParams;
  const out = await runReport(report, sp);

  /* The same filters, as a file. The route re-reads the URL, so what downloads
     is what is on screen -- minus the row limit. */
  const csvQuery = new URLSearchParams();
  for (const [k, v] of Object.entries(out.values)) if (v) csvQuery.set(k, v);
  if (out.sort) {
    csvQuery.set("sort", out.sort.key);
    csvQuery.set("dir", out.sort.dir);
  }
  const csvHref = `/api/reports/standard/${report.key}/csv${csvQuery.size ? `?${csvQuery}` : ""}`;

  return (
    <div className="space-y-4 p-section">
      <PageHeader
        eyebrow={<Link href="/reports" className="hover:text-foreground">Reports</Link>}
        title={report.label}
        description={report.description}
        actions={
          <Button asChild variant="outline" size="sm">
            {/* A plain anchor: the response is a file, and the router has no
                business trying to render it. */}
            <a href={csvHref} download>
              <Download className="mr-1.5 h-4 w-4" aria-hidden />
              Download CSV
            </a>
          </Button>
        }
      />

      <ReportFilters
        report={report}
        values={out.values}
        options={out.options}
        active={out.active}
        sort={out.sort}
      />

      {!out.ok ? (
        <LoadFailed noun={report.noun} detail={out.error} />
      ) : out.rows.length === 0 ? (
        <ListEmpty
          noun={report.noun}
          activeFilters={out.active}
          clearHref={clearHref(report.key)}
        />
      ) : (
        <>
          <StatRow stats={out.stats} />
          <ReportTable report={report} rows={out.rows} values={out.values} sort={out.sort} />
          <p className="text-meta text-muted-foreground">
            {out.all > out.rows.length
              ? `Showing the first ${nf.format(MAX_ROWS)} of ${nf.format(out.all)} ${report.noun}. Narrow the filters, or download the CSV for all of them.`
              : `${nf.format(out.all)} ${out.all === 1 ? report.noun.replace(/s$/, "") : report.noun}`}
          </p>
        </>
      )}
    </div>
  );
}
