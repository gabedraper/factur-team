import Link from "next/link";
import { LoadFailed } from "@/components/list/EmptyState";
import { Surface } from "@/components/ui/surface";
import { runSpec } from "@/lib/reporting/data";
import type { SavedReport, Tile } from "@/lib/reporting/spec";
import { ReportChart } from "./ReportChart";
import { ResultTable } from "./ResultTable";

/**
 * One tile: a saved report, run now, drawn as its chart or as its first
 * rows. A server component, so a dashboard of eight tiles is eight
 * queries in parallel and one page -- nothing loads after the fact.
 */
export async function DashboardTile({ tile, report }: { tile: Tile; report: SavedReport | null }) {
  const title = tile.title || report?.name || "Report";
  if (!report) {
    return (
      <Surface title={title} pad="tight">
        <p className="text-meta text-muted-foreground">
          This report isn&apos;t available to you, or it has been deleted.
        </p>
      </Surface>
    );
  }

  let body: React.ReactNode;
  try {
    const result = await runSpec({ ...report.spec, limit: Math.min(report.spec.limit, 500) });
    if (result.rows.length === 0) {
      body = <p className="py-6 text-center text-meta text-muted-foreground">Nothing to show.</p>;
    } else if (report.chart) {
      body = <ReportChart chart={report.chart} result={result} height={tile.width === "full" ? 320 : 240} />;
    } else {
      body = <ResultTable result={result} maxRows={tile.width === "full" ? 12 : 8} />;
    }
  } catch (e) {
    body = <LoadFailed noun="rows" detail={e instanceof Error ? e.message : undefined} />;
  }

  return (
    <Surface
      title={title}
      pad="tight"
      actions={
        <Link href={`/reports/r/${report.id}`} className="text-meta text-muted-foreground hover:text-foreground">
          Open
        </Link>
      }
    >
      {body}
    </Surface>
  );
}
