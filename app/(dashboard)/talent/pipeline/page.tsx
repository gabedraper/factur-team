import Link from "next/link";
import { requireTalent } from "@/lib/talent/access";
import { listMembers, masterPipeline } from "@/lib/talent/queries";
import { Avatar, Chip, Empty, PageHeader, Panel } from "@/components/talent/bits";
import { Button } from "@/components/ui/button";
import { ago } from "@/lib/talent/format";
import { CANDIDATE_STATUS, STAGE_KIND } from "@/lib/talent/types";

export const dynamic = "force-dynamic";

/**
 * Every live candidate on every live search, sorted by how long nobody has
 * touched them.
 *
 * A board per job answers "where is this search"; this answers "who is being
 * dropped", which is the question no single board can be asked.
 */
export default async function MasterPipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ owner?: string; kind?: string; stale?: string; status?: string }>;
}) {
  await requireTalent("view");
  const params = await searchParams;

  const [rows, members] = await Promise.all([
    masterPipeline({
      ownerId: params.owner,
      stageKind: params.kind,
      stale: params.stale === "1",
      status: params.status,
    }),
    listMembers(),
  ]);

  return (
    <div className="space-y-4 p-6">
      <PageHeader title="Pipeline" count={rows.length} />

      <form className="flex flex-wrap items-center gap-2" action="/talent/pipeline">
        <select name="owner" defaultValue={params.owner ?? ""}
          className="rounded-md border bg-background px-2 py-1.5 text-sm">
          <option value="">Anyone</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>{m.full_name ?? m.email}</option>
          ))}
        </select>
        <select name="kind" defaultValue={params.kind ?? ""}
          className="rounded-md border bg-background px-2 py-1.5 text-sm">
          <option value="">Any stage</option>
          {Object.entries(STAGE_KIND).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select name="status" defaultValue={params.status ?? "active"}
          className="rounded-md border bg-background px-2 py-1.5 text-sm">
          {Object.entries(CANDIDATE_STATUS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
          <option value="all">All</option>
        </select>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" name="stale" value="1" defaultChecked={params.stale === "1"} />
          Untouched 7 days
        </label>
        <Button size="sm" variant="outline" type="submit">Filter</Button>
      </form>

      <Panel>
        {rows.length === 0 ? <Empty>Nothing in the pipeline</Empty> : (
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Candidate</th>
                <th className="px-4 py-2 font-medium">Job</th>
                <th className="px-4 py-2 font-medium">Stage</th>
                <th className="px-4 py-2 font-medium">Owner</th>
                <th className="px-4 py-2 text-right font-medium">In stage</th>
                <th className="px-4 py-2 text-right font-medium">Untouched</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((c) => (
                <tr key={c.candidate_id} className="hover:bg-accent/40">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={c.person_name} size={6} />
                      <div className="min-w-0">
                        <Link href={`/talent/people/${c.person_id}`} className="font-medium hover:underline">
                          {c.person_name}
                        </Link>
                        <p className="truncate text-xs text-muted-foreground">
                          {[c.person_title, c.person_company].filter(Boolean).join(" · ") || "—"}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <Link href={`/talent/jobs/${c.job_id}`} className="hover:underline">
                      {c.job_title}
                    </Link>
                    <p className="text-xs text-muted-foreground">{c.company_name ?? "—"}</p>
                  </td>
                  <td className="px-4 py-2.5">
                    <Chip colour={c.stage_color}>{c.stage_name ?? "—"}</Chip>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{c.owner_name ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                    {c.days_in_stage}d
                  </td>
                  <td
                    className={`px-4 py-2.5 text-right tabular-nums ${
                      c.days_since_touch >= 21 ? "font-semibold text-red-600 dark:text-red-400"
                        : c.days_since_touch >= 7 ? "text-amber-600 dark:text-amber-400"
                        : "text-muted-foreground"
                    }`}
                    title={ago(c.last_activity_at)}
                  >
                    {c.days_since_touch}d
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
