import Link from "next/link";
import { notFound } from "next/navigation";
import { DashboardTile } from "@/components/reporting/DashboardTile";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Surface } from "@/components/ui/surface";
import { currentMemberId, myPermissions } from "@/lib/org";
import { canEdit, getDashboard, getReport } from "@/lib/reporting/data";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const SPAN = { third: "md:col-span-2", half: "md:col-span-3", full: "md:col-span-6" } as const;

export default async function DashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [dashboard, memberId, perms] = await Promise.all([getDashboard(id), currentMemberId(), myPermissions()]);
  if (!dashboard) notFound();

  // Each tile's report, as this viewer may see it: one that row security
  // hides comes back null and the tile says so rather than the page failing.
  const reports = await Promise.all(dashboard.tiles.map((t) => getReport(t.report_id)));
  const editable = canEdit(dashboard, memberId, perms as Set<string>);

  return (
    <div className="space-y-4 p-section">
      <PageHeader
        eyebrow={<Link href="/reports" className="hover:text-foreground">Reports</Link>}
        title={dashboard.name}
        description={dashboard.description ?? (dashboard.shared ? "Shared with everyone" : undefined)}
        actions={editable ? (
          <Button asChild size="sm"><Link href={`/reports/dashboards/${dashboard.id}/edit`}>Edit dashboard</Link></Button>
        ) : null}
      />

      {dashboard.tiles.length === 0 ? (
        <Surface>
          <p className="text-body text-muted-foreground">No tiles yet.</p>
        </Surface>
      ) : (
        <div className="grid gap-3 md:grid-cols-6">
          {dashboard.tiles.map((t, i) => (
            <div key={i} className={cn("min-w-0", SPAN[t.width])}>
              <DashboardTile tile={t} report={reports[i]} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
