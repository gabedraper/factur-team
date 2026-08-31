import { redirect } from "next/navigation";
import { getAuthedUser } from "@/lib/supabase/session";
import { integrationsReport } from "@/actions/integrations";
import { ArrowDownToLine, ArrowUpFromLine, ArrowLeftRight } from "lucide-react";

export const dynamic = "force-dynamic";

/**
 * Where the app's data comes from and where it goes.
 *
 * Open to everyone who can sign in, deliberately. The people who most need to
 * know that a figure is two days stale, or that a mailbox stopped being read
 * on Tuesday, are the ones reading the figure -- not the two administrators
 * who would otherwise be the only ones able to find out.
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
  const user = await getAuthedUser();
  if (!user) redirect("/login");

  const report = await integrationsReport();

  if (report.problem) {
    return (
      <div className="p-6 max-w-3xl">
        <h1 className="text-xl font-semibold">Integrations</h1>
        <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {report.problem}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8 p-6 max-w-5xl">
      <div>
        <h1 className="text-xl font-semibold">Integrations</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Every tool this app reads from or writes to, what it takes, what it
          deliberately leaves out, and when it last ran. Read from the running
          system rather than written down, so it stays true as things change.
        </p>
      </div>

      {/* Anything actually wrong, before anything merely informative. */}
      {(report.failing.length > 0 || report.undocumented.length > 0) && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium">Needs attention</h2>

          {report.failing.length > 0 && (
            <div className="overflow-x-auto rounded-md border border-destructive/40">
              <table className="w-full text-sm">
                <thead className="bg-destructive/10 text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">Account</th>
                    <th className="px-3 py-2 font-medium">Read</th>
                    <th className="px-3 py-2 font-medium">When</th>
                    <th className="px-3 py-2 font-medium">Problem</th>
                  </tr>
                </thead>
                <tbody>
                  {report.failing.map((r) => (
                    <tr key={`${r.kind}-${r.account}`} className="border-t">
                      <td className="px-3 py-1.5">{r.account}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{r.kind}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{ago(r.ranAt)}</td>
                      <td className="px-3 py-1.5 text-destructive">{r.problem}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
          <section key={i.key} className="space-y-3 rounded-md border bg-card p-4">
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
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-left">
                    <tr>
                      <th className="px-3 py-2 font-medium">Table</th>
                      <th className="px-3 py-2 text-right font-medium">Rows</th>
                      <th className="px-3 py-2 text-right font-medium">Size</th>
                      <th className="px-3 py-2 text-right font-medium">Last changed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {i.tableState.map((t) => (
                      <tr key={t.name} className="border-t">
                        <td className="px-3 py-1.5 font-mono text-xs">{t.name}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {t.missing ? (
                            <span className="text-destructive">absent</span>
                          ) : (
                            (t.rows ?? 0).toLocaleString()
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                          {t.size ?? "—"}
                        </td>
                        <td
                          className={`px-3 py-1.5 text-right tabular-nums ${staleTone(t.lastChanged)}`}
                        >
                          {ago(t.lastChanged)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Feeds: {i.feeds.join(" · ")}
            </p>
          </section>
        );
      })}

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Schedules</h2>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Job</th>
                <th className="px-3 py-2 font-medium">Runs</th>
                <th className="px-3 py-2 font-medium">Cron</th>
                <th className="px-3 py-2 font-medium">State</th>
              </tr>
            </thead>
            <tbody>
              {report.schedules.map((s) => (
                <tr key={s.name} className="border-t">
                  <td className="px-3 py-1.5 font-mono text-xs">{s.name}</td>
                  <td className="px-3 py-1.5">{s.runs}</td>
                  <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">{s.cron}</td>
                  <td className="px-3 py-1.5">
                    {s.active ? (
                      <span className="text-success">on</span>
                    ) : (
                      <span className="text-destructive">off</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          Coupler runs Salesforce and QuickBooks on its own schedule, outside
          this list. The last-changed column above is the app&apos;s only view of
          when those arrived.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">What Google is allowed to do</h2>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Purpose</th>
                <th className="px-3 py-2 font-medium">Scope granted</th>
              </tr>
            </thead>
            <tbody>
              {report.googleScopes.map((g) => (
                <tr key={g.service} className="border-t align-top">
                  <td className="px-3 py-1.5">{g.service}</td>
                  <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">
                    {g.scopes.map((s) => (
                      <span key={s} className="block">
                        {s.replace("https://www.googleapis.com/auth/", "")}
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">Account</th>
                  <th className="px-3 py-2 font-medium">Source</th>
                  <th className="px-3 py-2 text-right font-medium">Found</th>
                  <th className="px-3 py-2 text-right font-medium">Attached</th>
                  <th className="px-3 py-2 font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {report.recentRuns.map((r) => (
                  <tr key={`${r.kind}-${r.account}-${r.ranAt}`} className="border-t">
                    <td className="px-3 py-1.5">{r.account}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{r.kind}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.found}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.attached}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{ago(r.ranAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
