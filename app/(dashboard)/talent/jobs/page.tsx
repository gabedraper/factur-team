import Link from "next/link";
import { Plus, EyeOff, Globe } from "lucide-react";
import { requireTalent } from "@/lib/talent/access";
import { listJobs, listMembers } from "@/lib/talent/queries";
import { Chip, PageHeader, Panel, Empty } from "@/components/talent/bits";
import { Button } from "@/components/ui/button";
import { ago, place, salaryRange } from "@/lib/talent/format";
import { JOB_KIND, JOB_STATUS, label } from "@/lib/talent/types";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = {
  active: "emerald", draft: "slate", on_hold: "amber",
  filled: "indigo", closed: "slate", cancelled: "rose",
};

/**
 * Every search, with the two numbers that say whether it is moving: how many
 * people are in the pipeline, and when anything last happened on it.
 */
export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; owner?: string }>;
}) {
  const access = await requireTalent("view");
  const params = await searchParams;
  const [jobs, members] = await Promise.all([
    listJobs({ q: params.q, status: params.status, ownerId: params.owner }),
    listMembers(),
  ]);

  const filters: { key: string; label: string }[] = [
    { key: "open", label: "Open" },
    ...Object.entries(JOB_STATUS).map(([k, v]) => ({ key: k, label: v })),
    { key: "all", label: "All" },
  ];
  const status = params.status ?? "open";

  function href(next: Record<string, string | undefined>) {
    const q = new URLSearchParams();
    const merged = { q: params.q, status, owner: params.owner, ...next };
    for (const [k, v] of Object.entries(merged)) if (v) q.set(k, v);
    return `/talent/jobs${q.size ? `?${q}` : ""}`;
  }

  return (
    <div className="space-y-4 p-6">
      <PageHeader title="Jobs" count={jobs.length}>
        {access.recruit && (
          <Button asChild size="sm">
            <Link href="/talent/jobs/new">
              <Plus className="mr-1.5 h-4 w-4" />
              New job
            </Link>
          </Button>
        )}
      </PageHeader>

      <form className="flex flex-wrap items-center gap-2" action="/talent/jobs">
        <input
          name="q"
          defaultValue={params.q ?? ""}
          placeholder="Search jobs"
          className="w-56 rounded-md border bg-background px-3 py-1.5 text-sm"
        />
        <input type="hidden" name="status" value={status} />
        <select
          name="owner"
          defaultValue={params.owner ?? ""}
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
        >
          <option value="">Anyone</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>{m.full_name ?? m.email}</option>
          ))}
        </select>
        <Button size="sm" variant="outline" type="submit">Filter</Button>
      </form>

      <div className="flex flex-wrap gap-1">
        {filters.map((f) => (
          <Link
            key={f.key}
            href={href({ status: f.key })}
            className={`rounded-full px-3 py-1 text-xs ${
              status === f.key
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      <Panel>
        {jobs.length === 0 ? (
          <Empty>No jobs</Empty>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Job</th>
                <th className="px-4 py-2 font-medium">Company</th>
                <th className="px-4 py-2 font-medium">Owner</th>
                <th className="px-4 py-2 text-right font-medium">Active</th>
                <th className="px-4 py-2 text-right font-medium">Submitted</th>
                <th className="px-4 py-2 text-right font-medium">Interview</th>
                <th className="px-4 py-2 font-medium">Pay</th>
                <th className="px-4 py-2 font-medium">Last activity</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {jobs.map((j) => (
                <tr key={j.id} className="hover:bg-accent/40">
                  <td className="px-4 py-2.5">
                    <Link href={`/talent/jobs/${j.id}`} className="font-medium hover:underline">
                      {j.title}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Chip colour={STATUS_TONE[j.status]}>{label(JOB_STATUS, j.status)}</Chip>
                      <span className="text-xs text-muted-foreground">
                        {label(JOB_KIND, j.job_kind)} · {place(j.city, j.state)}
                      </span>
                      {j.confidential && (
                        <EyeOff className="h-3 w-3 text-muted-foreground" aria-label="Confidential" />
                      )}
                      {j.published && (
                        <Globe className="h-3 w-3 text-emerald-600" aria-label="On the careers page" />
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {j.company_id ? (
                      <Link href={`/talent/companies/${j.company_id}`} className="hover:underline">
                        {j.company_name}
                      </Link>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{j.owner_name ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{j.active_count}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{j.submitted_count}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{j.interview_count}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {salaryRange(j.salary_min, j.salary_max)}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{ago(j.last_activity_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
