import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { LoadFailed, NothingYet } from "@/components/list/EmptyState";
import { ReportChart } from "@/components/reporting/ReportChart";
import { ResultTable } from "@/components/reporting/ResultTable";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Surface } from "@/components/ui/surface";
import { currentMemberId, myPermissions } from "@/lib/org";
import { canEdit, getReport, runSpec } from "@/lib/reporting/data";
import type { ReportResult } from "@/lib/reporting/spec";

export const dynamic = "force-dynamic";

const nf = new Intl.NumberFormat("en-US");

/**
 * A saved report, run now. The rows are whatever the data says today, as
 * the person looking; the definition is the only thing that was saved.
 */
export default async function SavedReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [report, memberId, perms] = await Promise.all([getReport(id), currentMemberId(), myPermissions()]);
  if (!report) notFound();

  let result: ReportResult | null = null;
  let error: string | null = null;
  try {
    result = await runSpec(report.spec);
  } catch (e) {
    error = e instanceof Error ? e.message : "The report did not run.";
  }

  const editable = canEdit(report, memberId, perms as Set<string>);
  const summary = report.spec.groups.length > 0 || report.spec.aggregates.length > 0;

  return (
    <div className="space-y-4 p-section">
      <PageHeader
        eyebrow={<Link href="/reports" className="hover:text-foreground">Reports</Link>}
        title={report.name}
        description={report.description ?? `${summary ? "Summary" : "Rows"} of ${report.spec.object}${report.shared ? " · shared with everyone" : ""}`}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <a href={`/api/reports/custom/${report.id}/csv`} download>
                <Download className="mr-1.5 h-4 w-4" aria-hidden />
                Download CSV
              </a>
            </Button>
            <Button asChild size="sm">
              <Link href={`/reports/r/${report.id}/edit`}>{editable ? "Edit report" : "Edit a copy"}</Link>
            </Button>
          </>
        }
      />

      {error ? (
        <LoadFailed noun="rows" detail={error} />
      ) : !result || result.rows.length === 0 ? (
        <NothingYet noun={summary ? "groups" : "rows"} />
      ) : (
        <>
          {report.chart ? (
            <Surface pad="tight">
              <ReportChart chart={report.chart} result={result} />
            </Surface>
          ) : null}
          <p className="text-meta text-muted-foreground">
            {nf.format(result.total)} {summary ? "groups" : "rows"}
            {result.truncated ? ` · showing the first ${nf.format(result.limit)}. Download the CSV for all of them.` : ""}
          </p>
          <ResultTable result={result} sort={report.spec.sort[0] ?? null} />
        </>
      )}
    </div>
  );
}
