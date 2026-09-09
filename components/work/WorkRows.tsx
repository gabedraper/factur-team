import Link from "next/link";
import { ExternalLink } from "lucide-react";
import type { WorkItem } from "@/lib/work";
import { dueClass, shortDate, isOpen } from "@/lib/work";
import { appDestination } from "@/lib/work-anchor";

/**
 * A mirrored task, as one line, pointing both ways.
 *
 * The title goes out to ClickUp, because that is still where a task is edited.
 * The client name goes *in*, to the screen the work is actually about. Both
 * matter while the mirror is read-only: one is how the work gets done today,
 * the other is the thing we are building towards, and a row that only leaves
 * the app quietly argues for staying in ClickUp.
 *
 * Two links in one row means the row itself cannot be the link -- nested
 * anchors are invalid and the browser will unpick them in its own way.
 */
function Row({
  item, show,
}: {
  item: WorkItem;
  /** Columns that are not implied by where the row is being rendered. */
  show?: { client?: boolean; process?: boolean };
}) {
  const open = isOpen(item);
  const destination = appDestination(item);

  return (
    <div className="group flex items-baseline gap-3 border-b px-1 py-1.5 last:border-0 hover:bg-accent/50">
      <a
        href={item.url}
        target="_blank"
        rel="noreferrer"
        className="min-w-0 flex-1 truncate text-sm hover:underline"
      >
        {item.title}
        <ExternalLink className="ml-1.5 inline h-3 w-3 shrink-0 align-baseline text-muted-foreground opacity-0 group-hover:opacity-100" />
      </a>

      {show?.client && (
        <span className="hidden w-40 shrink-0 truncate text-xs sm:block">
          {destination ? (
            <Link href={destination.href} className="text-muted-foreground hover:text-foreground hover:underline">
              {destination.label}
            </Link>
          ) : (
            <span className="text-muted-foreground">{item.folder ?? ""}</span>
          )}
        </span>
      )}

      {show?.process && item.processName && (
        <span className="hidden w-36 shrink-0 truncate text-xs text-muted-foreground md:block">
          {item.processName}
          {item.pod ? ` · ${item.pod}` : ""}
        </span>
      )}

      <span className="hidden w-32 shrink-0 truncate text-xs text-muted-foreground lg:block">
        {item.assignees.join(", ")}
      </span>

      <span className="w-24 shrink-0 truncate text-right text-xs text-muted-foreground">
        {item.status}
      </span>

      <span className={`w-14 shrink-0 text-right text-xs tabular-nums ${dueClass(item.dueAt, open)}`}>
        {shortDate(item.dueAt)}
      </span>
    </div>
  );
}

export function WorkRows({
  items, show,
}: {
  items: WorkItem[];
  show?: { client?: boolean; process?: boolean };
}) {
  return (
    <div>
      {items.map((item) => (
        <Row key={item.id} item={item} show={show} />
      ))}
    </div>
  );
}
