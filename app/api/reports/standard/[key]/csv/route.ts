import { NextResponse } from "next/server";
import { myPermissions } from "@/lib/org";
import { getAuthedUser } from "@/lib/supabase/session";
import { reportByKey } from "@/lib/reports/catalogue";
import { toCsv } from "@/lib/reports/csv";
import { today } from "@/lib/reports/params";
import { mayOpen, runReport } from "@/lib/reports/run";

/**
 * A report as a CSV, with the same filters and sort as the page that linked
 * here. Nothing is stored: the file is only ever true at the moment it is
 * asked for.
 *
 * Gated twice on purpose. The page is inside the signed-in layout, but a
 * route is reachable by anyone who can reach the app, so it has to say who
 * may call it itself -- and a report with no permission of its own still
 * needs a signed-in Factur account.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  const report = reportByKey(key);
  if (!report) return NextResponse.json({ error: "No such report" }, { status: 404 });

  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const perms = await myPermissions();
  if (!mayOpen(report, perms as Set<string>)) {
    return NextResponse.json({ error: "Not permitted" }, { status: 403 });
  }

  const sp = Object.fromEntries(new URL(request.url).searchParams.entries());
  const out = await runReport(report, sp, { limit: Infinity });
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: 500 });

  const filename = `${report.key}-${today()}.csv`.replace(/"/g, "");
  return new NextResponse(toCsv(report, out.rows), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
