import { NextResponse } from "next/server";
import { getReport, runSpec } from "@/lib/reporting/data";
import { toCsv } from "@/lib/reporting/format";
import { columnLabel } from "@/lib/reporting/spec";
import { getAuthedUser } from "@/lib/supabase/session";

/**
 * A saved report as a file. Row security answers who may read the report
 * row and who may read the data, so a report you cannot see is a 404 here
 * as it is on the page. The limit is raised to the ceiling: the page draws
 * a screen's worth, the file is for all of it.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { id } = await params;
  const report = await getReport(id);
  if (!report) return NextResponse.json({ error: "No such report" }, { status: 404 });

  try {
    const result = await runSpec({ ...report.spec, limit: 5000 });
    const csv = toCsv(result.columns.map((c) => ({ key: c.key, label: columnLabel(c) })), result.rows);
    const filename = `${report.name.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "report"}.csv`;
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "The report did not run." },
      { status: 500 },
    );
  }
}
