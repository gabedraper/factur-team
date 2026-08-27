import Link from "next/link";
import { notFound } from "next/navigation";
import { EyeOff, Pencil } from "lucide-react";
import { requireTalent } from "@/lib/talent/access";
import {
  getJob, getSettings, jobFunnel, listActivityTypes, listMembers, listNoteTemplates,
} from "@/lib/talent/queries";
import { PipelineBoard } from "@/components/talent/PipelineBoard";
import { AddCandidate, PublishToggle } from "@/components/talent/JobActions";
import { ActivityFeed } from "@/components/talent/ActivityFeed";
import { LogActivity } from "@/components/talent/LogActivity";
import { Chip, Empty, PageHeader, Panel, Stat, Tabs } from "@/components/talent/bits";
import { Button } from "@/components/ui/button";
import { ago, money, onDay, place, salaryRange } from "@/lib/talent/format";
import {
  EMPLOYMENT_TYPE, JOB_KIND, JOB_STATUS, REMOTE, SUBMISSION_STATUS, label,
} from "@/lib/talent/types";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "pipeline", label: "Pipeline" },
  { key: "details", label: "Details" },
  { key: "activity", label: "Activity" },
  { key: "submissions", label: "Submissions" },
  { key: "targets", label: "Target companies" },
  { key: "reports", label: "Reports" },
];

/**
 * One search. The board is the default view because it is what somebody opens
 * a job to look at; everything else is a tab away.
 */
