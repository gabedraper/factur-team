import Link from "next/link";
import { redirect } from "next/navigation";
import { myPermissions } from "@/lib/org";
import { PageHeader } from "@/components/ui/page-header";
import { Surface } from "@/components/ui/surface";
import { Chip } from "@/components/pipeline/bits";
import { control } from "@/components/ui/control";
import { Button } from "@/components/ui/button";
import { Table, TableScroll, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { loadFeed, describe, counterparty, outcome, STATUSES, SOURCES, type FeedStatus } from "@/lib/ingest/feed";

export const dynamic = "force-dynamic";

/*
 * Every call and email the tools reported, as it arrived, and what the app
 * made of it. "Orum says I made 40 calls and the app shows 31" is a filter
 * here; the nine are on this page with a reason each.
 *
 * Filters live in the URL so a view of "Mixmax, needs review" can be pasted
 * into a chat and opened by someone else.
 */

const TONE: Record<FeedStatus, "slate" | "amber" | "emerald" | "rose" | "blue"> = {
  pending: "blue", waiting: "slate", resolved: "emerald", needs_review: "amber", skipped: "slate", failed: "rose",
};
const LABEL: Record<FeedStatus, string> = {
  pending: "Pending", waiting: "In progress", resolved: "Resolved", needs_review: "Needs review", skipped: "Skipped", failed: "Failed",
};
const SOURCE_LABEL: Record<string, string> = { dialpad: "Dialpad", orum: "Orum", mixmax: "Mixmax", gmail: "Gmail" };

const nf = new Intl.NumberFormat("en-US");

function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default async function ActivityFeedPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; source?: string }>;
}) {
  const perms = await myPermissions();
  if (!perms.has("org.manage") && !perms.has("clients.activity_feed")) redirect("/settings");

  const { status, source } = await searchParams;
  const { rows, names, counts } = await loadFeed({ status, source });
  const filtered = !!(status || source);
  const week = STATUSES.map((s) => ({ s, n: counts[s] ?? 0 })).filter((x) => x.n > 0);

  return (
    <div className="space-y-4 p-section">
      <PageHeader
        back={{ href: "/settings", label: "Settings" }}
        title="Activity feed"
        description="What Dialpad, Orum and Mixmax sent, and where each one went."
        count={rows.length}
      />

      <p className="text-meta text-muted-foreground">
        Last seven days:{" "}
        {week.length === 0
          ? "nothing has arrived yet."
          : week.map((x, i) => (
              <span key={x.s}>
                {i > 0 && " · "}
                {nf.format(x.n)} {LABEL[x.s].toLowerCase()}
              </span>
            ))}
      </p>

      <form method="get" className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-meta text-muted-foreground">
          Status
          <select name="status" defaultValue={status ?? ""} className={control({ size: "sm" })}>
            <option value="">Any</option>
            {STATUSES.map((s) => <option key={s} value={s}>{LABEL[s]}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-meta text-muted-foreground">
          Source
          <select name="source" defaultValue={source ?? ""} className={control({ size: "sm" })}>
            <option value="">Any</option>
            {SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
          </select>
        </label>
        <Button type="submit" size="sm" variant="secondary">Filter</Button>
        {filtered && (
          <Button asChild size="sm" variant="ghost">
            <Link href="/settings/activity-feed">Clear filters</Link>
          </Button>
        )}
      </form>

      {rows.length === 0 ? (
        <Surface>
          <p className="py-6 text-center text-body text-muted-foreground">
            {filtered
              ? "Nothing matches these filters."
              : "No events yet. Once a vendor's webhook is pointed at the app, every call and email lands here."}
          </p>
        </Surface>
      ) : (
        <Surface pad="none">
          <TableScroll>
            <Table>
              <THead>
                <TR>
                  <TH>Received</TH>
                  <TH>Source</TH>
                  <TH>What</TH>
                  <TH>Who</TH>
                  <TH>With</TH>
                  <TH>Status</TH>
                  <TH>Where it went</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((r) => {
                  const member = (r.member_id && names.members.get(r.member_id))
                    ?? (r.resolution?.member_id && names.members.get(r.resolution.member_id))
                    ?? r.resolution?.facts?.user_email
                    ?? "";
                  return (
                    <TR key={r.id}>
                      <TD className="whitespace-nowrap text-meta text-muted-foreground">
                        <Link href={`/settings/activity-feed/${r.id}`} className="hover:underline">{when(r.received_at)}</Link>
                      </TD>
                      <TD>{SOURCE_LABEL[r.source] ?? r.source}</TD>
                      <TD className="max-w-[24rem] truncate">
                        <Link href={`/settings/activity-feed/${r.id}`} className="hover:underline">{describe(r)}</Link>
                      </TD>
                      <TD className="whitespace-nowrap">{member}</TD>
                      <TD className="max-w-[16rem] truncate text-meta text-muted-foreground">{counterparty(r)}</TD>
                      <TD><Chip colour={TONE[r.status]}>{LABEL[r.status]}</Chip></TD>
                      <TD className="max-w-[26rem] text-meta text-muted-foreground">
                        {r.status === "resolved" && r.resolution?.opportunity_id ? (
                          <Link href={`/opportunities/${r.resolution.opportunity_id}`} className="hover:underline">
                            {outcome(r, names)}
                          </Link>
                        ) : (
                          outcome(r, names)
                        )}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </TableScroll>
        </Surface>
      )}
    </div>
  );
}
