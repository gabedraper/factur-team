import type { WorkGroup } from "@/lib/work";
import { WorkRows } from "./WorkRows";

/**
 * The open ClickUp work on one client, grouped by process.
 *
 * Sits with billing and history rather than on a page of its own: the question
 * "what is happening on this account" has never been answerable in one place,
 * and answering it somewhere else would leave it that way.
 */
export function WorkPanel({ groups }: { groups: WorkGroup[] }) {
  const total = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-baseline justify-between border-b px-3 py-2">
        <h2 className="text-sm font-semibold">ClickUp</h2>
        <span className="text-xs tabular-nums text-muted-foreground">
          {total} open
        </span>
      </div>

      {total === 0 ? (
        <p className="px-3 py-3 text-sm text-muted-foreground">Nothing open.</p>
      ) : (
        <div className="px-3 py-1">
          {groups.map((group) => (
            <div key={group.slug} className="py-1.5">
              <div className="flex items-baseline justify-between">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  {group.name}
                </span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {group.items.length}
                </span>
              </div>
              <WorkRows items={group.items} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
