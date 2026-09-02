import Link from "next/link";
import { myWork, syncState, processesWithWork } from "@/actions/work";
import { WorkRows } from "@/components/work/WorkRows";
import { myPermissions } from "@/lib/org";
import { NoAccess } from "@/components/no-access";

export const dynamic = "force-dynamic";

/**
 * Everything assigned to you, plus a way into each process.
 *
 * This is the screen that replaces opening ClickUp in the morning. It is not a
 * copy of ClickUp Home: there is one list, not a configurable grid, because the
 * only thing anybody used that grid for was to build this.
 */
export default async function WorkPage() {
  const perms = await myPermissions();
  if (!perms.has("work.view") && !perms.has("org.manage")) {
    return <NoAccess section="Work" need="View ClickUp work" />;
  }

  const [items, sync, processes] = await Promise.all([
    myWork(),
    syncState(),
    processesWithWork(),
  ]);

  return (
    <div className="max-w-5xl space-y-4 p-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">My work</h1>
        {sync?.finishedAt && (
          <span className="text-xs tabular-nums text-muted-foreground">
            synced{" "}
            {new Date(sync.finishedAt).toLocaleString("en-GB", {
              day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
            })}
          </span>
        )}
      </div>

      <div className="rounded-lg border bg-card">
        <div className="flex items-baseline justify-between border-b px-3 py-2">
          <h2 className="text-sm font-semibold">Assigned to me</h2>
          <span className="text-xs tabular-nums text-muted-foreground">{items.length}</span>
        </div>
        {items.length === 0 ? (
          <p className="px-3 py-3 text-sm text-muted-foreground">Nothing open.</p>
        ) : (
          <div className="px-3 py-1">
            <WorkRows items={items} show={{ client: true, process: true }} />
          </div>
        )}
      </div>

      {processes.length > 0 && (
        <div className="rounded-lg border bg-card">
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
        </div>
      )}
    </div>
  );
}