export default async function JobPage({
  params, searchParams,
}: {
  params: Promise<{ jobId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const access = await requireTalent("view");
  const { jobId } = await params;
  const tab = (await searchParams).tab ?? "pipeline";

  const data = await getJob(jobId);
  if (!data) notFound();
  const { job, stages, candidates, activities, targets, submissions, matches, tasks } = data;

  const [members, types, templates, settings, funnel] = await Promise.all([
    listMembers(),
    listActivityTypes(),
    listNoteTemplates("job"),
    getSettings(),
    tab === "reports" ? jobFunnel(jobId) : Promise.resolve([]),
  ]);
  const authors = new Map(members.map((m) => [m.id, m.full_name ?? m.email]));

  const live = candidates.filter((c) => c.status === "active");
  const stale = live.filter((c) => c.days_since_touch >= 7).length;

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0">
          <PageHeader title={job.title}>
            {job.confidential && (
              <Chip colour="rose">
                <EyeOff className="h-3 w-3" />
                Confidential
              </Chip>
            )}
          </PageHeader>
          <p className="mt-1 text-sm text-muted-foreground">
            {job.tal_companies?.id ? (
              <Link href={`/talent/companies/${job.tal_companies.id}`} className="hover:underline">
                {job.tal_companies.name}
              </Link>
            ) : "No company"}
            {" · "}
            {label(JOB_STATUS, job.status)} · {label(JOB_KIND, job.job_kind)} ·{" "}
            {label(REMOTE, job.remote)} · {place(job.city, job.state)}
          </p>
        </div>

        <div className="ml-auto flex flex-wrap items-start gap-2">
          {access.recruit && <AddCandidate jobId={job.id} />}
          {access.recruit && (
            <Button asChild size="sm" variant="outline">
              <Link href={`/talent/jobs/${job.id}/edit`}>
                <Pencil className="mr-1.5 h-4 w-4" />
                Edit
              </Link>
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 rounded-lg border bg-card px-4 py-3 sm:grid-cols-6">
        <Stat label="In pipeline" value={live.length} />
        <Stat label="Submitted" value={candidates.filter((c) => c.stage_kind === "submitted").length} />
        <Stat label="Interviewing" value={candidates.filter((c) => c.stage_kind === "interview").length} />
        <Stat label="Hired" value={candidates.filter((c) => c.status === "hired").length} />
        <Stat
          label="Untouched 7d+"
          value={stale}
          tint={stale ? "text-amber-600 dark:text-amber-400" : undefined}
        />
        <Stat label="Openings" value={job.openings} />
      </div>

      <Tabs tabs={TABS} active={tab} base={`/talent/jobs/${job.id}`} />

      {tab === "pipeline" && (
        stages.length === 0 ? (
          <Panel><Empty>This job has no pipeline stages</Empty></Panel>
        ) : (
          <PipelineBoard
            jobId={job.id}
            stages={stages}
            candidates={candidates}
            canEdit={access.recruit}
          />
        )
      )}

      {tab === "details" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <Panel title="Description">
              <div className="whitespace-pre-wrap px-4 py-3 text-sm">
                {job.description || <span className="text-muted-foreground">—</span>}
              </div>
            </Panel>
            <Panel title="Requirements">
              <div className="whitespace-pre-wrap px-4 py-3 text-sm">
                {job.requirements || <span className="text-muted-foreground">—</span>}
              </div>
            </Panel>
            <Panel title="Internal notes">
              <div className="whitespace-pre-wrap px-4 py-3 text-sm">
                {job.internal_notes || <span className="text-muted-foreground">—</span>}
              </div>
            </Panel>
          </div>

          <div className="space-y-4">
            <Panel title="Terms">
              <dl className="grid grid-cols-2 gap-3 px-4 py-3">
                <Stat label="Employment" value={label(EMPLOYMENT_TYPE, job.employment_type)} />
                <Stat label="Pay" value={salaryRange(job.salary_min, job.salary_max, job.salary_currency, job.salary_period)} />
                <Stat
                  label="Fee"
                  value={
                    job.fee_type === "flat" ? money(job.fee_flat)
                      : job.fee_percent ? `${job.fee_percent}%`
                      : "—"
                  }
                />
                <Stat label="Opened" value={onDay(job.opened_on)} />
                <Stat label="Target fill" value={onDay(job.target_fill_on)} />
                <Stat label="Owner" value={job.owner_member_id ? authors.get(job.owner_member_id) ?? "—" : "—"} />
              </dl>
            </Panel>

            {access.recruit && (
              <Panel title="Careers page">
                <div className="px-4 py-3">
                  <PublishToggle
                    jobId={job.id}
                    published={job.published}
                    confidential={job.confidential}
                    status={job.status}
                    careersEnabled={settings.careers_page_enabled}
                    slug={job.public_slug}
                  />
                </div>
              </Panel>
            )}

            <Panel title="Open tasks" >
              {tasks.length === 0 ? <Empty>None</Empty> : (
                <ul className="divide-y text-sm">
                  {tasks.map((t) => (
                    <li key={t.id} className="flex gap-2 px-4 py-2">
                      <span className="min-w-0 flex-1 truncate">{t.title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{onDay(t.due_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      )}

      {tab === "activity" && (
        <Panel>
          {access.recruit && (
            <LogActivity types={types} templates={templates} jobId={job.id} />
          )}
          <ActivityFeed activities={activities} authors={authors} />
        </Panel>
      )}

      {tab === "submissions" && (
        <Panel title="Submissions">
          {submissions.length === 0 ? <Empty>Nothing submitted yet</Empty> : (
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Candidate</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Decision</th>
                  <th className="px-4 py-2 font-medium">Shared</th>
                  <th className="px-4 py-2 text-right font-medium">Views</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {submissions.map((s) => {
                  const row = s as Record<string, unknown> & {
                    id: string; status: string; client_decision: string | null;
                    shared_at: string | null; view_count: number;
                    tal_people: { id: string; name: string } | null;
                  };
                  return (
                    <tr key={row.id}>
                      <td className="px-4 py-2">
                        {row.tal_people ? (
                          <Link href={`/talent/people/${row.tal_people.id}`} className="hover:underline">
                            {row.tal_people.name}
                          </Link>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-2">
                        <Chip colour={row.status === "declined" ? "rose" : row.status === "advanced" ? "emerald" : "slate"}>
                          {label(SUBMISSION_STATUS, row.status)}
                        </Chip>
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{row.client_decision ?? "—"}</td>
                      <td className="px-4 py-2 text-muted-foreground">{ago(row.shared_at)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{row.view_count}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Panel>
      )}

      {tab === "targets" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Target companies">
            {targets.length === 0 ? <Empty>None named</Empty> : (
              <ul className="divide-y text-sm">
                {targets.map((t) => {
                  const row = t as Record<string, unknown> & {
                    company_id: string; status: string;
                    tal_companies: { id: string; name: string; industry: string | null } | null;
                  };
                  return (
                    <li key={row.company_id} className="flex items-center gap-2 px-4 py-2">
                      <Link href={`/talent/companies/${row.company_id}`} className="hover:underline">
                        {row.tal_companies?.name ?? "—"}
                      </Link>
                      <span className="text-xs text-muted-foreground">{row.tal_companies?.industry}</span>
                      <Chip className="ml-auto" colour={row.status === "off_limits" ? "rose" : "slate"}>
                        {row.status.replace("_", " ")}
                      </Chip>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel title="Suggested matches">
            {matches.length === 0 ? (
              <Empty>None — matching needs the Claude API connected</Empty>
            ) : (
              <ul className="divide-y text-sm">
                {matches.map((m) => {
                  const row = m as Record<string, unknown> & {
                    id: string; score: number | null;
                    tal_people: { id: string; name: string; title: string | null } | null;
                  };
                  return (
                    <li key={row.id} className="flex items-center gap-2 px-4 py-2">
                      <Link href={`/talent/people/${row.tal_people?.id}`} className="hover:underline">
                        {row.tal_people?.name}
                      </Link>
                      <span className="text-xs text-muted-foreground">{row.tal_people?.title}</span>
                      <span className="ml-auto tabular-nums">{row.score ?? "—"}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>
      )}

      {tab === "reports" && (
        <Panel title="Funnel">
          {funnel.length === 0 ? <Empty>Nothing has moved through this job yet</Empty> : (
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Stage</th>
                  <th className="px-4 py-2 text-right font-medium">Reached</th>
                  <th className="px-4 py-2 text-right font-medium">There now</th>
                  <th className="px-4 py-2 text-right font-medium">Median days</th>
                  <th className="px-4 py-2 text-right font-medium">From previous</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {funnel.map((f, i) => {
                  const prior = funnel[i - 1];
                  const rate = prior?.reached ? Math.round((f.reached / prior.reached) * 100) : null;
                  return (
                    <tr key={f.stage_id}>
                      <td className="px-4 py-2">{f.stage_name}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{f.reached}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{f.still_there}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                        {f.median_days == null ? "—" : Math.round(Number(f.median_days))}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                        {rate === null ? "—" : `${rate}%`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Panel>
      )}
    </div>
  );
}
