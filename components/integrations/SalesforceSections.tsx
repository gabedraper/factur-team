import Link from "next/link";
import { cn } from "@/lib/utils";
import { listSalesforceSuggestions, listClientRoleDrift, listMembers } from "@/lib/org";
import { getSyncState, getSyncConfig, type ReconRow } from "@/actions/salesforce-sync";
import { getWritebackState } from "@/actions/salesforce-writeback";
import { salesforceRecordUrl } from "@/lib/salesforce/client";
import { SalesforceMatchScreen } from "@/components/settings/SalesforceMatchScreen";
import { ClientRoleDrift } from "@/components/settings/ClientRoleDrift";
import { SalesforceSyncObjects } from "@/components/settings/SalesforceSyncObjects";
import { CheckNow } from "@/components/settings/SalesforceSyncCheck";
import { SalesforceWritebackControls } from "@/components/settings/SalesforceWriteback";
import { Surface } from "@/components/ui/surface";
import { Chip } from "@/components/pipeline/bits";
import { Table, TableScroll, THead, TBody, TR, TH, TD } from "@/components/ui/table";

/*
 * Everything Salesforce, on Salesforce's card: who is who, what is synced,
 * whether it is all here, and what went back. These were three settings
 * pages; the content is unchanged, the home is not.
 */

const nf = new Intl.NumberFormat("en-US");

