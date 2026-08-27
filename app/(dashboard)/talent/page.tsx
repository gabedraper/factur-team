import Link from "next/link";
import { AlertTriangle, CalendarClock, Inbox, ListTodo } from "lucide-react";
import { requireTalent } from "@/lib/talent/access";
import { currentMemberId } from "@/lib/org";
import { todayFor } from "@/lib/talent/queries";
import { Chip, Empty, PageHeader, Panel } from "@/components/talent/bits";
import { ago, onDay, onDayTime } from "@/lib/talent/format";

export const dynamic = "force-dynamic";

/**
 * What is on today.
 *
 * Four things, in the order a recruiter would ask them: what am I meant to do,
 * who am I meeting, who have I let go cold, and what has arrived. The stale
 * list is the one that earns this page -- everything else is visible somewhere
 * else, but nobody goes looking for the candidate they have forgotten.
 */
export default async function TalentTodayPage() {
  const access = await requireTalent("view");
  const memberId = await currentMemberId();
  const { tasks, interviews, stale, jobs, newApplications, awaitingFeedback } =
    await todayFor(memberId);

  const overdue = tasks.filter((t) => {
    const due = (t as { due_at: string | null }).due_at;
    return due && new Date(due) < new Date();
  }).length;

  return (
    <div className="space-y-4 p-6">
      <PageHeader title="Today" />

      <div className="grid gap-3 sm:grid-cols-4">
        <Link href="/talent/tasks" className="rounded-lg border bg-card px-4 py-3 hover:bg-accent/40">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
            <ListTodo className="h-3.5 w-3.5" />
            Tasks
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{tasks.length}</div>
          {overdue > 0 && (
            <div className="text-xs text-red-600 dark:text-red-400">{overdue} overdue</div>
          )}
        </Link>

        <Link href="/talent/schedule" className="rounded-lg border bg-card px-4 py-3 hover:bg-accent/40">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
            <CalendarClock className="h-3.5 w-3.5" />
            Interviews
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{interviews.length}</div>
          <div className="text-xs text-muted-foreground">next 7 days</div>
        </Link>

        <Link href="/talent/pipeline?stale=1" className="rounded-lg border bg-card px-4 py-3 hover:bg-accent/40">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
            <AlertTriangle className="h-3.5 w-3.5" />
            Going cold
          </div>
          <div className={`mt-1 text-2xl font-semibold tabular-nums ${stale.length ? "text-amber-600 dark:text-amber-400" : ""}`}>
            {stale.length}
          </div>
          <div className="text-xs text-muted-foreground">7 days untouched</div>
        </Link>

        <Link href="/talent/applications" className="rounded-lg border bg-card px-4 py-3 hover:bg-accent/40">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
            <Inbox className="h-3.5 w-3.5" />
            Applications
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{newApplications}</div>
          <div className="text-xs text-muted-foreground">unreviewed</div>
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="My tasks">
          {tasks.length === 0 ? <Empty>Nothing due</Empty> : (
            <ul className="divide-y text-sm">
              {tasks.map((t) => {
                const row = t as Record<string, unknown> & {
                  id: string; title: string; due_at: string | null; priority: string;
                  tal_people: { id: string; name: string } | null;
                  tal_jobs: { id: string; title: string } | null;
                };
                const late = row.due_at && new Date(row.due_at) < new Date();
                return (
                  <li key={row.id} className="flex items-center gap-2 px-4 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{row.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {row.tal_people ? (
                          <Link href={`/talent/people/${row.tal_people.id}`} className="hover:underline">
                            {row.tal_people.name}
                          </Link>
                        ) : null}
                        {row.tal_people && row.tal_jobs ? " · " : null}
                        {row.tal_jobs ? (
                          <Link href={`/talent/jobs/${row.tal_jobs.id}`} className="hover:underline">
                            {row.tal_jobs.title}
                          </Link>
                        ) : null}
                      </span>
                    </span>
                    <span className={`shrink-0 text-xs tabular-nums ${late ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>
                      {onDay(row.due_at)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title="This week">
          {interviews.length === 0 ? <Empty>Nothing scheduled</Empty> : (
            <ul className="divide-y text-sm">
              {interviews.map((i) => {
                const row = i as Record<string, unknown> & {
                  id: string; starts_at: string; kind: string;
                  tal_people: { id: string; name: string } | null;
                  tal_jobs: { id: string; title: string } | null;
                };
                return (
                  <li key={row.id} className="flex items-center gap-2 px-4 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">
                        {row.tal_people ? (
                          <Link href={`/talent/people/${row.tal_people.id}`} className="hover:underline">
                            {row.tal_people.name}
                          </Link>
                        ) : "—"}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {row.tal_jobs?.title ?? "—"}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {onDayTime(row.starts_at)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title="Going cold">
          {stale.length === 0 ? <Empty>Nothing sitting</Empty> : (
            <ul className="divide-y text-sm">
              {stale.map((c) => (
                <li key={c.candidate_id} className="flex items-center gap-2 px-4 py-2">
                  <span className="min-w-0 flex-1">
                    <Link href={`/talent/people/${c.person_id}`} className="block truncate hover:underline">
                      {c.person_name}
                    </Link>
                    <span className="block truncate text-xs text-muted-foreground">
                      {c.job_title} · {c.stage_name ?? "—"}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-amber-600 dark:text-amber-400">
                    {c.days_since_touch}d
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="My jobs">
          {jobs.length === 0 ? <Empty>None</Empty> : (
            <ul className="divide-y text-sm">
              {jobs.map((j) => (
                <li key={j.id} className="flex items-center gap-2 px-4 py-2">
                  <Link href={`/talent/jobs/${j.id}`} className="min-w-0 flex-1 truncate hover:underline">
                    {j.title}
                  </Link>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {j.active_count} active
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{ago(j.last_activity_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {awaitingFeedback.length > 0 && (
          <Panel title="Waiting on the client" className="lg:col-span-2">
            <ul className="divide-y text-sm">
              {awaitingFeedback.map((s) => {
                const row = s as Record<string, unknown> & {
                  id: string; status: string; shared_at: string | null; view_count: number;
                  tal_people: { name: string } | null; tal_jobs: { title: string } | null;
                };
                return (
                  <li key={row.id} className="flex items-center gap-2 px-4 py-2">
                    <span className="min-w-0 flex-1 truncate">
                      {row.tal_people?.name ?? "—"}
                      <span className="text-muted-foreground"> · {row.tal_jobs?.title ?? "—"}</span>
                    </span>
                    <Chip colour={row.status === "viewed" ? "amber" : "slate"}>{row.status}</Chip>
                    <span className="shrink-0 text-xs text-muted-foreground">{ago(row.shared_at)}</span>
                  </li>
                );
              })}
            </ul>
          </Panel>
        )}
      </div>

      {!access.recruit && (
        <p className="text-sm text-muted-foreground">Read only</p>
      )}
    </div>
  );
}
