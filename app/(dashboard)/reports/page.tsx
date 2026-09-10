import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Surface } from "@/components/ui/surface";
import { currentMemberId, myPermissions } from "@/lib/org";
import { reportsFor } from "@/lib/reports/catalogue";
import { listDashboards, listReports } from "@/lib/reporting/data";
import type { Dashboard, SavedReport } from "@/lib/reporting/spec";

export const dynamic = "force-dynamic";

/**
 * The library: dashboards, the reports this person built, the ones shared
 * with everyone, and the standard reports the app ships with. Built from
 * what the person may see -- row security on the saved ones, permissions
 * on the standard ones -- so nothing is listed that will refuse to open.
 */
export default async function ReportsIndexPage() {
  const [perms, memberId, reports, dashboards] = await Promise.all([
    myPermissions(), currentMemberId(), listReports(), listDashboards(),
  ]);
  const standard = reportsFor(perms as Set<string>);
  const mine = reports.filter((r) => r.owner_member_id === memberId);
  const shared = reports.filter((r) => r.shared && r.owner_member_id !== memberId);

  return (
    <div className="space-y-section p-section">
      <PageHeader
        title="Reports"
        description="Build a report on any table, save it, share it, chart it, and pin it to a dashboard."
        actions={
          <>
            <Button asChild variant="outline" size="sm"><Link href="/reports/dashboards/new">New dashboard</Link></Button>
            <Button asChild size="sm"><Link href="/reports/new">New report</Link></Button>
          </>
        }
      />

      <Section title="Dashboards" empty="No dashboards yet. Make one from any saved reports.">
        {dashboards.map((d) => <DashboardCard key={d.id} dashboard={d} mine={d.owner_member_id === memberId} />)}
      </Section>

      <Section title="My reports" empty="Nothing saved yet. Build one and press Save report.">
        {mine.map((r) => <ReportCard key={r.id} report={r} />)}
      </Section>

      {shared.length > 0 ? (
        <Section title="Shared with everyone">
          {shared.map((r) => <ReportCard key={r.id} report={r} />)}
        </Section>
      ) : null}

      {standard.map((g) => (
        <Section key={g.group} title={`Standard · ${g.group}`}>
          {g.reports.map((r) => (
            <Card key={r.key} href={`/reports/standard/${r.key}`} title={r.label} sub={r.description} />
          ))}
        </Section>
      ))}
    </div>
  );
}

function Section({ title, empty, children }: { title: string; empty?: string; children: React.ReactNode }) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];
  return (
    <section className="space-y-3">
      <h2 className="text-section-title">{title}</h2>
      {items.length === 0 ? (
        <p className="text-body text-muted-foreground">{empty}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
      )}
    </section>
  );
}

function Card({ href, title, sub, tag }: { href: string; title: string; sub?: string | null; tag?: string }) {
  return (
    <Link href={href} className="block">
      <Surface interactive pad="tight" className="h-full">
        <div className="flex items-start justify-between gap-2">
          <div className="text-body font-medium">{title}</div>
          {tag ? <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-meta text-muted-foreground">{tag}</span> : null}
        </div>
        {sub ? <p className="mt-1 line-clamp-2 text-meta text-muted-foreground">{sub}</p> : null}
      </Surface>
    </Link>
  );
}

function ReportCard({ report }: { report: SavedReport }) {
  const shape = report.spec.groups.length || report.spec.aggregates.length ? "Summary" : "Rows";
  return (
    <Card
      href={`/reports/r/${report.id}`}
      title={report.name}
      sub={report.description ?? `${shape} of ${report.spec.object}`}
      tag={report.shared ? "Shared" : undefined}
    />
  );
}

function DashboardCard({ dashboard, mine }: { dashboard: Dashboard; mine: boolean }) {
  const n = dashboard.tiles.length;
  return (
    <Card
      href={`/reports/dashboards/${dashboard.id}`}
      title={dashboard.name}
      sub={dashboard.description ?? `${n} ${n === 1 ? "tile" : "tiles"}`}
      tag={dashboard.shared && !mine ? "Shared" : undefined}
    />
  );
}
