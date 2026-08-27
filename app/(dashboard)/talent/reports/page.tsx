import Link from "next/link";
import { requireTalent } from "@/lib/talent/access";
import { activityReport, listJobs, listPlacements, masterPipeline } from "@/lib/talent/queries";
import { Chip, Empty, PageHeader, Panel, Stat } from "@/components/talent/bits";
import { Button } from "@/components/ui/button";
import { money, onDay } from "@/lib/talent/format";
import { STAGE_KIND, label } from "@/lib/talent/types";

export const dynamic = "force-dynamic";

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * The three numbers a recruiting team is run on: what everyone did, where the
 * work is sitting, and what came out the other end.
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requireTalent("view");
  const params = await searchParams;
  const from = params.from ?? isoDaysAgo(30);
  const to = params.to ?? new Date().toISOString().slice(0, 10);

  const [activity, pipeline, placements, jobs] = await Promise.all([
    activityReport(from, to),
    masterPipeline({ status: "active" }),
    listPlacements({ status: "all" }),
    listJobs({ status: "open" }),
  ]);

  const placementRows = placements as (Record<string, unknown> & {
    started_on: string | null; fee_amount: number | null; status: string;
  })[];
  const inWindow = placementRows.filter(
    (p) => p.started_on && p.started_on >= from && p.started_on <= to
  );

  const byStage = new Map<string, number>();
  for (const c of pipeline) {
    const k = c.stage_kind ?? "other";
    byStage.set(k, (byStage.get(k) ?? 0) + 1);
  }

  return (
    <div className="space-y-4 p-6">
      <PageHeader title="Reports" />

      <form className="flex flex-wrap items-center gap-2" action="/talent/reports">
        <input type="date" name="from" defaultValue={from}
          className="rounded-md border bg-background px-2 py-1.5 text-sm" />
        <input type="date" name="to" defaultValue={to}
          className="rounded-md border bg-background px-2 py-1.5 text-sm" />
        <Button size="sm" variant="outline" type="submit">Apply</Button>
      </form>

      <div className="grid grid-cols-2 gap-4 rounded-lg border bg-card px-4 py-3 sm:grid-cols-5">
        <Stat label="Open jobs" value={jobs.length} />
        <Stat label="In pipeline" value={pipeline.length} />
        <Stat label="Placements" value={inWindow.length} />
        <Stat label="Fees" value={money(inWindow.reduce((s, p) => s + (p.fee_amount ?? 0), 0))} />
        <Stat
          label="Fell off"
          value={placementRows.filter((p) => p.status === "fell_off").length}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Activity">
          {activity.length === 0 ? <Empty>Nothing logged in this window</Empty> : (
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Person</th>
                  <th className="px-4 py-2 text-right font-medium">Calls</th>
                  <th className="px-4 py-2 text-right font-medium">Emails</th>
                  <th className="px-4 py-2 text-right font-medium">Meetings</th>
                  <th className="px-4 py-2 text-right font-medium">Subs</th>
                  <th className="px-4 py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {activity.map((a) => (
                  <tr key={a.member_id}>
                    <td className="px-4 py-2">{a.member_name ?? "—"}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{a.calls}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{a.emails}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{a.meetings}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{a.submissions}</td>
                    <td className="px-4 py-2 text-right font-medium tabular-nums">{a.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="Where the pipeline is">
          {byStage.size === 0 ? <Empty>Nothing active</Empty> : (
            <ul className="divide-y text-sm">
              {[...byStage.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([kind, count]) => (
                  <li key={kind} className="flex items-center gap-3 px-4 py-2">
                    <span className="w-28 shrink-0">{label(STAGE_KIND, kind)}</span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <span
                        className="block h-full bg-primary"
                        style={{ width: `${Math.round((count / pipeline.length) * 100)}%` }}
                      />
                    </span>
                    <span className="w-10 shrink-0 text-right tabular-nums">{count}</span>
                  </li>
                ))}
            </ul>
          )}
        </Panel>

        <Panel title="Jobs by activity" className="lg:col-span-2">
          {jobs.length === 0 ? <Empty>No open jobs</Empty> : (
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Job</th>
                  <th className="px-4 py-2 font-medium">Owner</th>
                  <th className="px-4 py-2 text-right font-medium">Active</th>
                  <th className="px-4 py-2 text-right font-medium">Submitted</th>
                  <th className="px-4 py-2 text-right font-medium">Interview</th>
                  <th className="px-4 py-2 text-right font-medium">Hired</th>
                  <th className="px-4 py-2 font-medium">Opened</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td className="px-4 py-2">
                      <Link href={`/talent/jobs/${j.id}?tab=reports`} className="hover:underline">
                        {j.title}
                      </Link>
                      {j.active_count === 0 && (
                        <Chip colour="rose" className="ml-2">empty</Chip>
                      )}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{j.owner_name ?? "—"}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{j.active_count}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{j.submitted_count}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{j.interview_count}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{j.hired_count}</td>
                    <td className="px-4 py-2 text-muted-foreground">{onDay(j.opened_on)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </div>
  );
}
