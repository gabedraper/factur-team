import { redirect } from "next/navigation";
import { cn } from "@/lib/utils";
import { myPermissions } from "@/lib/org";
import { getSyncState, getSyncConfig, type ReconRow } from "@/actions/salesforce-sync";
import { SalesforceSyncObjects } from "@/components/settings/SalesforceSyncObjects";
import { CheckNow } from "@/components/settings/SalesforceSyncCheck";
import { PageHeader } from "@/components/ui/page-header";
import { Surface } from "@/components/ui/surface";
import { Chip } from "@/components/pipeline/bits";
import { Table, TableScroll, THead, TBody, TR, TH, TD } from "@/components/ui/table";

export const dynamic = "force-dynamic";

/*
 * Is everything here? Salesforce's count beside the mirror's beside the app's,
 * per object and, for opportunities, per stage. A difference the app makes on
 * purpose is labelled so the eye lands on the ones it does not.
 */

const nf = new Intl.NumberFormat("en-US");

function when(iso: string | null) {
  if (!iso) return "never";
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Salesforce minus app, as a signed figure; blank when equal. */
function Diff({ sf, app, expected }: { sf: number | null; app: number | null; expected: boolean }) {
  if (sf === null || app === null) return <span className="text-muted-foreground">—</span>;
  const d = sf - app;
  if (d === 0) return <span className="text-muted-foreground">0</span>;
  return (
    <span className={cn("tabular-nums", expected ? "text-muted-foreground" : d > 0 ? "text-destructive" : "text-warning")}>
      {d > 0 ? `−${nf.format(d)}` : `+${nf.format(-d)}`}
    </span>
  );
}

function ObjectLabel({ o }: { o: string }) {
  return <>{{ Opportunity: "Opportunities", Quote: "Quotes", Order: "Purchase orders", Contact: "Contacts", Account: "Companies" }[o] ?? o}</>;
}

export default async function SalesforceSyncPage() {
  const perms = await myPermissions();
  if (!perms.has("org.manage")) redirect("/settings");

  const [{ checkedAt, previousAt, rows, previous, sync }, objects] = await Promise.all([getSyncState(), getSyncConfig()]);
  const lastRun = Object.fromEntries(sync.map((s) => [s.object, s.last_run_at]));
  const totals = rows.filter((r) => r.scope === "__all");
  const stages = rows
    .filter((r) => r.object === "Opportunity" && r.scope !== "__all")
    .sort((a, b) => (b.sf_count ?? 0) - (a.sf_count ?? 0));
  const prevBy = new Map(previous.map((r) => [`${r.object}|${r.scope}`, r]));
  /* The opportunity total's gap is mostly the cold-call list, which is left
     out on purpose. Take the labelled stages out and what is left is the part
     worth a look. */
  const expectedGap = stages
    .filter((r) => r.note)
    .reduce((a, r) => a + ((r.sf_count ?? 0) - (r.app_count ?? 0)), 0);
  const movement = (r: ReconRow) => {
    const p = prevBy.get(`${r.object}|${r.scope}`);
    if (!p || p.sf_count === null || p.app_count === null || r.sf_count === null || r.app_count === null) return null;
    const before = p.sf_count - p.app_count;
    const now = r.sf_count - r.app_count;
    return now === before ? null : now < before ? "closing" : "widening";
  };

  return (
    <div className="space-y-4 p-section">
      <PageHeader
        back={{ href: "/settings", label: "Settings" }}
        title="Salesforce sync"
        actions={<CheckNow />}
      />

      <h2 className="text-section-title">What is synced</h2>
      <SalesforceSyncObjects objects={objects} lastRun={lastRun} />

      <h2 className="text-section-title">Is it all here?</h2>
      <p className="text-meta text-muted-foreground">
        Last checked {when(checkedAt)}{previousAt ? `, before that ${when(previousAt)}` : ""}. Hourly.
      </p>

      {rows.length === 0 ? (
        <Surface><p className="py-6 text-center text-body text-muted-foreground">No check has run yet.</p></Surface>
      ) : (
        <>
          <Surface pad="none">
            <TableScroll>
              <Table>
                <THead>
                  <TR>
                    <TH>Object</TH>
                    <TH numeric>Salesforce</TH>
                    <TH numeric>Mirror</TH>
                    <TH numeric>App</TH>
                    <TH numeric>App vs Salesforce</TH>
                    <TH>Note</TH>
                  </TR>
                </THead>
                <TBody>
                  {totals.map((r) => (
                    <TR key={r.object}>
                      <TD className="font-medium"><ObjectLabel o={r.object} /></TD>
                      <TD numeric>{r.sf_count === null ? "—" : nf.format(r.sf_count)}</TD>
                      <TD numeric>{r.mirror_count === null ? "—" : nf.format(r.mirror_count)}</TD>
                      <TD numeric>{r.app_count === null ? "—" : nf.format(r.app_count)}</TD>
                      <TD numeric>
                        {r.object === "Opportunity" && r.sf_count !== null && r.app_count !== null ? (
                          <Diff sf={r.sf_count - expectedGap} app={r.app_count} expected={false} />
                        ) : (
                          <Diff sf={r.sf_count} app={r.app_count} expected={r.object === "Contact" || r.object === "Account"} />
                        )}
                        {movement(r) && <span className="ml-2 text-meta text-muted-foreground">{movement(r)}</span>}
                      </TD>
                      <TD className="max-w-[26rem] text-meta text-muted-foreground">
                        {r.object === "Opportunity" && expectedGap
                          ? [`${nf.format(expectedGap)} left out on purpose (see stages)`, r.note].filter(Boolean).join(" · ")
                          : r.object === "Account"
                            ? "The mirror holds only companies changed since the bulk load; the app holds the bulk load too."
                            : r.note ?? ""}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableScroll>
          </Surface>

          <h2 className="text-section-title">Opportunities by stage</h2>
          <Surface pad="none">
            <TableScroll>
              <Table>
                <THead>
                  <TR>
                    <TH>Stage</TH>
                    <TH numeric>Salesforce</TH>
                    <TH numeric>Mirror</TH>
                    <TH numeric>App</TH>
                    <TH numeric>App vs Salesforce</TH>
                    <TH>Note</TH>
                  </TR>
                </THead>
                <TBody>
                  {stages.map((r) => (
                    <TR key={r.scope}>
                      <TD className="whitespace-nowrap">{r.scope || <span className="text-muted-foreground">(blank)</span>}</TD>
                      <TD numeric>{nf.format(r.sf_count ?? 0)}</TD>
                      <TD numeric>{nf.format(r.mirror_count ?? 0)}</TD>
                      <TD numeric>{nf.format(r.app_count ?? 0)}</TD>
                      <TD numeric><Diff sf={r.sf_count} app={r.app_count} expected={Boolean(r.note)} /></TD>
                      <TD className="max-w-[26rem] text-meta text-muted-foreground">{r.note ?? ""}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableScroll>
          </Surface>
        </>
      )}

      <h2 className="text-section-title">Sync runs</h2>
      <Surface pad="none">
        <TableScroll>
          <Table>
            <THead>
              <TR>
                <TH>Object</TH>
                <TH>Caught up to</TH>
                <TH>Last run</TH>
                <TH numeric>Rows</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {sync.map((s) => (
                <TR key={s.object}>
                  <TD className="whitespace-nowrap">{s.object === "__transforms" ? "Transforms (mirror → app)" : s.object}</TD>
                  <TD className="whitespace-nowrap tabular-nums text-muted-foreground">{when(s.watermark)}</TD>
                  <TD className="whitespace-nowrap tabular-nums text-muted-foreground">{when(s.last_run_at)}</TD>
                  <TD numeric>{s.last_run_rows === null ? "" : nf.format(s.last_run_rows)}</TD>
                  <TD>
                    {s.last_error
                      ? <span className="text-meta text-destructive">{s.last_error}</span>
                      : <Chip colour="emerald">ok</Chip>}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableScroll>
      </Surface>
    </div>
  );
}
