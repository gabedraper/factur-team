import Link from "next/link";
import { redirect } from "next/navigation";
import { myPermissions } from "@/lib/org";
import { integrationsReport } from "@/actions/integrations";
import { TOOLS } from "@/lib/integrations/catalogue";
import { PageHeader } from "@/components/ui/page-header";
import { surface } from "@/components/ui/surface";
import { CompanyLogo } from "@/components/ui/thumbnail";
import { TableScroll, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { ago, DIRECTION } from "@/components/integrations/Connection";

export const dynamic = "force-dynamic";

/**
 * Every tool the app is connected to, one card each. The card says what the
 * tool is here for, which way data moves, when it last moved, and whether
 * anything is wrong; the tool's page holds the connections in full and every
 * setting that belongs to it.
 *
 * Administrators only, and reached through Settings rather than the sidebar.
 */

export default async function IntegrationsPage() {
  if (!(await myPermissions()).has("org.manage")) redirect("/");

  const report = await integrationsReport();
  if (report.problem) {
    return (
      <div className="max-w-3xl p-section">
        <PageHeader title="Integrations" />
        <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-body text-destructive">
          {report.problem}
        </p>
      </div>
    );
  }

  const undescribed = report.schedules.filter((s) => !s.about).map((s) => s.name);

  const cards = TOOLS.map((tool) => {
    const connections = report.integrations.filter((i) => i.tool === tool.key);
    const directions = [...new Set(connections.map((c) => c.direction))];
    const lastChanged = connections
      .flatMap((c) => c.tableState.map((t) => t.lastChanged))
      .filter((d): d is string => Boolean(d))
      .sort()
      .at(-1) ?? null;
    /* Failing reads are Google's; nothing else reports per-account runs yet. */
    const attention = tool.key === "google" ? report.failing.length : 0;
    return { tool, connections, directions, lastChanged, attention };
  });

  return (
    <div className="space-y-8 p-section">
      <PageHeader
        title="Integrations"
        description="Every tool this app reads from or writes to. Open one for what it takes, what it deliberately leaves out, when it last ran, and its settings."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map(({ tool, connections, directions, lastChanged, attention }) => (
          <Link
            key={tool.key}
            href={`/integrations/${tool.key}`}
            className={`${surface({ interactive: true })} flex flex-col gap-3`}
          >
            <span className="flex items-center gap-3">
              <CompanyLogo name={tool.name} domain={tool.domain} size={32} />
              <span className="min-w-0">
                <span className="block text-section-title">{tool.name}</span>
                <span className="block text-meta text-muted-foreground">
                  {connections.length} connection{connections.length === 1 ? "" : "s"}
                  {directions.map((d) => {
                    const Icon = DIRECTION[d].icon;
                    return <Icon key={d} className="ml-1.5 inline h-3.5 w-3.5 align-text-bottom" aria-label={DIRECTION[d].label} />;
                  })}
                </span>
              </span>
              {attention > 0 && (
                <span className="ml-auto shrink-0 rounded-full bg-destructive/10 px-2 py-0.5 text-meta text-destructive">
                  {attention} failing
                </span>
              )}
            </span>
            <span className="text-body text-muted-foreground">{tool.what}</span>
            <span className="mt-auto text-meta text-muted-foreground">
              {lastChanged ? `Data last changed ${ago(lastChanged)}` : "No data yet"}
            </span>
          </Link>
        ))}
      </div>

      {report.undocumented.length > 0 && (
        <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-body">
          <span className="font-medium">Not described by any tool:</span>{" "}
          <span className="font-mono text-meta">{report.undocumented.join(", ")}</span>
          <span className="block text-meta text-muted-foreground">
            These tables exist but no integration claims them. Add them to lib/integrations/catalogue.ts.
          </span>
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-section-title">Schedules</h2>
        <p className="text-meta text-muted-foreground">
          Read from the database&apos;s own job list on every load, so a job added or removed by any change shows
          here at once. What each one is for is written in lib/integrations/schedules.ts.
        </p>
        {undescribed.length > 0 && (
          <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-body">
            <span className="font-medium">Not described:</span>{" "}
            <span className="font-mono text-meta">{undescribed.join(", ")}</span>
            <span className="block text-meta text-muted-foreground">
              These jobs run but nobody has written what they do. Add them to lib/integrations/schedules.ts.
            </span>
          </div>
        )}
        <TableScroll className="rounded-md border">
          <Table>
            <THead><TR><TH>Job</TH><TH>Records</TH><TH>From</TH><TH>To</TH><TH>Criteria</TH><TH>Runs</TH><TH>State</TH></TR></THead>
            <TBody>
              {report.schedules.map((s) => (
                <TR key={s.name} className="border-t align-top">
                  <TD>
                    <span className="block font-mono text-meta">{s.name}</span>
                    {s.calls && <span className="block font-mono text-meta text-muted-foreground">{s.calls}</span>}
                  </TD>
                  {s.about ? (
                    <>
                      <TD className="min-w-40">{s.about.records}</TD>
                      <TD className="min-w-40 text-muted-foreground">{s.about.from}</TD>
                      <TD className="min-w-40 text-muted-foreground">{s.about.to}</TD>
                      <TD className="min-w-56 text-muted-foreground">{s.about.criteria}</TD>
                    </>
                  ) : (
                    <TD colSpan={4} className="text-warning">Not described yet.</TD>
                  )}
                  <TD className="whitespace-nowrap">
                    <span className="block">{s.runs}</span>
                    <span className="block font-mono text-meta text-muted-foreground">{s.cron}</span>
                  </TD>
                  <TD>{s.active ? <span className="text-success">on</span> : <span className="text-destructive">off</span>}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableScroll>
        <p className="text-meta text-muted-foreground">
          Coupler runs its Salesforce and QuickBooks copies on its own schedule, outside this list. The last-changed
          figures on each tool are the app&apos;s only view of when those arrived.
        </p>
      </section>
    </div>
  );
}
