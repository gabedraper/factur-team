import Link from "next/link";
import { redirect } from "next/navigation";
import { cn } from "@/lib/utils";
import { myPermissions, listMembers } from "@/lib/org";
import { getWritebackState } from "@/actions/salesforce-writeback";
import { salesforceRecordUrl } from "@/lib/salesforce/client";
import { SalesforceWritebackControls } from "@/components/settings/SalesforceWriteback";
import { PageHeader } from "@/components/ui/page-header";
import { Surface } from "@/components/ui/surface";
import { Chip } from "@/components/pipeline/bits";
import { Table, TableScroll, THead, TBody, TR, TH, TD } from "@/components/ui/table";

export const dynamic = "force-dynamic";

/*
 * What the app has sent to Salesforce, field by field.
 *
 * One row per field rather than per save, because "the stage went over but the
 * next action date did not" is the answer somebody needs, and a row per save
 * cannot give it.
 */

const TONE: Record<string, "emerald" | "amber" | "rose" | "slate" | "sky"> = {
  verified: "emerald",
  sent: "sky",
  queued: "slate",
  sending: "slate",
  skipped: "slate",
  mismatch: "amber",
  conflict: "amber",
  failed: "rose",
};

const FILTERS = ["all", "verified", "mismatch", "conflict", "failed", "queued"] as const;

function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

/** An empty value is a real value here -- "cleared" reads better than blank. */
function shown(v: string | null) {
  return v === null || v === "" ? "—" : v;
}

export default async function SalesforceWritebackPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const perms = await myPermissions();
  if (!perms.has("org.manage")) redirect("/settings");

  const { status } = await searchParams;
  const current = FILTERS.includes((status ?? "all") as (typeof FILTERS)[number]) ? status ?? "all" : "all";

  const [state, { members }] = await Promise.all([getWritebackState(current), listMembers()]);
  const people = new Map(
    (members as Array<{ id: string; full_name: string | null; email: string }>).map((m) => [
      m.id, m.full_name ?? m.email,
    ]),
  );

  return (
    <div className="space-y-4 p-section">
      <PageHeader
        back={{ href: "/settings", label: "Settings" }}
        title="Salesforce write-back"
        count={state.rows.length}
      />

      <SalesforceWritebackControls
        enabled={state.enabled}
        testers={state.testers}
        members={members as { id: string; full_name: string | null; email: string }[]}
      />

      <nav aria-label="Filter" className="flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={f === "all" ? "/settings/salesforce-writeback" : `/settings/salesforce-writeback?status=${f}`}
            aria-current={current === f ? "page" : undefined}
            className={cn(
              "rounded-full px-3 py-1 text-meta transition-colors duration-fast ease-out",
              current === f
                ? "bg-primary text-primary-foreground"
                : "bg-card text-muted-foreground hover:bg-card-hover hover:text-foreground",
            )}
          >
            {f === "all" ? "All" : f}
            {state.counts[f] !== undefined && (
              <span className="ml-1 tabular-nums">{state.counts[f]}</span>
            )}
          </Link>
        ))}
      </nav>

      {state.rows.length === 0 ? (
        <Surface>
          <p className="py-6 text-center text-body text-muted-foreground">
            {current === "all" ? "Nothing has been pushed yet." : `Nothing with the status “${current}”.`}
          </p>
        </Surface>
      ) : (
        <Surface pad="none">
          <TableScroll>
            <Table>
              <THead>
                <TR>
                  <TH>When</TH>
                  <TH>Who</TH>
                  <TH>Field</TH>
                  <TH>App: before → after</TH>
                  <TH>Salesforce: before → after</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {state.rows.map((r) => (
                  <TR key={r.id}>
                    <TD className="whitespace-nowrap text-muted-foreground">{when(r.created_at)}</TD>
                    <TD className="whitespace-nowrap">{r.member_id ? people.get(r.member_id) ?? "—" : "—"}</TD>
                    <TD className="whitespace-nowrap">
                      <Link href={`/opportunities/${r.opportunity_id}`} className="underline-offset-2 hover:underline">
                        {r.field}
                      </Link>
                      <span className="block text-meta text-muted-foreground">{r.sf_field}</span>
                    </TD>
                    <TD className="max-w-[18rem]">
                      <span className="block truncate">{shown(r.old_value)} → {shown(r.new_value)}</span>
                    </TD>
                    <TD className="max-w-[18rem]">
                      <span className="block truncate">{shown(r.sf_before)} → {shown(r.sf_after)}</span>
                      <a
                        href={salesforceRecordUrl(r.salesforce_id)}
                        target="_blank"
                        rel="noreferrer"
                        className="block text-meta text-muted-foreground underline-offset-2 hover:underline"
                      >
                        Open in Salesforce
                      </a>
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
    </div>
  );
}
