import Link from "next/link";
import { redirect } from "next/navigation";
import { myPermissions } from "@/lib/org";
import { integrationsReport } from "@/actions/integrations";
import { ArrowDownToLine, ArrowUpFromLine, ArrowLeftRight, SlidersHorizontal } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Surface } from "@/components/ui/surface";
import { TableScroll, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";

export const dynamic = "force-dynamic";

/**
 * Where the app's data comes from and where it goes.
 *
 * Administrators only, and reached through Settings rather than the sidebar.
 * It reports on the plumbing -- schedules, table sizes, which mailboxes are
 * read and what failed -- which is a different audience from the people
 * reading the figures those syncs produce.
 *
 * This is the one screen in the app that is mostly prose. Everywhere else the
 * rule is labels and data with the explaining done elsewhere; here the
 * explaining *is* the thing being asked for.
 */

function ago(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Anything older than this is worth a second look rather than a shrug. */
function staleTone(iso: string | null): string {
  if (!iso) return "text-muted-foreground";
  const hours = (Date.now() - new Date(iso).getTime()) / 3600000;
  if (hours > 48) return "text-destructive font-medium";
  if (hours > 24) return "text-warning";
  return "text-muted-foreground";
}

const DIRECTION = {
  in: { icon: ArrowDownToLine, label: "Reads into the app" },
  out: { icon: ArrowUpFromLine, label: "Sends out of the app" },
  both: { icon: ArrowLeftRight, label: "Both ways" },
} as const;

export default async function IntegrationsPage() {
  // Checked here, not merely hidden from the navigation. A link that is not
  // drawn is not a permission.
  if (!(await myPermissions()).has("org.manage")) redirect("/");

  const report = await integrationsReport();

  if (report.problem) {
    return (
      <div className="p-6 max-w-3xl">
        <PageHeader title="Integrations" />
        <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {report.problem}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8 p-6 max-w-5xl">
      <PageHeader
        title="Integrations"
        description="Every tool this app reads from or writes to, what it takes, what it deliberately leaves out, and when it last ran. Read from the running system rather than written down, so it stays true as things change."
      />

      {/* Anything actually wrong, before anything merely informative. */}
      {(report.failing.length > 0 || report.undocumented.length > 0) && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium">Needs attention</h2>

          {report.failing.length > 0 && (
            <TableScroll className="rounded-md border border-destructive/40">
              <Table>
                <THead className="bg-destructive/10">
                  <TR>
                    <TH>Account</TH>
                    <TH>Read</TH>
                    <TH>When</TH>
                    <TH>Problem</TH>
                  </TR>
                </THead>
                <TBody>
                  {report.failing.map((r) => (
                    <TR key={`${r.kind}-${r.account}`} className="border-t">
                      <TD>{r.account}</TD>
                      <TD className="text-muted-foreground">{r.kind}</TD>
                      <TD className="text-muted-foreground">{ago(r.ranAt)}</TD>
                      <TD className="text-destructive">{r.problem}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableScroll>
          )}

          {report.undocumented.length > 0 && (
            <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
              <span className="font-medium">Not described below:</span>{" "}
              <span className="font-mono text-xs">{report.undocumented.join(", ")}</span>
              <span className="block text-xs text-muted-foreground">
                These tables exist but no integration claims them. Add them to
                lib/integrations/catalogue.ts.
              </span>
            </div>
          )}
        </section>
      )}

      {report.integrations.map((i) => {
        const Direction = DIRECTION[i.direction].icon;
        return (
          <Surface key={i.key} as="section" className="space-y-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-base font-medium">{i.name}</h2>
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Direction className="h-3.5 w-3.5" />
                {DIRECTION[i.direction].label}
              </span>
              <span className="ml-auto text-xs text-muted-foreground">{i.ownedBy}</span>
            </div>

            <p className="max-w-3xl text-sm">{i.what}</p>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  How it moves
                </h3>
                <p className="text-sm text-muted-foreground">{i.transport}</p>
              </div>

              <div className="space-y-1">
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Deliberately not included
                </h3>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {i.excluded.map((e) => (
                    <li key={e}>— {e}</li>
                  ))}
                </ul>
              </div>
            </div>

            {i.tableState.length > 0 && (
              <TableScroll className="rounded-md border">
                <Table>
                  <THead>
                    <TR>
                      <TH>Table</TH>
                      <TH numeric>Rows</TH>
                      <TH numeric>Size</TH>
                      <TH numeric>Last changed</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {i.tableState.map((t) => (
                      <TR key={t.name} className="border-t">
                        <TD className="font-mono text-xs">{t.name}</TD>
                        <TD numeric>
                          {t.missing ? (
                            <span className="text-destructive">absent</span>
                          ) : (
                            (t.rows ?? 0).toLocaleString()
                          )}
                        </TD>
                        <TD numeric className="text-muted-foreground">
                          {t.size ?? "—"}
                        </TD>
                        <TD numeric
                          className={`${staleTone(t.lastChanged)}`}
                        >
                          {ago(t.lastChanged)}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableScroll>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Feeds: {i.feeds.join(" · ")}
              </p>
              {/* Where to go and change it, beside the description of what it
                  does -- those were two screens apart before. */}
              {i.configure && (
                <Link
                  href={i.configure.href}
                  title={i.configure.what}
                  className="inline-flex shrink-0 items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
                >
                  <SlidersHorizontal className="h-4 w-4" />
                  {i.configure.label}
                </Link>
              )}
            </div>
          </Surface>
        );
      })}

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Schedules</h2>
        <TableScroll className="rounded-md border">
          <Table>
            <THead>
              <TR>
                <TH>Job</TH>
                <TH>Runs</TH>
                <TH>Cron</TH>
                <TH>State</TH>
              </TR>
            </THead>
            <TBody>
              {report.schedules.map((s) => (
                <TR key={s.name} className="border-t">
                  <TD className="font-mono text-xs">{s.name}</TD>
                  <TD>{s.runs}</TD>
                  <TD className="font-mono text-xs text-muted-foreground">{s.cron}</TD>
                  <TD>
                    {s.active ? (
                      <span className="text-success">on</span>
                    ) : (
                      <span className="text-destructive">off</span>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableScroll>
        <p className="text-xs text-muted-foreground">
          Coupler runs Salesforce and QuickBooks on its own schedule, outside
          this list. The last-changed column above is the app&apos;s only view of
          when those arrived.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">What Google is allowed to do</h2>
        <TableScroll className="rounded-md border">
          <Table>
            <THead>
              <TR>
                <TH>Purpose</TH>
                <TH>Scope granted</TH>
              </TR>
            </THead>
            <TBody>
              {report.googleScopes.map((g) => (
                <TR key={g.service} className="border-t align-top">
                  <TD>{g.service}</TD>
                  <TD className="font-mono text-xs text-muted-foreground">
                    {g.scopes.map((s) => (
                      <span key={s} className="block">
                        {s.replace("https://www.googleapis.com/auth/", "")}
                      </span>
                    ))}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableScroll>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Which mail is read</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          The exact search sent to Gmail. Subjects only — Gmail&apos;s default
          searches whole messages, which pulled in sales threads that merely
          mentioned money.
        </p>
        <pre className="overflow-x-auto rounded-md border bg-muted/30 p-3 text-xs">
          {report.billingQuery}
        </pre>
      </section>

      {report.recentRuns.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium">Recent reads</h2>
          <TableScroll className="rounded-md border">
            <Table>
              <THead>
                <TR>
                  <TH>Account</TH>
                  <TH>Source</TH>
                  <TH numeric>Found</TH>
                  <TH numeric>Attached</TH>
                  <TH>When</TH>
                </TR>
              </THead>
              <TBody>
                {report.recentRuns.map((r) => (
                  <TR key={`${r.kind}-${r.account}-${r.ranAt}`} className="border-t">
                    <TD>{r.account}</TD>
                    <TD className="text-muted-foreground">{r.kind}</TD>
                    <TD numeric>{r.found}</TD>
                    <TD numeric>{r.attached}</TD>
                    <TD className="text-muted-foreground">{ago(r.ranAt)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableScroll>
        </section>
      )}
    </div>
  );
}
