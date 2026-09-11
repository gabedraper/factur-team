import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { myAgenda, myBlocked, syncState, processesWithWork } from "@/actions/work";
import { WorkRows } from "@/components/work/WorkRows";
import { myPermissions } from "@/lib/org";
import { NoAccess } from "@/components/no-access";
import type { WorkItem } from "@/lib/work";
import { PageHeader } from "@/components/ui/page-header";
import { Surface } from "@/components/ui/surface";

export const dynamic = "force-dynamic";

/**
 * Home: what to do now.
 *
 * ClickUp Home answers one question and answers it with dates, so this does
 * too. Overdue leads because it is the only bucket that is already a problem.
 * Anything with no bucket -- an empty day, nothing blocked -- is left out
 * rather than shown empty, so the page is as short as the day is quiet.
 */
function Section({
  title, items, tone,
}: {
  title: string;
  items: WorkItem[];
  tone?: string;
}) {
  if (items.length === 0) return null;
  return (
    <Surface pad="none">
      <div className="flex items-baseline justify-between border-b px-3 py-2">
        <h2 className={`text-sm font-semibold ${tone ?? ""}`}>{title}</h2>
        <span className="text-xs tabular-nums text-muted-foreground">{items.length}</span>
      </div>
      <div className="px-3 py-1">
        <WorkRows items={items} show={{ client: true, process: true }} />
      </div>
    </Surface>
  );
}

export default async function WorkPage() {
  const perms = await myPermissions();
  if (!perms.has("work.view") && !perms.has("org.manage")) {
    return <NoAccess section="Work" need="View ClickUp work" />;
  }

  const [agenda, blocked, sync, processes] = await Promise.all([
    myAgenda(), myBlocked(), syncState(), processesWithWork(),
  ]);

  const total =
    agenda.overdue.length + agenda.today.length + agenda.soon.length +
    agenda.later.length + agenda.undated.length;

  return (
    <div className="max-w-5xl space-y-4 p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <PageHeader
          title="My work"
          actions={<><Link href="/work/browse" className="text-sm text-muted-foreground hover:text-foreground">
            Spaces
          </Link>
          <span className="text-xs tabular-nums text-muted-foreground">{total} open</span></>}
        />
        {sync?.finishedAt && (
          <span className="text-xs tabular-nums text-muted-foreground">
            synced{" "}
            {new Date(sync.finishedAt).toLocaleString("en-GB", {
              day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
            })}
          </span>
        )}
      </div>

      {total === 0 && (
        <Surface pad="tight">
          <p className="text-sm text-muted-foreground">Nothing open.</p>
        </Surface>
      )}

      <Section title="Overdue" items={agenda.overdue} tone="text-destructive" />
      <Section title="Today" items={agenda.today} />
      <Section title="This week" items={agenda.soon} />

      {blocked.length > 0 && (
        <Surface pad="none">
          <div className="flex items-baseline justify-between border-b px-3 py-2">
            <h2 className="text-sm font-semibold">Waiting on</h2>
            <span className="text-xs tabular-nums text-muted-foreground">{blocked.length}</span>
          </div>
          <div className="px-3 py-1">
            {blocked.map((b) => (
              <div key={`${b.item.id}-${b.blockerUrl}`} className="border-b py-1.5 last:border-0">
                <a href={b.item.url} target="_blank" rel="noreferrer" className="text-sm hover:underline">
                  {b.item.title}
                </a>
                <div className="text-xs text-muted-foreground">
                  <a href={b.blockerUrl} target="_blank" rel="noreferrer" className="hover:text-foreground hover:underline">
                    {b.blockerTitle}
                    <ExternalLink className="ml-1 inline h-2.5 w-2.5 align-baseline" />
                  </a>
                  {" · "}
                  {b.blockerStatus}
                </div>
              </div>
            ))}
          </div>
        </Surface>
      )}

      <Section title="Later" items={agenda.later} />
      <Section title="No date" items={agenda.undated} />

      {processes.length > 0 && (
        <Surface pad="none">
          <div className="border-b px-3 py-2">
            <h2 className="text-sm font-semibold">Processes</h2>
          </div>
          <div className="px-3 py-1">
            {processes.map((p) => (
              <Link
                key={p.slug}
                href={`/work/${p.slug}`}
                className="flex items-baseline justify-between border-b px-1 py-1.5 text-sm last:border-0 hover:bg-accent/50"
              >
                <span>{p.name}</span>
                <span className="text-xs tabular-nums text-muted-foreground">{p.open}</span>
              </Link>
            ))}
          </div>
        </Surface>
      )}
    </div>
  );
}