function when(iso: string | null) {
  if (!iso) return "never";
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function SectionTitle({ id, children }: { id: string; children: React.ReactNode }) {
  return <h2 id={id} className="scroll-mt-20 text-section-title">{children}</h2>;
}

/* ---------- Accounts ---------- */
export async function SalesforceAccounts() {
  const [suggestions, drift] = await Promise.all([listSalesforceSuggestions(), listClientRoleDrift()]);
  return (
    <section className="space-y-4">
      <SectionTitle id="accounts">Accounts</SectionTitle>
      <p className="max-w-3xl text-body text-muted-foreground">
        Tying each person to their Salesforce user, so opportunities and activity are attributed to the right person.
        Exact email fails often — staff appear under one domain in Salesforce and another in the directory — so these
        are scored suggestions, not answers.
      </p>
      <SalesforceMatchScreen suggestions={suggestions} />
      <div className="space-y-2">
        <h3 className="text-body font-medium">Client cover</h3>
        <p className="max-w-3xl text-meta text-muted-foreground">
          Who covers a client is set in the app. These are the clients where Salesforce still says someone else —
          nothing is changed automatically, because which side is right depends on who actually works the account.
        </p>
        <ClientRoleDrift rows={drift} />
      </div>
    </section>
  );
}

/* ---------- Sync ---------- */
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
const OBJECT_LABEL: Record<string, string> = {
  Opportunity: "Opportunities", Quote: "Quotes", Order: "Purchase orders", Contact: "Contacts", Account: "Companies",
};

export async function SalesforceSync() {
  const [{ checkedAt, previousAt, rows, previous, sync }, objects] = await Promise.all([getSyncState(), getSyncConfig()]);
  const lastRun = Object.fromEntries(sync.map((s) => [s.object, s.last_run_at]));
  const totals = rows.filter((r) => r.scope === "__all");
  const stages = rows.filter((r) => r.object === "Opportunity" && r.scope !== "__all").sort((a, b) => (b.sf_count ?? 0) - (a.sf_count ?? 0));
  const prevBy = new Map(previous.map((r) => [`${r.object}|${r.scope}`, r]));
  const movement = (r: ReconRow) => {
    const p = prevBy.get(`${r.object}|${r.scope}`);
    if (!p || p.sf_count === null || p.app_count === null || r.sf_count === null || r.app_count === null) return null;
    const before = p.sf_count - p.app_count, now = r.sf_count - r.app_count;
    return now === before ? null : now < before ? "closing" : "widening";
  };
  const expectedGap = stages.filter((r) => r.note).reduce((a, r) => a + ((r.sf_count ?? 0) - (r.app_count ?? 0)), 0);

  return (
    <section className="space-y-4">
      <SectionTitle id="sync">Sync</SectionTitle>
      <h3 className="text-body font-medium">What is synced</h3>
      <SalesforceSyncObjects objects={objects} lastRun={lastRun} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-body font-medium">Is it all here?</h3>
        <CheckNow />
      </div>
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
                <THead><TR><TH>Object</TH><TH numeric>Salesforce</TH><TH numeric>Mirror</TH><TH numeric>App</TH><TH numeric>App vs Salesforce</TH><TH>Note</TH></TR></THead>
                <TBody>
                  {totals.map((r) => (
                    <TR key={r.object}>
                      <TD className="font-medium">{OBJECT_LABEL[r.object] ?? r.object}</TD>
                      <TD numeric>{r.sf_count === null ? "—" : nf.format(r.sf_count)}</TD>
                      <TD numeric>{r.mirror_count === null ? "—" : nf.format(r.mirror_count)}</TD>
                      <TD numeric>{r.app_count === null ? "—" : nf.format(r.app_count)}</TD>
                      <TD numeric>
                        {r.object === "Opportunity" && r.sf_count !== null && r.app_count !== null
                          ? <Diff sf={r.sf_count - expectedGap} app={r.app_count} expected={false} />
                          : <Diff sf={r.sf_count} app={r.app_count} expected={r.object === "Contact" || r.object === "Account"} />}
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
          <h3 className="text-body font-medium">Opportunities by stage</h3>
          <Surface pad="none">
            <TableScroll>
              <Table>
                <THead><TR><TH>Stage</TH><TH numeric>Salesforce</TH><TH numeric>Mirror</TH><TH numeric>App</TH><TH numeric>App vs Salesforce</TH><TH>Note</TH></TR></THead>
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

      <h3 className="text-body font-medium">Sync runs</h3>
      <Surface pad="none">
        <TableScroll>
          <Table>
            <THead><TR><TH>Object</TH><TH>Caught up to</TH><TH>Last run</TH><TH numeric>Rows</TH><TH>Status</TH></TR></THead>
            <TBody>
              {sync.map((s) => (
                <TR key={s.object}>
                  <TD className="whitespace-nowrap">{s.object === "__transforms" ? "Transforms (mirror → app)" : s.object === "__transforms_floor" ? "Transforms: sync mark" : s.object}</TD>
                  <TD className="whitespace-nowrap tabular-nums text-muted-foreground">{when(s.watermark)}</TD>
                  <TD className="whitespace-nowrap tabular-nums text-muted-foreground">{when(s.last_run_at)}</TD>
                  <TD numeric>{s.last_run_rows === null ? "" : nf.format(s.last_run_rows)}</TD>
                  <TD>{s.last_error ? <span className="text-meta text-destructive">{s.last_error}</span> : <Chip colour="emerald">ok</Chip>}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableScroll>
      </Surface>
    </section>
  );
}

/* ---------- Write-back ---------- */
const TONE: Record<string, "emerald" | "amber" | "rose" | "slate" | "sky"> = {
  verified: "emerald", sent: "sky", queued: "slate", sending: "slate", skipped: "slate",
  mismatch: "amber", conflict: "amber", failed: "rose",
};
const FILTERS = ["all", "verified", "mismatch", "conflict", "failed", "queued"] as const;
const shown = (v: string | null) => (v === null || v === "" ? "—" : v);

export async function SalesforceWriteback({ status, canShare }: { status: string; canShare: boolean }) {
  const current = FILTERS.includes(status as (typeof FILTERS)[number]) ? status : "all";
  const [state, { members }] = await Promise.all([getWritebackState(current), listMembers()]);
  const list = members as { id: string; full_name: string | null; email: string }[];
  const people = new Map(list.map((m) => [m.id, m.full_name ?? m.email]));
  void canShare;

  return (
    <section className="space-y-4">
      <SectionTitle id="writeback">Write-back</SectionTitle>
      <SalesforceWritebackControls enabled={state.enabled} testers={state.testers} members={list} />

      <nav aria-label="Filter" className="flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={f === "all" ? "/integrations/salesforce#writeback" : `/integrations/salesforce?status=${f}#writeback`}
            aria-current={current === f ? "page" : undefined}
            className={cn("rounded-full px-3 py-1 text-meta transition-colors duration-fast ease-out",
              current === f ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-card-hover hover:text-foreground")}
          >
            {f === "all" ? "All" : f}
            {state.counts[f] !== undefined && <span className="ml-1 tabular-nums">{state.counts[f]}</span>}
          </Link>
        ))}
      </nav>

      {state.rows.length === 0 ? (
        <Surface><p className="py-6 text-center text-body text-muted-foreground">{current === "all" ? "Nothing has been pushed yet." : `Nothing with the status “${current}”.`}</p></Surface>
      ) : (
        <Surface pad="none">
          <TableScroll>
            <Table>
              <THead><TR><TH>When</TH><TH>Who</TH><TH>Field</TH><TH>App: before → after</TH><TH>Salesforce: before → after</TH><TH>Status</TH></TR></THead>
              <TBody>
                {state.rows.map((r) => (
                  <TR key={r.id}>
                    <TD className="whitespace-nowrap text-muted-foreground">{when(r.created_at)}</TD>
                    <TD className="whitespace-nowrap">{r.member_id ? people.get(r.member_id) ?? "—" : "—"}</TD>
                    <TD className="whitespace-nowrap">
                      <Link href={`/opportunities/${r.opportunity_id}`} className="underline-offset-2 hover:underline">{r.field}</Link>
                      <span className="block text-meta text-muted-foreground">{r.sf_field}</span>
                    </TD>
                    <TD className="max-w-[18rem]"><span className="block truncate">{shown(r.old_value)} → {shown(r.new_value)}</span></TD>
                    <TD className="max-w-[18rem]">
                      <span className="block truncate">{shown(r.sf_before)} → {shown(r.sf_after)}</span>
                      <a href={salesforceRecordUrl(r.salesforce_id)} target="_blank" rel="noreferrer" className="block text-meta text-muted-foreground underline-offset-2 hover:underline">Open in Salesforce</a>
                    </TD>
                    <TD className="max-w-[16rem]">
                      <Chip colour={TONE[r.status] ?? "slate"}>{r.status}</Chip>
                      {r.error && <span className="mt-1 block text-meta text-muted-foreground">{r.error}</span>}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableScroll>
        </Surface>
      )}
    </section>
  );
}
